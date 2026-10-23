import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, exportPKCS8, createLocalJWKSet, SignJWT, jwtVerify } from 'jose';
import { parse } from 'yaml';
import { readConfig } from '../server/config.mjs';
import { openDatabase } from '../server/database.mjs';
import { createAuth, hash, verifyIdentity } from '../server/auth.mjs';
import { createApplication } from '../server/app.mjs';
import { createTutor } from '../server/tutor.mjs';
import { createRateLimiter } from '../server/rate-limit.mjs';
import { startServer } from '../server/index.mjs';

const origin = 'https://lab.example.test';
const identityKeys = await generateKeyPair('RS256');
const jwk = await exportJWK(identityKeys.publicKey);jwk.kid = 'identity-key';
const resolver = createLocalJWKSet({ keys: [jwk] });
const appleKeys = await generateKeyPair('ES256', { extractable: true });
const applePrivate = await exportPKCS8(appleKeys.privateKey);
const config = readConfig({ APP_URL: origin, GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'test-only-secret', APPLE_CLIENT_ID: 'apple-client', APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key', APPLE_PRIVATE_KEY: applePrivate });
async function signed(provider, nonce, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ nonce, email: 'learner@example.test', email_verified: true, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(provider === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com')
    .setAudience(config[provider].clientId).setSubject('same-subject')
    .setIssuedAt(now).setExpirationTime(now + 300).sign(identityKeys.privateKey);
}
function cookies(response) { return response.headers.getSetCookie().map(s => s.split(';')[0]).join('; '); }
function fixture() {
  const db = openDatabase(':memory:');let flowNonce = '', exchanges = 0;
  const auth = createAuth({ db, config, verify: (provider, encoded, nonce, id) => verifyIdentity(provider, encoded, nonce, id, resolver),
    fetcher: async (url, options) => {
      exchanges++;
      const provider = url.includes('appleid') ? 'apple' : 'google';
      assert.equal(options.body.get('redirect_uri'), origin + `/auth/${provider}/callback`);
      if (provider === 'google') assert(options.body.get('code_verifier'));
      else {
        const { payload } = await jwtVerify(options.body.get('client_secret'), appleKeys.publicKey, { issuer: 'team', subject: 'apple-client', audience: 'https://appleid.apple.com', algorithms: ['ES256'] });
        assert(payload.exp - payload.iat <= 300);
      }
      return Response.json({ id_token: await signed(provider, flowNonce) });
    },
  });
  async function login(provider = 'google') {
    const begin = await auth.handle(new Request(origin + '/auth/' + provider));
    const location = new URL(begin.headers.get('location'));flowNonce = location.searchParams.get('nonce');
    if (provider === 'google') { assert(location.searchParams.get('code_challenge'));assert.equal(location.searchParams.get('code_challenge_method'), 'S256'); }
    if (provider === 'apple') assert(begin.headers.get('set-cookie').includes('SameSite=None'));
    const params = new URLSearchParams({ state: location.searchParams.get('state'), code: 'single-use-code' });
    const request = () => new Request(origin + `/auth/${provider}/callback` + (provider === 'google' ? '?' + params : ''), {
      method: provider === 'google' ? 'GET' : 'POST', headers: { Cookie: cookies(begin), ...(provider === 'apple' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(provider === 'apple' ? { body: params.toString() } : {}),
    });
    const response = await auth.handle(request());
    return { begin, response, request, session: cookies(response) };
  }
  return { db, auth, login, exchanges: () => exchanges };
}

test('configuration rejects public HTTP, incomplete providers, cloud models and remote inference', () => {
  assert.throws(() => readConfig({ APP_URL: 'http://lab.example.test' }));
  assert.throws(() => readConfig({ GOOGLE_CLIENT_ID: 'incomplete' }));
  assert.throws(() => readConfig({ OLLAMA_URL: 'https://external.example.test' }));
  assert.throws(() => readConfig({ OLLAMA_MODEL: 'qwen:cloud' }));
  assert.throws(() => readConfig({ APPLE_CLIENT_ID: 'apple', APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key', APPLE_PRIVATE_KEY: applePrivate }));
  assert.equal(readConfig({}).origin, 'http://localhost:13000');
});

test('signed identity tokens require valid signature, nonce, audience, issuer and expiry', async () => {
  const good = await signed('google', 'expected');
  assert.equal((await verifyIdentity('google', good, 'expected', 'google-client', resolver)).sub, 'same-subject');
  await assert.rejects(verifyIdentity('google', good, 'wrong', 'google-client', resolver));
  await assert.rejects(verifyIdentity('google', good, 'expected', 'other-client', resolver));
  await assert.rejects(verifyIdentity('apple', good, 'expected', 'google-client', resolver));
  const badEmail = await signed('google', 'expected', { email_verified: false });
  await assert.rejects(verifyIdentity('google', badEmail, 'expected', 'google-client', resolver));
  const expired = await new SignJWT({ nonce: 'expected' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer('https://accounts.google.com').setAudience('google-client').setSubject('subject').setIssuedAt(1).setExpirationTime(2).sign(identityKeys.privateKey);
  await assert.rejects(verifyIdentity('google', expired, 'expected', 'google-client', resolver));
  const otherKey = await generateKeyPair('RS256');
  const otherResolver = createLocalJWKSet({ keys: [{ ...await exportJWK(otherKey.publicKey), kid: jwk.kid }] });
  await assert.rejects(verifyIdentity('google', good, 'expected', 'google-client', otherResolver));
});

test('Google code flow creates an opaque session, rejects replay and never trusts user headers', async () => {
  const f = fixture();try {
    const flow = await f.login();assert.equal(flow.response.headers.get('location'), '/');
    const user = f.auth.getUser(new Request(origin, { headers: { Cookie: flow.session } }));assert(user?.id);
    assert(flow.session.includes('__Host-lab_session='));
    assert.equal(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash.length, 64);
    assert(!flow.session.includes(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash));
    assert.equal(f.auth.getUser(new Request(origin, { headers: { 'authenticated-user-id': user.id } })), null);
    const replay = await f.auth.handle(flow.request());assert(replay.headers.get('location').includes('invalid_state'));
    assert.equal(f.exchanges(), 1);
    const app = await createApplication({ db: f.db, config, auth: f.auth, tutor: { ask() { throw Error('not called'); }, status: async () => false } });
    let response = await app(new Request(origin + '/api/session', { headers: { 'authenticated-user-id': user.id } }));assert.equal(response.status, 401);
    response = await app(new Request(origin + '/api/session', { headers: { Cookie: flow.session } }));assert.equal((await response.json()).user.id, user.id);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const logout = await f.auth.handle(new Request(origin + '/auth/logout', { method: 'POST', headers: { Cookie: flow.session, Origin: origin } }));assert.equal(logout.status, 200);
    assert.equal(f.auth.getUser(new Request(origin, { headers: { Cookie: flow.session } })), null);
  } finally { f.db.close(); }
});

test('Apple form-post exchanges a signed client secret and keeps provider identities separate', async () => {
  const f = fixture();try {
    const google = await f.login('google'), apple = await f.login('apple');
    assert.equal(apple.response.headers.get('location'), '/');
    assert.notEqual(f.auth.getUser(new Request(origin, { headers: { Cookie: google.session } })).id, f.auth.getUser(new Request(origin, { headers: { Cookie: apple.session } })).id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
    const denied = await f.auth.handle(new Request(origin + '/auth/logout', { method: 'POST', headers: { Cookie: apple.session, Origin: 'https://other.test' } }));assert.equal(denied.status, 403);
  } finally { f.db.close(); }
});

test('login transaction requires its browser cookie and expires', async () => {
  const f = fixture();try {
    const begin = await f.auth.handle(new Request(origin + '/auth/google'));
    const location = new URL(begin.headers.get('location')), state = location.searchParams.get('state');
    let r = await f.auth.handle(new Request(origin + '/auth/google/callback?state=' + state + '&code=x'));
    assert(r.headers.get('location').includes('invalid_state'));assert.equal(f.exchanges(), 0);
    f.db.prepare('UPDATE oauth_transactions SET expires_at=0').run();
    r = await f.auth.handle(new Request(origin + '/auth/google/callback?state=' + state + '&code=x', { headers: { Cookie: cookies(begin) } }));
    assert(r.headers.get('location').includes('invalid_state'));assert.equal(f.exchanges(), 0);
  } finally { f.db.close(); }
});

test('expired sessions cannot authenticate and database migrations survive reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lab-db-'));
  try {
    const filename = join(directory, 'lab.sqlite');let db = openDatabase(filename);
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('learner', 'google', 'id', 'learner@example.test', 'Learner', 1);
    const auth = createAuth({ db, config });const session = auth.issueSession('learner').split(';')[0];
    db.close();db = openDatabase(filename);
    assert(createAuth({ db, config }).getUser(new Request(origin, { headers: { Cookie: session } })));
    db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal(createAuth({ db, config }).getUser(new Request(origin, { headers: { Cookie: session } })), null);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('tutor uses only the local native API, enforces limits, and handles unavailable models', async () => {
  let captured;const tutor = createTutor({ config, fetcher: async (url, options) => { captured = { url, body: JSON.parse(options.body) };return Response.json({ message: { content: 'One small hint.' } }); } });
  const input = { lessonId: 'names', code: 'const x = 1;', question: 'What is const?' };
  let r = await tutor.ask({ id: 'learner' }, input);assert.equal(r.status, 200);assert.equal((await r.json()).answer, 'One small hint.');
  assert.equal(captured.url, 'http://ollama:11434/api/chat');assert.equal(captured.body.stream, false);assert.equal(captured.body.tools, undefined);
  assert.equal((await tutor.ask({ id: 'learner' }, { ...input, lessonId: 'unknown' })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await tutor.ask({ id: 'learner' }, input)).status, 200);
  assert.equal((await tutor.ask({ id: 'learner' }, input)).status, 429);
  const unavailable = createTutor({ config, fetcher: async () => { throw Error('offline'); } });
  assert.equal((await unavailable.ask({ id: 'learner' }, input)).status, 503);
  const limit = createRateLimiter({ maximum: 1 });assert(limit('peer'));assert(!limit('peer'));
});

test('HTTP server enforces sessions, host checks, payload limits and runner network policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lab-http-'));
  const localConfig = { ...readConfig({}), port: 0, dbPath: join(directory, 'lab.sqlite') };
  const app = await startServer(localConfig);
  try {
    const port = app.server.address().port, base = 'http://127.0.0.1:' + port;
    localConfig.origin = base;
    const headers = {};
    assert.equal((await fetch(base + '/health/ready')).status, 200);
    assert.equal((await fetch(base + '/api/session', { headers })).status, 401);
    assert.equal((await fetch(base + '/api/session', { headers: { ...headers, 'authenticated-user-id': 'fake' } })).status, 401);
    const invalidHost = await new Promise(resolve => { http.get(base + '/', { headers: { Host: 'untrusted.test' } }, r => { r.resume();resolve(r.statusCode); }); });
    assert.equal(invalidHost, 421);
    const runner = await fetch(base + '/runner.js', { headers });assert(runner.headers.get('content-security-policy').includes("connect-src 'none'"));
    const oversized = await fetch(base + '/api/progress/learning', { method: 'PUT', headers, body: 'x'.repeat(300001) });assert.equal(oversized.status, 413);
    const tutor = await fetch(base + '/api/tutor', { method: 'POST', headers, body: '{}' });assert.equal(tutor.status, 401);
    const providers = await fetch(base + '/auth/providers', { headers });assert.deepEqual(await providers.json(), { google: false, apple: false });
  } finally { await app.close();rmSync(directory, { recursive: true, force: true }); }
});

test('container configuration keeps inference private and persists only declared data', () => {
  const compose = parse(readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8'));
  assert.equal(compose.networks.inference.internal, true);
  assert.equal(compose.services.ollama.ports, undefined);
  assert.deepEqual(compose.services.ollama.networks, ['inference']);
  assert.equal(compose.services.ollama.environment.OLLAMA_NO_CLOUD, '1');
  assert.equal(compose.services.app.read_only, true);
  assert(compose.services.app.volumes.includes('lab-data:/data'));
  assert.equal(compose.services.ollama.depends_on['model-pull'].condition, 'service_completed_successfully');
});
