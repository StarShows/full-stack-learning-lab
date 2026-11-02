import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../server/config.mjs';
import { startServer } from '../server/index.mjs';

test('the same application serves pages, API and assets at /learn', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'learn-mount-'));
  let app;
  try {
    const config = {
      ...readConfig({ APP_URL: 'https://alext.io', APP_BASE_PATH: '/learn' }),
      dbPath: join(directory, 'lab.sqlite'), port: 0, host: '127.0.0.1'
    };
    app = await startServer(config);
    const port = app.server.address().port;
    const request = path => fetch('http://127.0.0.1:' + port + path, {
      headers: { host: 'alext.io' }, signal: AbortSignal.timeout(5000)
    });
    const homepage = await request('/learn/');
    assert.equal(homepage.status, 200);
    const html = await homepage.text();
    assert.match(html, /content="\/learn"/);
    assert.match(html, /src="\/learn\/app\.js"/);
    assert.match(html, /href="\/learn\/app\.css"/);
    assert.equal((await request('/learn/runner.js')).status, 200);
    assert.equal((await request('/learn/auth/providers')).status, 200);
    assert.equal((await request('/learn/api/session')).status, 401);
    assert.equal((await (await request('/learn/health/ready')).json()).ok, true);
    const manifest = await (await request('/learn/manifest.webmanifest')).json();
    assert.equal(manifest.scope, '/learn/');
    assert.equal(manifest.start_url, '/learn/');
  } finally {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
