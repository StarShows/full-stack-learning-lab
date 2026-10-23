import {Worker} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {STARTERS,REFERENCE_MODEL,REFERENCE_ROUTES,REFERENCE_REACT} from '../src/content.js';
const solution={'models/Task.js':REFERENCE_MODEL,'routes/tasks.js':REFERENCE_ROUTES,'client/TaskBoard.jsx':REFERENCE_REACT};
function run(files,stage='all',type='run'){return new Promise((resolve,reject)=>{const w=new Worker(new URL('./worker-host.mjs',import.meta.url));const timer=setTimeout(()=>{w.terminate();reject(Error('Runner timed out'));},18000);w.once('error',reject);w.on('message',result=>{clearTimeout(timer);w.terminate();resolve(result);});w.postMessage({type,stage,files});});}
const full=await run(solution);assert.equal(full.type,'results',full.error);const failures=full.results.filter(r=>!r.passed);console.log('Reference solution:',full.results.length-failures.length+'/'+full.results.length);if(failures.length)console.log(failures);assert.equal(failures.length,0);
const starter=await run(STARTERS);assert.equal(starter.type,'results',starter.error);console.log('Starter:',starter.results.filter(r=>r.passed).length+'/26 passed');assert(starter.results.some(r=>!r.passed));
const syntax=await run({...solution,'models/Task.js':'export default function ( {'},'model');assert(syntax.results.every(r=>!r.passed));console.log('Syntax errors: surfaced for all affected checks');
const badValidation=await run({...solution,'models/Task.js':REFERENCE_MODEL.replace('len:[3,80]','len:[1,100]')},'model');assert(badValidation.results.find(r=>r.index===3)?.passed===false);assert(badValidation.results.find(r=>r.index===4)?.passed===false);console.log('Validation regression: detected');
const badSort=await run({...solution,'routes/tasks.js':REFERENCE_ROUTES.replace("'DESC'","'ASC'")},'api');assert.equal(badSort.results[0].passed,false);console.log('Ordering regression: detected');
const stale=await run({...solution,'client/TaskBoard.jsx':REFERENCE_REACT.replaceAll('if(!cancelled)','if(true)')},'react');assert.equal(stale.results[6].passed,false);console.log('Stale response regression: detected');
const preview=await run(solution,'all','preview');assert.equal(preview.type,'preview',preview.error);assert(JSON.stringify(preview.tree).includes('Review React hooks'));console.log('Interactive preview: tree generated from full-stack solution');
console.log('Behavioral runner QA passed.');
