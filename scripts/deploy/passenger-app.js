'use strict';

// Stable cPanel startup file. Passenger launches this from the app root.
// The reviewed release is selected only by the protected 'current' symlink.
(async () => {
  const { realpath } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const entry = await realpath(join(process.cwd(), 'current', 'server', 'index.mjs'));
  const { startServer } = await import(pathToFileURL(entry).href);
  const app = await startServer();
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, async () => {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => process.exit(1), 20000).unref();
      try { await app.close(); clearTimeout(timeout); process.exit(0); }
      catch { process.exit(1); }
    });
  }
})().catch(() => {
  // No credentials, filesystem paths or configuration values in public error output.
  console.error('Learning Lab could not start. Check the private server logs.');
  process.exitCode = 1;
});
