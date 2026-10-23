import { readFile } from 'node:fs/promises';
import { createAuth } from './auth.mjs';
import { createTutor } from './tutor.mjs';
import { progressAdapter } from './database.mjs';
import { handle as progress } from './progress.mjs';

const defaultCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://appleid.apple.com";
export async function createApplication({ db, config, auth: suppliedAuth, tutor: suppliedTutor, dist = new URL('../dist/', import.meta.url) }) {
  const auth = suppliedAuth || createAuth({ db, config });
  const tutor = suppliedTutor || createTutor({ config });
  const assets = {};
  for (const [path, file, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript; charset=utf-8'], ['/app.css', 'app.css', 'text/css; charset=utf-8'], ['/runner.js', 'runner.js', 'text/javascript; charset=utf-8']]) {
    assets[path] = { body: await readFile(new URL(file, dist), 'utf8'), type };
  }
  const env = { DB: progressAdapter(db), getUser: request => auth.getUser(request) };
  async function route(request) {
    const path = new URL(request.url).pathname;
    if (path === '/health/live' || path === '/health/ready') {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      if (path.endsWith('ready')) db.prepare('SELECT 1').get();
      return Response.json({ ok: true });
    }
    if (path.startsWith('/auth/')) return await auth.handle(request) || new Response('Not found', { status: 404 });
    if (path === '/api/tutor' || path === '/api/tutor/status') {
      const user = auth.getUser(request);
      if (!user) return Response.json({ error: 'Sign in to use the local tutor.' }, { status: 401 });
      if (path.endsWith('/status') && request.method === 'GET') return Response.json({ ready: await tutor.status(), model: config.llmModel || config.model, local: config.llmMode !== 'token' });
      if (request.method !== 'POST' || path !== '/api/tutor') return new Response('Method not allowed', { status: 405 });
      if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Invalid origin', { status: 403 });
      if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response('JSON required', { status: 415 });
      let input;try { input = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      return tutor.ask(user, input, request.signal);
    }
    return progress(request, env, assets);
  }
  return async request => {
    let result;
    try { result = await route(request); }
    catch { result = Response.json({ error: 'The service is temporarily unavailable. Please retry.' }, { status: 503 }); }
    const headers = new Headers(result.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Security-Policy', new URL(request.url).pathname === '/runner.js' ? "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'" : defaultCsp);
    if (config.secure) headers.set('Strict-Transport-Security', 'max-age=31536000');
    return new Response(result.body, { status: result.status, headers });
  };
}
