import { readFileSync } from 'node:fs';

function secret(env, key) {
  if (env[key] && env[key + '_FILE']) throw new Error(`Set ${key} or ${key}_FILE, not both.`);
  return env[key + '_FILE'] ? readFileSync(env[key + '_FILE'], 'utf8').trim() : env[key] || '';
}
export function readConfig(env = process.env) {
  const url = new URL(env.APP_URL || 'http://localhost:13000');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('APP_URL must be an HTTPS origin, or HTTP on localhost for development.');
  }
  const ollama = new URL(env.OLLAMA_URL || 'http://ollama:11434');
  if (!['http:', 'https:'].includes(ollama.protocol) || ollama.username || ollama.password ||
      !['localhost', '127.0.0.1', '[::1]', 'ollama', 'host.docker.internal'].includes(ollama.hostname) ||
      ollama.pathname !== '/' || ollama.search || ollama.hash) {
    throw new Error('OLLAMA_URL must point to the local Ollama service.');
  }
  const appleKey = secret(env, 'APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const google = { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: secret(env, 'GOOGLE_CLIENT_SECRET') };
  const apple = { clientId: env.APPLE_CLIENT_ID || '', teamId: env.APPLE_TEAM_ID || '', keyId: env.APPLE_KEY_ID || '', privateKey: appleKey };
  const googleConfigured = Boolean(google.clientId && google.clientSecret);
  const appleConfigured = Boolean(apple.clientId && apple.teamId && apple.keyId && apple.privateKey);
  if (Boolean(google.clientId || google.clientSecret) && !googleConfigured) throw new Error('Google OAuth configuration is incomplete.');
  if (Boolean(apple.clientId || apple.teamId || apple.keyId || apple.privateKey) && !appleConfigured) throw new Error('Apple OAuth configuration is incomplete.');
  if (appleConfigured && (url.protocol !== 'https:' || loopback || /^\d+(\.\d+){3}$/.test(url.hostname))) {
    throw new Error('Apple sign-in requires a registered HTTPS domain, not localhost or an IP address.');
  }
  const model = env.OLLAMA_MODEL || 'qwen2.5-coder:3b';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,100}$/.test(model) || (model.includes('..') || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(model))) throw new Error('Invalid model name.');
  return {
    origin: url.origin, secure: url.protocol === 'https:', google, apple,
    providers: { google: googleConfigured, apple: appleConfigured },
    dbPath: env.DATABASE_PATH || './data/lab.sqlite',
    port: Number(env.PORT || 13000), host: env.BIND_ADDRESS || '127.0.0.1',
    ollamaUrl: ollama.origin, model,
  };
}
