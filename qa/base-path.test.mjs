import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../server/config.mjs';
import { appPath } from '../src/base-path.js';

test('mount path is opt-in and rejects unsafe values', () => {
  assert.equal(readConfig({}).basePath, '');
  assert.equal(readConfig({ APP_URL: 'https://alext.io', APP_BASE_PATH: '/learn' }).basePath, '/learn');
  for (const bad of ['/learn/', '//evil', '/../secret', '/a?b', 'http://host', '/learn/%2f']) {
    assert.throws(() => readConfig({ APP_BASE_PATH: bad }));
  }
});

test('browser routes respect the app mount', () => {
  const old = globalThis.document;
  try {
    globalThis.document = { querySelector: () => ({ getAttribute: () => '/learn' }) };
    assert.equal(appPath('/api/session'), '/learn/api/session');
    assert.equal(appPath('/runner.js'), '/learn/runner.js');
    assert.throws(() => appPath('//evil.example'));
  } finally {
    if (old === undefined) delete globalThis.document;
    else globalThis.document = old;
  }
});
