import React from 'react';
import TestRenderer from 'react-test-renderer';
import * as Babel from '@babel/standalone';
import {REFERENCE_MODEL,REFERENCE_ROUTES,STAGES} from './content.js';
import {getLesson} from './lessons.js';
const {act,create}=TestRenderer;
const Op={like:Symbol.for('like'),iLike:Symbol.for('iLike')};
const DataTypes={STRING:'STRING',BOOLEAN:'BOOLEAN',INTEGER:'INTEGER',TEXT:'TEXT',ENUM:(...values)=>({kind:'ENUM',values})};
let logs=[]; const originalConsole={...console};
for(const kind of ['log','warn','error']) console[kind]=(...a)=>{if(logs.length<30)logs.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,500));};
// Practice code has no reason to make network requests. The injected api stays in memory.
self.fetch=()=>Promise.reject(new Error('Network unavailable in practice harness. Use the injected api.'));
self.WebSocket=undefined;self.XMLHttpRequest=undefined;self.importScripts=()=>{throw Error('External imports are disabled.');};
const assert=(condition,msg='Expectation failed')=>{if(!condition)throw Error(msg);};
const eq=(a,b,msg)=>assert(JSON.stringify(a)===JSON.stringify(b),msg||`Expected ${JSON.stringify(b)}, received ${JSON.stringify(a)}`);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const timeout=(p,ms=1500)=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('Async operation exceeded 1.5s. Resolve or reject every API call.')),ms))]);
let compiled={};
function load(source){
  let code=compiled[source];
  if(!code)code=compiled[source]=Babel.transform(source,{presets:[['react',{runtime:'classic'}]],plugins:['transform-modules-commonjs'],filename:'practice.jsx'}).code;
  const module={exports:{}};
  const req=name=>{if(name==='react')return React;if(name==='express')return express;if(name==='sequelize')return{DataTypes,Op};throw Error(`Unsupported import: ${name}. Use only react, express or sequelize.`);};
  new Function('require','module','exports',code)(req,module,module.exports);
  assert(typeof module.exports.default==='function','The file must export a default function.');return module.exports.default;
}
function database(source){
 let rows=[],id=0,attrs={};
 const validate=values=>{
  for(const[k,spec]of Object.entries(attrs)){
   const s=typeof spec==='object'?spec:{type:spec},v=values[k];
   if(s.allowNull===false&&(v===null||v===undefined))throw Error(`${k} cannot be null`);
   if(v==null)continue;
   if(s.type==='STRING'&&typeof v!=='string')throw Error(`${k} must be a string`);
   if(s.type==='BOOLEAN'&&typeof v!=='boolean')throw Error(`${k} must be boolean`);
   if(s.validate?.notEmpty&&(typeof v!=='string'||!v.trim()))throw Error(`${k} cannot be empty`);
   if(s.validate?.len&&(v.length<s.validate.len[0]||v.length>s.validate.len[1]))throw Error(`${k} length invalid`);
   if(s.type?.kind==='ENUM'&&!s.type.values.includes(v))throw Error(`${k} is not an allowed enum value`);
  }
 };
 const instance=row=>Object.assign({},row,{toJSON(){return{...row};},get(){return{...row};},async update(patch){const next={...row,...patch};validate(next);Object.assign(row,patch);Object.assign(this,row);return this;},async save(){validate(this);for(const k of Object.keys(row))row[k]=this[k];return this;}});
 const Task={async create(input){const values={};for(const[k,s]of Object.entries(attrs))if(s.defaultValue!==undefined)values[k]=s.defaultValue;Object.assign(values,input);validate(values);const row={id:++id,...values};rows.push(row);return instance(row);},async findAll(options={}){let out=rows.filter(row=>Object.entries(options.where||{}).every(([k,v])=>{if(v&&typeof v==='object'){const p=v[Op.like]??v[Op.iLike];if(p!==undefined)return String(row[k]??'').toLowerCase().includes(String(p).replace(/^%|%$/g,'').toLowerCase());}return row[k]===v;}));for(const[k,dir]of[...(options.order||[])].reverse())out.sort((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*(String(dir).toUpperCase()==='DESC'?-1:1));return out.map(instance);},async findByPk(key){const row=rows.find(r=>String(r.id)===String(key));return row?instance(row):null;},async update(patch,{where}={}){const matches=await this.findAll({where});for(const t of matches)await t.update(patch);return[matches.length];},async count(o){return(await this.findAll(o)).length;},async destroy({where}={}){const matches=await this.findAll({where});const ids=matches.map(t=>t.id);rows=rows.filter(r=>!ids.includes(r.id));return ids.length;}};
 const sequelize={define(name,attributes){assert(name==='Task','Use model name "Task".');attrs=attributes;return Task;}};
 const model=load(source)(sequelize,DataTypes);assert(model===Task,'Return the model from sequelize.define.');return Task;
}
function Router(){const routes=[];const router={routes,use(){return router;}};for(const method of ['get','post','patch','put','delete'])router[method]=(path,...handlers)=>{routes.push({method,path,handlers});return router;};return router;}
function express(){return Router();}express.Router=Router;express.json=()=>()=>{};
function apiContext(files,{model=false,routes=false}={}){
 const Task=database(model?files['models/Task.js']:REFERENCE_MODEL);
 const router=load(routes?files['routes/tasks.js']:REFERENCE_ROUTES)({Task,Op});
 assert(Array.isArray(router?.routes),'Return the express.Router() instance.');
 async function request(method,path,body){const url=new URL(path,'https://practice.invalid');for(const route of router.routes){if(route.method!==method.toLowerCase())continue;const keys=[];const pattern=route.path.replace(/:[^/]+/g,key=>{keys.push(key.slice(1));return'([^/]+)';});const match=url.pathname.match(new RegExp('^'+pattern+'$'));if(!match)continue;const req={body,query:Object.fromEntries(url.searchParams),params:Object.fromEntries(keys.map((k,i)=>[k,match[i+1]]))};let sent=false,status=200,payload;const res={status(s){status=s;return res;},json(p){sent=true;payload=JSON.parse(JSON.stringify(p));return res;},send(p){sent=true;payload=p;return res;}};for(const handler of route.handlers)await timeout(Promise.resolve(handler(req,res,e=>{if(e)throw e;})));assert(sent,'Route did not send a response.');return{status,body:payload};}return{status:404,body:{error:'Route not found'}};}
 const api={async list(query={}){const r=await request('get','/tasks?'+new URLSearchParams(query));if(r.status>=400)throw Error(r.body?.error||'List failed');return r.body;},async create(body){const r=await request('post','/tasks',body);if(r.status>=400)throw Error(r.body?.error||'Create failed');return r.body;},async update(id,body){const r=await request('patch','/tasks/'+id,body);if(r.status>=400)throw Error(r.body?.error||'Update failed');return r.body;}};
 return{Task,request,api};
}
const seed=async Task=>{await Task.create({title:'Review React hooks',priority:'high',completed:false});await Task.create({title:'Ship Express API',priority:'medium',completed:true});await Task.create({title:'Write React tests',priority:'low',completed:false});};
const textOf=r=>JSON.stringify(r.toJSON());
const field=(r,label)=>r.root.findByProps({'aria-label':label});
async function mount(Component,api){let r;await act(async()=>{r=create(React.createElement(Component,{api}));});return r;}
async function change(r,label,value){await act(async()=>{field(r,label).props.onChange({target:{value,checked:value}});});}
async function rejects(fn,msg){let did=false;try{await fn();}catch{did=true;}assert(did,msg);}
async function testCase(stage,index,files){
 if(stage==='model'){
  const Task=database(files['models/Task.js']);
  if(index===0){const t=await Task.create({title:'Valid task'});eq(t.completed,false,'completed should default to false');eq(t.priority,'medium','priority should default to medium');}
  if(index===1)await rejects(()=>Task.create({title:null}),'Null titles must be rejected.');
  if(index===2)await rejects(()=>Task.create({title:''}),'Empty titles must be rejected.');
  if(index===3)await rejects(()=>Task.create({title:'ab'}),'Title length 2 must be rejected.');
  if(index===4)await rejects(()=>Task.create({title:'a'.repeat(81)}),'Title length 81 must be rejected.');
  if(index===5)await rejects(()=>Task.create({title:'Valid task',priority:'urgent'}),'priority="urgent" must be rejected.');return;
 }
 if(stage==='api'){
  const c=apiContext(files,{routes:true});if(index!==7)await seed(c.Task);
  if(index===0){const r=await c.request('get','/tasks');eq(r.status,200);eq(r.body.map(t=>t.id),[3,2,1],'Expected all tasks ordered by id DESC.');}
  if(index===1){const r=await c.request('get','/tasks?q=rEaCt');eq(r.body.map(t=>t.id),[3,1],'Mixed-case search should find both React titles.');}
  if(index===2){const r=await c.request('get','/tasks?completed=false');eq(r.body.map(t=>t.id),[3,1],'completed=false must filter out completed tasks.');}
  if(index===3){const r=await c.request('get','/tasks?q=react&completed=true');eq(r.body,[],'Combine search and completion filters using AND.');}
  if(index===4){const r=await c.request('post','/tasks',{title:'  New task  '});eq(r.status,201,'Create should return 201.');eq(r.body.title,'New task','Trim before storing.');const t=await c.Task.findByPk(r.body.id);eq(t?.title,'New task','Persist the record with Task.create.');}
  if(index===5){for(const title of [undefined,42,'   ','ab','x'.repeat(81)]){const r=await c.request('post','/tasks',{title});eq(r.status,400,'Invalid title must return 400.');assert(typeof r.body.error==='string','Return { error: string }.');}}
  if(index===6){const r=await c.request('post','/tasks',{title:'New task',priority:'urgent'});eq(r.status,400);assert(typeof r.body.error==='string','Include an error message.');}
  if(index===7){const r=await c.request('get','/tasks');eq(r.status,200);eq(r.body,[]);}return;
 }
 if(stage==='react'){
  const Component=load(files['client/TaskBoard.jsx']);const tasks=[{id:1,title:'Review React hooks',completed:false,priority:'high'}];const calls=[];const api={list:async q=>{calls.push(q);return q?.q?[{...tasks[0],title:'Filtered result'}]:tasks;},create:async t=>({id:2,completed:false,...t}),update:async(id,t)=>({id,...t})};
  if(index===0){const r=await mount(Component,api);assert(textOf(r).includes('Review React hooks'),'Render the titles returned by api.list.');assert(calls.length>0,'Call api.list on mount.');r.unmount();}
  if(index===1){const d=deferred();let r;await act(async()=>{r=create(React.createElement(Component,{api:{...api,list:()=>d.promise}}));});assert(/loading/i.test(textOf(r)),'Show Loading while the list request is pending.');await act(async()=>d.resolve(tasks));r.unmount();}
  if(index===2){const r=await mount(Component,api);await change(r,'Search tasks','react');assert(calls.some(q=>q?.q==='react'),'Call api.list({ q: "react" }) after changing search.');assert(textOf(r).includes('Filtered result'),'Render the filtered response.');r.unmount();}
  if(index===3||index===4){let body;api.create=async t=>{body=t;return{id:2,completed:false,...t};};const r=await mount(Component,api);await change(r,'Task title','  Finish practice  ');await act(async()=>{await r.root.findByType('form').props.onSubmit({preventDefault(){}});});eq(body,{title:'Finish practice',priority:'medium'},'Submit the trimmed title and medium priority.');if(index===3)assert(textOf(r).includes('Finish practice'),'Render the new task after creation.');else eq(field(r,'Task title').props.value,'','Clear the controlled title field after success.');r.unmount();}
  if(index===5){const r=await mount(Component,{...api,list:async()=>{throw Error('Network unavailable');}});const alerts=r.root.findAllByProps({role:'alert'});assert(alerts.length>0&&JSON.stringify(alerts[0].children).length>2,'Render a visible error with role="alert".');r.unmount();}
  if(index===6){const old=deferred(),latest=deferred();api.list=q=>q?.q==='old'?old.promise:q?.q==='new'?latest.promise:Promise.resolve(tasks);const r=await mount(Component,api);await change(r,'Search tasks','old');await change(r,'Search tasks','new');await act(async()=>latest.resolve([{...tasks[0],title:'Newest response'}]));await act(async()=>old.resolve([{...tasks[0],title:'Stale response'}]));assert(textOf(r).includes('Newest response')&&!textOf(r).includes('Stale response'),'Ignore stale search responses after a newer request finishes.');r.unmount();}return;
 }
 const c=apiContext(files,{model:true,routes:true});await seed(c.Task);
 if(index===0){const r=await c.request('patch','/tasks/1',{completed:true});eq(r.status,200);eq(r.body.completed,true);eq((await c.Task.findByPk(1)).completed,true,'Persist the update in the model.');}
 if(index===1){const r=await c.request('patch','/tasks/999',{completed:true});eq(r.status,404);assert(typeof r.body.error==='string','Return { error: string }.');}
 if(index===2){for(const completed of ['true',0,null]){const r=await c.request('patch','/tasks/1',{completed});eq(r.status,400,'Only a boolean is valid.');assert(typeof r.body.error==='string','Return { error: string }.');}}
 if(index===3||index===4){let update;const api={...c.api,update:async(id,body)=>{update={id,body};return c.api.update(id,body);}};const r=await mount(load(files['client/TaskBoard.jsx']),api);const checkbox=field(r,'Review React hooks');eq(checkbox.props.type,'checkbox','Render a completion checkbox with the task title as aria-label.');await act(async()=>{await checkbox.props.onChange({target:{checked:true}});});eq(update,{id:1,body:{completed:true}},'Call api.update with the task ID and boolean.');if(index===4){eq(field(r,'Review React hooks').props.checked,true,'Update the controlled checkbox from the API response.');const result=await c.request('get','/tasks');eq(result.body.find(t=>t.id===1)?.completed,true,'GET must reflect persisted completion.');}r.unmount();}
}

function learningError(error){
 if(error.name==='SyntaxError')return 'There is a small syntax issue. Check matching quotes, parentheses, and braces. You can use Clear answer to return to the scaffold, then replace only ___.';
 if(error.name==='ReferenceError'){const name=error.message.split(' is not defined')[0];return name+' is being read as a variable, but it has not been defined. If you mean text, put it inside matching quotes.';}
 return error.message;
}
async function learnCheck(id,code){
 const lesson=getLesson(id);assert(lesson,'This lesson could not be found. Return to your path.');
 assert(typeof code==='string'&&code.length<15000,'Keep this exercise to a small code snippet.');
 assert(!code.includes('___'),'There is still a blank. Replace ___ with the missing piece first.');
 const mode=lesson.code.mode;
 if(mode==='schema'){
  const Task=database('export default function(sequelize,DataTypes){'+code+'}');
  const task=await Task.create({title:'First task'});eq(task.title,'First task');
  await rejects(()=>Task.create({title:42}),'A text title should reject a number. Check the field’s data type.');
  return 'The model stores a text title and rejects the wrong type.';
 }
 if(mode.startsWith('route-')){
  const source="import express from 'express'; export default function({Task,Op}) {"+code+'}';
  const ctx=apiContext({'routes/tasks.js':source},{routes:true});
  if(mode==='route-get'){const result=await ctx.request('get','/hello');eq(result.status,200);eq(result.body,lesson.code.expected);return result.body;}
  if(mode==='route-param'){const result=await ctx.request('get','/tasks/7');eq(result.body,{id:'7'});return result.body;}
  if(mode==='route-post'){const result=await ctx.request('post','/tasks',{title:'Write a task'});eq(result.status,201,'Send a 201 response after creating the task.');eq(result.body.title,'Write a task');eq((await ctx.Task.findByPk(result.body.id))?.title,'Write a task','Save the task before responding.');return{status:201,title:result.body.title};}
  if(mode==='route-validation'){const bad=await ctx.request('post','/tasks',{title:42});eq(bad.status,400,'A title with the wrong type should receive 400.');assert(typeof bad.body.error==='string','Include an understandable error message.');eq(await ctx.Task.count(),0,'Invalid input should not be saved.');const good=await ctx.request('post','/tasks',{title:'Valid title'});eq(good.status,201);return{invalid:400,valid:201};}
 }
 const Task=database(REFERENCE_MODEL);await Task.create({title:'Learn React',completed:false});await Task.create({title:'Ship Express',completed:true});
 const api={list:async()=>[{id:1,title:'Learn React'},{id:2,title:'Build a task'}]};
 const fn=load('export default async function practice(helpers){ const {React,useState,useEffect,api,Task,DataTypes,Op} = helpers; '+code+'}');
 const result=await timeout(fn({React,useState:React.useState,useEffect:React.useEffect,api,Task,DataTypes,Op}));
 if(mode==='jsx'){let r;await act(async()=>{r=create(result);});const tree=r.toJSON();eq(tree?.type,'h1','Keep the h1 heading.');eq(tree.children.join(''),lesson.code.expected,'Put the variable’s value inside the JSX braces.');r.unmount();return lesson.code.expected;}
 if(mode.startsWith('react-')){
  assert(typeof result==='function','Keep the final return of your component function.');
  const r=await mount(result,api);
  try{
   if(mode==='react-counter'){eq(r.root.findByType('button').children.join(''),'0');await act(async()=>r.root.findByType('button').props.onClick());eq(r.root.findByType('button').children.join(''),'1','The first click should show 1.');await act(async()=>r.root.findByType('button').props.onClick());eq(r.root.findByType('button').children.join(''),'2','Each click should add one to the current value.');return 'Button clicks: 0 → 1 → 2';}
   if(mode==='react-input'){await act(async()=>{field(r,'Task title').props.onChange({target:{value:'Learn a little',checked:false}});});eq(field(r,'Task title').props.value,'Learn a little','Put event.target.value into title state.');return 'The input remembers: Learn a little';}
   if(mode==='react-effect'){eq(r.root.findByType('p').children.join(''),'2 tasks','After the promise resolves, show the two loaded tasks. Pass the setter to then.');return '2 tasks loaded into state';}
  }finally{r.unmount();}
 }
 eq(result,lesson.code.expected);return result;
}

let previewRenderer,previewNodes=[];
function previewTree(){previewNodes=[];const walk=node=>{if(typeof node==='string'||typeof node==='number')return String(node);if(!node)return null;if(typeof node.type!=='string')return node.children.map(walk);const id=previewNodes.push(node)-1;const props={};for(const k of ['className','type','value','checked','disabled','placeholder','role','aria-label'])if(node.props[k]!==undefined)props[k]=node.props[k];const events=['onChange','onClick','onSubmit'].filter(k=>typeof node.props[k]==='function');return{tag:node.type,props,id,events,children:node.children.map(walk)};};return walk(previewRenderer.root);}
self.onmessage=async e=>{
 const{type,files,stage,requestId}=e.data;
 try{
  if(type==='learn'){try{const output=await learnCheck(e.data.lessonId,e.data.code);self.postMessage({type:'learn-result',requestId,passed:true,output});}catch(error){self.postMessage({type:'learn-result',requestId,passed:false,error:learningError(error)});}return;}
  if(type==='run'){
   compiled={};logs=[];const output=[];const selected=stage==='all'?STAGES:STAGES.filter(s=>s.id===stage);
   for(const s of selected)for(let i=0;i<s.tests.length;i++){const start=performance.now();let error=null;try{await timeout(testCase(s.id,i,files),2000);}catch(e){error=e.message;}output.push({stage:s.id,index:i,name:s.tests[i],passed:!error,error,ms:Math.round(performance.now()-start)});}
   self.postMessage({type:'results',requestId,results:output,logs});
  }
  if(type==='preview'){
   const c=apiContext(files,{model:true,routes:true});await seed(c.Task);previewRenderer=await mount(load(files['client/TaskBoard.jsx']),c.api);self.postMessage({type:'preview',tree:previewTree()});
  }
  if(type==='event'){
   const node=previewNodes[e.data.id];assert(node,'Preview expired; refresh it.');await act(async()=>{await node.props[e.data.event]({preventDefault(){},target:{value:e.data.value,checked:e.data.checked}});});self.postMessage({type:'preview',tree:previewTree()});
  }
 }catch(error){self.postMessage({type:'error',requestId,error:error.message});}
};
