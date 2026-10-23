import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readSettings, redactSettings, saveSettings, operation, deploy } from './operations.mjs';

export async function startAdmin({ root = fileURLToPath(new URL('../', import.meta.url)), port = 13001, token = randomBytes(32).toString('hex') } = {}) {
  process.umask(0o077);
  await mkdir(resolve(root, '.admin'), { recursive: true, mode: 0o700 });
  let job = null;const plans = new Map();const expires = Date.now() + 8 * 3600000;
  const equal = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');res.setHeader('X-Content-Type-Options', 'nosniff');res.setHeader('Referrer-Policy', 'no-referrer');res.setHeader('X-Frame-Options', 'DENY');res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' });res.end(JSON.stringify(body)); };
    try {
      if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(origin).host || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Local access only.' });
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && files[req.url]) { const [file, type] = files[req.url];res.writeHead(200, { 'Content-Type': type });return res.end(await readFile(new URL(file, import.meta.url))); }
      if (!equal(req.headers.authorization?.replace(/^Bearer /, '')) || Date.now() > expires) return send(401, { error: 'Enter the current terminal access token. Restart the console after eight hours.' });
      if (req.method === 'GET' && req.url === '/api/state') return send(200, { settings: redactSettings(await readSettings(root)), job });
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Same-origin JSON required.' });
      let raw = '';for await (const chunk of req) { raw += chunk;if (Buffer.byteLength(raw) > 64000) return send(413, { error: 'Request too large.' }); }
      const body = JSON.parse(raw);
      if (job?.status === 'running') return send(409, { error: 'An operation is already running.' });
      if (req.url === '/api/settings') return send(200, await saveSettings(root, body));
      if (req.url === '/api/plan') {
        if (!['test', 'build', 'validate', 'check', 'status', 'restart', 'stop', 'health', 'model', 'deploy'].includes(body.action)) throw Error('Unknown action.');
        if (body.target) { const { validateTarget } = await import('./operations.mjs');validateTarget(body.target); }
        if (body.action === 'deploy' && !body.target) throw Error('Deployment requires an SSH destination.');
        const id = randomBytes(20).toString('hex');plans.clear();plans.set(id, { action: body.action, target: body.target || null, expires: Date.now() + 120000 });
        return send(200, { id, summary: `${body.action} on ${body.target ? `${body.target.user}@${body.target.host}:${body.target.directory}` : 'this machine'}. ${body.action === 'deploy' ? 'Transfers source and private configuration; rebuilds and replaces running containers. Existing database volumes are retained.' : ''}` });
      }
      if (req.url === '/api/execute') {
        const plan = plans.get(body.id);plans.delete(body.id);
        if (!plan || plan.expires < Date.now()) return send(409, { error: 'Plan expired or already used. Review again.' });
        job = { action: plan.action, status: 'running', started: new Date().toISOString() };
        send(202, { ok: true });
        (async () => {
          try {
            const result = plan.action === 'deploy' ? await deploy(root, plan.target) : await operation(root, plan.action, plan.target);
            let output = result.output || '';
            const settings = await readSettings(root);
            for (const [key, value] of Object.entries(settings)) if (/SECRET|TOKEN|PRIVATE_KEY/.test(key) && value) output = output.split(value).join('[redacted]');
            job = { ...job, status: result.ok ? 'passed' : 'failed', output };
          } catch { job = { ...job, status: 'failed', output: 'Operation failed. Check configuration, verified SSH access and server prerequisites.' }; }
          await appendFile(resolve(root, '.admin/audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: plan.action, host: plan.target?.host || 'local', status: job.status }) + '\n', { mode: 0o600 });
        })().catch(() => {});return;
      }
      send(404, { error: 'Not found.' });
    } catch (e) { send(400, { error: e.message?.includes('configuration') ? e.message : 'Invalid request or configuration. Check the wizard values.' }); }
  });
  server.headersTimeout = 10000;server.requestTimeout = 15000;
  await new Promise(resolveReady => server.listen(port, '127.0.0.1', resolveReady));
  return { server, token };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, token } = await startAdmin();
  console.log(`Local administration: http://127.0.0.1:${server.address().port}\nAccess token (expires in 8 hours): ${token}\nKeep this terminal private. Stop with Ctrl+C. Never proxy or expose this port.`);
}
