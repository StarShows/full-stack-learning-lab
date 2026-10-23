import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { readConfig } from '../server/config.mjs';

export const fields = ['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'LLM_MODE', 'LLM_ENDPOINT', 'LLM_MODEL', 'LLM_TOKEN', 'OLLAMA_MODEL'];
const secrets = new Set(['GOOGLE_CLIENT_SECRET', 'APPLE_PRIVATE_KEY', 'LLM_TOKEN']);
export function validateTarget(t) {
  if (!t || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(t.host) || !/^[a-z_][a-z0-9_-]{0,31}$/.test(t.user) || !Number.isInteger(t.port) || t.port < 1 || t.port > 65535 || !/^\/[a-zA-Z0-9_/-]+$/.test(t.directory) || t.directory.includes('..') || t.directory === '/') throw Error('Enter a valid SSH host, user, port, and absolute deployment directory.');
  return t;
}
export function sshArgs(t) {
  validateTarget(t);
  return ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-p', String(t.port), '--', `${t.user}@${t.host}`];
}
export function run(command, args, { cwd, input, timeout = 120000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, CI: '1' } });
    let output = '', settled = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { stop(); }, timeout);
    function collect(chunk) { if (output.length < 48000) output += chunk.toString().slice(0, 48000 - output.length); }
    child.stdout.on('data', collect);child.stderr.on('data', collect);
    child.on('error', e => { clearTimeout(timer);settled = true;reject(e); });
    child.on('close', code => { clearTimeout(timer);if (!settled) resolveResult({ ok: code === 0, code, output }); });
    child.stdin.on('error', () => {});child.stdin.end(input);
  });
}
export async function readSettings(root) {
  try { return parseEnv(await readFile(resolve(root, '.env'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {};throw e; }
}
export function redactSettings(env) { return Object.fromEntries(fields.map(k => [k, secrets.has(k) ? (env[k] ? 'configured' : '') : env[k] || ''])); }
export async function saveSettings(root, input) {
  if (!input || Object.keys(input).some(k => !fields.includes(k))) throw Error('Unknown configuration field.');
  const env = await readSettings(root);
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > 16000 || value.includes('\0') || value.includes("'") || value.includes('\r')) throw Error('Invalid configuration value.');
    if (secrets.has(key) && !value) continue;
    env[key] = value; if (secrets.has(key)) delete env[key + '_FILE'];
  }
  readConfig(env);
  const path = resolve(root, '.env');
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('Refusing symbolic-link configuration.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = path + '.pending';
  await writeFile(temp, Object.entries(env).map(([k,v]) => `${k}='${v}'`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
  return { ok: true, message: 'Configuration saved with private permissions. Restart or deploy to apply.' };
}
const scripts = {
  check: 'set -eu; uname -s; command -v docker; docker compose version; docker info --format "{{.ServerVersion}}"; df -h .; free -m',
  status: 'docker compose ps',
  restart: 'docker compose up -d --force-recreate app',
  stop: 'docker compose stop',
  health: 'docker compose exec -T app node scripts/check-health.mjs',
  model: 'docker compose exec -T app node scripts/check-model.mjs',
};
export async function operation(root, action, target, runner = run) {
  if (action === 'test') return runner('npm', ['test'], { cwd: root, timeout: 300000 });
  if (action === 'build') return runner('npm', ['run', 'build'], { cwd: root });
  if (action === 'validate') { readConfig(await readSettings(root));return { ok: true, output: 'Application configuration is valid.' }; }
  if (!Object.hasOwn(scripts, action)) throw Error('Unknown operation.');
  if (target) {
    validateTarget(target);
    return runner('ssh', [...sshArgs(target), 'sh', '-s'], { input: `set -eu\ncd '${target.directory}'\n${scripts[action]}\n`, timeout: 300000 });
  }
  return runner('sh', ['-s'], { cwd: root, input: scripts[action], timeout: 300000 });
}
export async function deploy(root, target, runner = run) {
  validateTarget(target);
  const config = await readSettings(root);readConfig(config);
  if (!config.GOOGLE_CLIENT_ID && !config.APPLE_CLIENT_ID) throw Error('Configure a sign-in provider before deployment.');
  if (!config.APP_URL?.startsWith('https://')) throw Error('Deployment requires a public HTTPS APP_URL and an existing TLS reverse proxy.');
  if (Object.keys(config).some(k => k.endsWith('_FILE') && config[k])) throw Error('File-based secrets must be provisioned on the destination separately. Use wizard secret fields for this deployment.');
  const build = await runner('npm', ['run', 'build'], { cwd: root });
  if (!build.ok) return { ok: false, output: 'Pre-deployment build failed.' };
  const tests = await runner('npm', ['test'], { cwd: root, timeout: 300000 });
  if (!tests.ok) return { ok: false, output: 'Pre-deployment tests failed. Run Tests for details.' };
  // Archive explicit source paths only. Never include env, keys, runtime data or VCS history.
  const archive = resolve(root, '.admin', 'release.tar');
  const packed = await runner('tar', ['-cf', archive, 'Dockerfile', 'compose.yaml', 'package.json', 'package-lock.json', 'build.mjs', 'src', 'server', 'db', 'scripts'], { cwd: root });
  if (!packed.ok) return { ok: false, output: 'Could not package release.' };
  const stamp = Date.now().toString();
  const dir = target.directory;
  const prepare = await runner('ssh', [...sshArgs(target), 'sh', '-s'], { input: `set -eu\numask 077\nmkdir -p '${dir}/releases/${stamp}'\n` });
  if (!prepare.ok) return { ok: false, output: 'SSH failed. Check the verified host key, agent identity and directory permissions.' };
  const upload = await runner('ssh', [...sshArgs(target), `tar -xf - -C '${dir}/releases/${stamp}'`], { input: await readFile(archive) });
  if (!upload.ok) return { ok: false, output: 'Release upload failed.' };
  const envText = await readFile(resolve(root, '.env'));
  const secretsResult = await runner('ssh', [...sshArgs(target), `umask 077; cat > '${dir}/releases/${stamp}/.env'`], { input: envText });
  if (!secretsResult.ok) return { ok: false, output: 'Configuration transfer failed.' };
  const result = await runner('ssh', [...sshArgs(target), 'sh', '-s'], { timeout: 1800000, input: `set -eu\ncd '${dir}/releases/${stamp}'\nmkdir -p secrets\ndocker compose config -q\ndocker compose up --build -d\nfor attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do\n if docker compose exec -T app node scripts/check-health.mjs; then\n  ln -sfn '${dir}/releases/${stamp}' '${dir}/current'\n  exit 0\n fi\n sleep 5\ndone\nexit 1\n` });
  return { ok: result.ok, output: result.ok ? `Release ${stamp} deployed and health checked. Manage it at ${dir}/current. Previous release directories are retained.` : 'Deployment did not pass health checks. The current pointer was not advanced. Inspect the server before retrying; containers may have changed.' };
}
