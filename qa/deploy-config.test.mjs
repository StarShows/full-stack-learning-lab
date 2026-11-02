import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

test('Namecheap workflow is valid YAML, read-only and main-branch gated', () => {
  const filename = new URL('../.github/workflows/deploy-namecheap.yml', import.meta.url);
  const parsed = YAML.parseDocument(readFileSync(filename, 'utf8'), { uniqueKeys: true });
  assert.deepEqual(parsed.errors, []);
  const workflow = parsed.toJS();
  assert.ok(workflow.on.push.branches.includes('main'));
  assert.equal(workflow.permissions.contents, 'read');
  assert.match(workflow.jobs.release.if, /refs\/heads\/main/);
  assert.match(workflow.jobs.release.if, /NC_LAB_AUTO_DEPLOY/);
  const job = workflow.jobs.release;
  assert.equal(job.environment.name, 'production');
  assert.ok(job.steps.some(s => s.name.includes('Verify public HTTPS')));
});

test('cPanel startup and remote deployment scripts have safe paths', () => {
  const remote = readFileSync(new URL('../scripts/deploy/namecheap-remote.sh', import.meta.url), 'utf8');
  const startup = readFileSync(new URL('../scripts/deploy/passenger-app.js', import.meta.url), 'utf8');
  assert.ok(remote.includes('state_root="$HOME/.learning-lab"'));
  assert.ok(remote.includes('"$state_root/backups"'));
  assert.match(remote, /sha256sum -c/);
  assert.match(remote, /npm ci --omit=dev --ignore-scripts/);
  assert.match(remote, /tmp\/restart\.txt/);
  assert.match(remote, /production-ready/);
  assert.match(remote, /\.activated/);
  assert.match(remote, /grep -qvE/);
  assert.match(startup, /current.*server/);
});
