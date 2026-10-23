import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function cookieValue(request, name) {
  return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
}
const providers = {
  google: { authorization: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', issuer: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { authorization: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', issuer: 'https://appleid.apple.com', jwks: 'https://appleid.apple.com/auth/keys' },
};
const keys = Object.fromEntries(Object.entries(providers).map(([name, p]) => [name, createRemoteJWKSet(new URL(p.jwks), { timeoutDuration: 10000 })]));
export async function verifyIdentity(provider, encoded, nonce, clientId, resolver = keys[provider]) {
  const { payload } = await jwtVerify(encoded, resolver, {
    issuer: providers[provider].issuer, audience: clientId, algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp', 'nonce'], maxTokenAge: '10 minutes', clockTolerance: 5,
  });
  if (!equal(payload.nonce, nonce) || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new Error('Invalid identity token.');
  if (payload.azp && payload.azp !== clientId) throw new Error('Invalid authorized party.');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new Error('Ambiguous token audience.');
  if (payload.email && ![true, 'true'].includes(payload.email_verified)) throw new Error('Email is not verified.');
  return payload;
}
export function createAuth({ db, config, fetcher = fetch, verify = verifyIdentity }) {
  const sessionName = config.secure ? '__Host-lab_session' : 'lab_session';
  const flowName = config.secure ? '__Host-lab_flow' : 'lab_flow';
  const cookie = (name, value, seconds, sameSite = 'Lax') => `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${seconds}${config.secure ? '; Secure' : ''}`;
  const redirect = (location, cookies = []) => {
    const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    cookies.forEach(c => headers.append('Set-Cookie', c));
    return new Response(null, { status: 303, headers });
  };
  function cleanup() {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ?').run(now);
  }
  function getUser(request) {
    const session = cookieValue(request, sessionName);
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) return null;
    const row = db.prepare(`SELECT u.id, u.email, u.display_name AS name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(session), Date.now());
    return row || null;
  }
  function issueSession(userId, oldToken = '') {
    if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(oldToken));
    const raw = token();
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(raw), userId, Date.now() + SESSION_SECONDS * 1000);
    return cookie(sessionName, raw, SESSION_SECONDS);
  }
  async function clientSecret(provider) {
    if (provider === 'google') return config.google.clientSecret;
    const a = config.apple;
    const key = await importPKCS8(a.privateKey, 'ES256');
    return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: a.keyId })
      .setIssuer(a.teamId).setSubject(a.clientId).setAudience('https://appleid.apple.com')
      .setIssuedAt().setExpirationTime('5m').sign(key);
  }
  async function handle(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/auth/providers' && request.method === 'GET') return Response.json(config.providers, { headers: { 'Cache-Control': 'no-store' } });
    if (path === '/auth/logout') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Invalid origin', { status: 403 });
      const raw = cookieValue(request, sessionName);
      if (raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(raw));
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie(sessionName, '', 0), 'Cache-Control': 'no-store' } });
    }
    const match = /^\/auth\/(google|apple)(\/callback)?$/.exec(path);
    if (!match) return null;
    const provider = match[1], callback = Boolean(match[2]);
    if (!config.providers[provider]) return new Response('This sign-in provider is not configured.', { status: 503 });
    const settings = config[provider], endpoints = providers[provider];
    const callbackUrl = config.origin + `/auth/${provider}/callback`;
    cleanup();
    if (!callback) {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const state = token(), browser = token(), nonce = token(), verifier = token();
      db.prepare('INSERT INTO oauth_transactions VALUES (?,?,?,?,?,?)').run(hash(state), provider, nonce, verifier, hash(browser), Date.now() + FLOW_SECONDS * 1000);
      const target = new URL(endpoints.authorization);
      const params = { client_id: settings.clientId, redirect_uri: callbackUrl, response_type: 'code', state, nonce,
        scope: provider === 'google' ? 'openid email profile' : 'name email' };
      if (provider === 'google') Object.assign(params, { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      if (provider === 'apple') params.response_mode = 'form_post';
      target.search = new URLSearchParams(params).toString();
      return redirect(target.toString(), [cookie(flowName, browser, FLOW_SECONDS, provider === 'apple' ? 'None' : 'Lax')]);
    }
    if (request.method !== (provider === 'apple' ? 'POST' : 'GET')) return new Response('Method not allowed', { status: 405 });
    if (provider === 'apple' && !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Invalid callback', { status: 415 });
    const values = provider === 'apple' ? new URLSearchParams(await request.text()) : url.searchParams;
    const state = values.get('state') || '', browser = cookieValue(request, flowName);
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return redirect('/?auth_error=invalid_state');
    // Consume a flow once, bound to both the originating browser and provider.
    const flow = db.prepare('DELETE FROM oauth_transactions WHERE state_hash=? AND provider=? AND browser_hash=? AND expires_at>? RETURNING *').get(hash(state), provider, hash(browser), Date.now());
    const clear = cookie(flowName, '', 0, provider === 'apple' ? 'None' : 'Lax');
    if (!flow) return redirect('/?auth_error=invalid_state', [clear]);
    if (values.has('error') || !values.get('code')) return redirect('/?auth_error=cancelled', [clear]);
    try {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: values.get('code'), redirect_uri: callbackUrl, client_id: settings.clientId, client_secret: await clientSecret(provider) });
      if (provider === 'google') body.set('code_verifier', flow.verifier);
      const exchange = await fetcher(endpoints.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!exchange.ok) throw new Error('Token exchange failed.');
      const result = await exchange.json();
      const identity = await verify(provider, result.id_token, flow.nonce, settings.clientId);
      const email = typeof identity.email === 'string' ? identity.email.slice(0, 254) : '';
      const name = typeof identity.name === 'string' ? identity.name.slice(0, 120) : email || `${provider} learner`;
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?) ON CONFLICT(provider,provider_subject) DO UPDATE SET email=CASE WHEN excluded.email <> \'\' THEN excluded.email ELSE users.email END').run(randomUUID(), provider, identity.sub, email, name, Date.now());
      // Email addresses never link identities across providers implicitly.
      const user = db.prepare('SELECT id FROM users WHERE provider=? AND provider_subject=?').get(provider, identity.sub);
      return redirect('/', [clear, issueSession(user.id, cookieValue(request, sessionName))]);
    } catch {
      // Do not log codes, identity tokens, provider responses, or secrets.
      return redirect('/?auth_error=signin_failed', [clear]);
    }
  }
  return { getUser, handle, issueSession, sessionName, cleanup };
}
