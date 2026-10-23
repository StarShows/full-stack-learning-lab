import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle} from '../server/progress.mjs';
import {newLearningState} from '../src/learning-state.js';
import {JSDOM,VirtualConsole} from 'jsdom';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../db/migrations/001_progress.sql',import.meta.url),'utf8'));
const env={getUser:r=>{const id=r.headers.get('test-user');return id?{id,email:id+'@example.test',name:id}:null;},DB:{prepare(text){return {bind(...args){return {async first(){return sql.prepare(text).get(...args)||null;}};}};}}};
const origin='https://lab.test';
function req(user,path,method='GET',body,extra={}){return new Request(origin+path,{method,headers:{...(user?{'test-user':user,'test-email':user+'@example.test'}:{}),...(method==='PUT'?{'Origin':origin,'Content-Type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
const call=(...args)=>handle(req(...args),env,{});
assert.equal((await call(null,'/api/progress/learning')).status,401);
assert.equal((await call(null,'/api/progress/learning','PUT',{revision:0,state:newLearningState()})).status,401);
let state=newLearningState();state.xp=20;
let r=await call('alice','/api/progress/learning','PUT',{revision:0,state});assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
r=await call('bob','/api/progress/learning');assert.equal((await r.json()).state,null);
r=await call('alice','/api/progress/learning');assert.equal((await r.json()).state.xp,20);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
assert.equal((await call('alice','/api/progress/learning','PUT',{revision:0,state})).status,409);
assert.equal((await call('alice','/api/progress/learning','PUT',{revision:1,state},{Origin:'https://evil.test'})).status,403);
assert.equal((await call('alice','/api/progress/learning','PUT',{revision:1,state},{Origin:''})).status,403);
assert.equal((await call('alice','/api/progress/learning','PUT',{revision:1,state:{}})).status,400);
assert.equal((await call('alice','/api/progress/learning','PUT',{revision:1,state:{...state,padding:'x'.repeat(300000)}})).status,413);
assert.equal((await call('alice','/api/progress/learning','DELETE')).status,405);
assert.equal((await call('alice','/api/progress/assessment')).status,200);

const {defaultRhythm}=await import('../src/rhythm.js');
const preference={...defaultRhythm(),timezone:'UTC',sound:true};
assert.equal((await call('rhythm-user','/api/progress/engagement','PUT',{revision:0,state:preference})).status,200);
assert.equal((await (await call('another-user','/api/progress/engagement')).json()).state,null);
assert.equal((await call('rhythm-user','/api/progress/engagement','PUT',{revision:1,state:{...preference,hour:3}})).status,400);

const bundle=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function open(user,legacy,failWrites=false){const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM('<div id="root"></div>',{url:origin,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.AbortController=AbortController;let fail=failWrites;w.fetch=async(path,options={})=>{if(path==='/auth/providers')return Response.json({google:true,apple:true});if(fail&&options.method==='PUT')throw Error('Connection interrupted');if(path==='/api/tutor'){const sent=JSON.parse(options.body);assert.equal(sent.lessonId,'names');assert.equal(sent.question,'Explain const');return Response.json({answer:'Use <script> as plain text, not markup.'});}const headers={...options.headers,...(options.method==='PUT'?{Origin:origin}:{}),...(user?{'test-user':user,'test-email':user+'@example.test'}:{})};return handle(new Request(origin+path,{...options,headers}),env,{});};if(legacy)w.localStorage.setItem('alex-fullstack-learn-v1',JSON.stringify(legacy));w.eval(bundle);await wait(100);return {w,dom,errors,recover:()=>{fail=false;},text:()=>w.document.body.textContent,click:async(label)=>{const b=[...w.document.querySelectorAll('button')].find(b=>b.textContent.includes(label));assert(b,'Missing button '+label);b.click();await wait(50);}};}
let page=await open(null);assert(page.text().includes('Continue with Google'));assert(page.text().includes('Continue with Apple'));assert.equal(page.w.document.querySelector('a').target,'_top');assert(!page.text().includes('Start my first lesson'));page.dom.window.close();
page=await open('charlie');assert(page.text().includes('Start my first lesson'));await page.click('Learning rhythm');assert(page.w.document.querySelector('dialog').open);const toggles=[...page.w.document.querySelectorAll('.rhythm-toggle input')];assert.equal(toggles[0].checked,false);assert.equal(toggles[1].checked,false);assert.equal(toggles[3].checked,false);toggles[1].click();await wait(30);assert.equal(page.w.document.documentElement.dataset.calm,'true');await page.click('Back to learning →');assert.equal(page.w.document.querySelector('dialog').open,false);await page.click('Start my first lesson');await wait(900);let saved=await (await call('charlie','/api/progress/learning')).json();assert.equal(saved.state.view,'lesson');assert.equal(saved.state.activeLesson,'names');assert.deepEqual(page.errors,[]);page.dom.window.close();
page=await open('charlie');assert(page.text().includes('Save & leave'));assert(page.text().includes('Give a value a name'));
await page.click('Chat about this lesson');
const question=page.w.document.querySelector('#tutor-question');
Object.getOwnPropertyDescriptor(page.w.HTMLTextAreaElement.prototype,'value').set.call(question,'Explain const');
question.dispatchEvent(new page.w.Event('input',{bubbles:true}));await wait(30);
await page.click('Send message');assert(page.text().includes('Use <script> as plain text, not markup.'));assert.equal(page.w.document.querySelectorAll('.local-tutor script').length,0);
page.dom.window.close();
const old={...newLearningState(),xp:60};page=await open('dana',old);assert(page.text().includes('Bring your earlier progress'));await page.click('Import my browser progress');assert.equal((await (await call('dana','/api/progress/learning')).json()).state.xp,60);assert.deepEqual(page.errors,[]);page.dom.window.close();
page=await open('erin',null,true);await wait(900);assert(page.text().includes('Retry save'));page.recover();await page.click('Retry save');assert(page.text().includes('All progress saved'));assert.deepEqual(page.errors,[]);page.dom.window.close();
console.log('Account API and UI: identity isolation, persistence, conflict, CSRF, validation, sign-in, import and retry passed.');
