const KEYS={learning:'alex-fullstack-learn-v1',assessment:'alex-fullstack-lab-v1'};
let user=null,status='loading',failure='',conflict=false,timer,running=false;
const docs={},listeners=new Set();
const emit=()=>listeners.forEach(fn=>fn());
export const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const accountSnapshot=()=>({user,status,failure,conflict});
export function loadProgress(scope){return docs[scope]?.state||null;}
export function saveProgress(scope,state){const doc=docs[scope];if(!doc)return;const raw=JSON.stringify(state);if(raw===JSON.stringify(doc.state))return;doc.state=state;doc.dirty=true;status='saving';emit();clearTimeout(timer);timer=setTimeout(flush,650);}
async function request(path,options){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});let body;try{body=await r.json();}catch{body={};}if(!r.ok){const e=Error(body.error||'Could not reach your account.');e.status=r.status;throw e;}return body;}
export async function initializeAccount(){
 const session=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});
 if(session.status===401){status='signed-out';emit();return false;}
 if(!session.ok)throw Error('Could not load your account. Please retry.');
 user=(await session.json()).user;
 const rows=await Promise.all(Object.keys(KEYS).map(async scope=>[scope,await request('/api/progress/'+scope)]));
 for(const [scope,row] of rows){docs[scope]={state:row.state,revision:row.revision,dirty:false};}
 status='saved';failure='';emit();return true;
}
export function legacyProgress(){const result={};for(const [scope,key]of Object.entries(KEYS)){try{const value=JSON.parse(localStorage.getItem(key));if(value?.version===1)result[scope]=value;}catch{}}return result;}
export function importLegacy(){const old=legacyProgress();for(const scope of Object.keys(KEYS)){if(!docs[scope].state&&old[scope])saveProgress(scope,old[scope]);}return flush();}
export const canImport=()=>Object.entries(legacyProgress()).some(([scope])=>!docs[scope]?.state);
export async function flush(){
 clearTimeout(timer);if(running||!user||conflict)return;
 running=true;failure='';
 try{
  for(const scope of Object.keys(KEYS)){
   const doc=docs[scope];while(doc.dirty){
    status='saving';emit();const state=doc.state,revision=doc.revision;
    let result;try{result=await request('/api/progress/'+scope,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,state})});}
    catch(e){if(e.status===409){const remote=await request('/api/progress/'+scope);if(JSON.stringify(remote.state)===JSON.stringify(state))result=remote;else{conflict=true;throw e;}}else throw e;}
    doc.revision=result.revision;doc.dirty=doc.state!==state;
   }
  }
  status='saved';
 }catch(e){status='error';failure=e.message;}
 finally{running=false;emit();}
}
if(typeof window!=='undefined')window.addEventListener('online',()=>flush());
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>flush());
if(typeof window!=='undefined')window.addEventListener('beforeunload',e=>{if(Object.values(docs).some(d=>d.dirty)){e.preventDefault();e.returnValue='';}});
// Learner code runs in a worker. Deny its network access so it cannot mutate account data.
