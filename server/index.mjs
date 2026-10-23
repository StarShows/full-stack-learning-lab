import {createReminders} from './reminders.mjs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { readConfig } from './config.mjs';
import { openDatabase } from './database.mjs';
import { createApplication } from './app.mjs';
import { createRateLimiter } from './rate-limit.mjs';

export async function startServer(config = readConfig()) {
  process.umask(0o077);
  const db = openDatabase(config.dbPath);
  const reminders=createReminders({db,config});
  const application = await createApplication({ db, config, reminders });
  const generalLimit = createRateLimiter();
  const authLimit = createRateLimiter({ maximum: 20 });
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const path = new URL(incoming.url, config.origin).pathname;
      if (incoming.headers.host !== new URL(config.origin).host && !['/health/live', '/health/ready'].includes(path)) {
        outgoing.writeHead(421);outgoing.end('Unexpected host.');return;
      }
      const peer = incoming.socket.remoteAddress || 'unknown';
      if (!generalLimit(peer) || (path.startsWith('/auth/') && path !== '/auth/providers' && !authLimit(peer))) {
        outgoing.writeHead(429, { 'Retry-After': '60' });outgoing.end('Too many requests. Please retry shortly.');return;
      }
      const chunks = [];let size = 0;
      const maxBytes = path === '/auth/apple/callback' ? 16384 : 300000;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > maxBytes) { outgoing.writeHead(413, { Connection: 'close' });outgoing.end('Request is too large.');return; }
        chunks.push(chunk);
      }
      const controller = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
      const request = new Request(new URL(incoming.url, config.origin), {
        method: incoming.method, headers: incoming.headers, signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      const result = await application(request);
      for (const [name, value] of result.headers) if (name !== 'set-cookie') outgoing.setHeader(name, value);
      const cookies = result.headers.getSetCookie();if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      outgoing.statusCode = result.status;
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end('Request failed.');
    }
  });
  server.requestTimeout = 30000;server.headersTimeout = 10000;server.maxHeadersCount = 60;
  await new Promise((resolve, reject) => { server.once('error', reject);server.listen(config.port, config.host, resolve); });
  reminders.start();
  return { server, db, async close() { await reminders.close(); server.closeIdleConnections();await new Promise(resolve => server.close(resolve));db.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startServer();
  console.log('Learning lab is listening.');
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;stopping = true;
    const timeout = setTimeout(() => process.exit(1), 20000).unref();
    await app.close();clearTimeout(timeout);process.exit(0);
  });
}
