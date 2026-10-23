import {parentPort} from 'node:worker_threads';
globalThis.self=globalThis;
globalThis.postMessage=m=>parentPort.postMessage(m);
await import('../dist/runner.js');
parentPort.on('message',data=>self.onmessage({data}));
