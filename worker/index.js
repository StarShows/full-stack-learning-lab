// These identity headers are supplied by Sites dispatch, never by the app client.
const response = (value, status=200) => Response.json(value, {status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export const UPSERT = `INSERT INTO user_progress (user_id, scope, state, revision, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id, scope) DO UPDATE SET state=excluded.state, revision=user_progress.revision+1, updated_at=excluded.updated_at WHERE user_progress.revision=? RETURNING revision, updated_at`;
export function validState(scope, state) {
  if (!state || state.version!==1 || typeof state!=='object' || Array.isArray(state)) return false;
  if (scope==='learning') return state.drafts && state.completed && state.days && Number.isFinite(state.xp) && state.xp>=0 && ['home','lesson','complete','review'].includes(state.view);
  return state.files && typeof state.files==='object' && Object.values(state.files).every(v=>typeof v==='string');
}
export async function handle(request, env, assets) {
 const url=new URL(request.url),path=url.pathname;
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(path.startsWith('/api/')) {
  if(!userId||!email)return response({error:'Sign in to access your progress.'},401);
  if(path==='/api/session' && request.method==='GET') {
   let name=request.headers.get('oai-authenticated-user-full-name');
   if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(name||'');}catch{name=null;}}
   return response({user:{id:userId,email,name:name||email}});
  }
  const scope=path==='/api/progress/learning'?'learning':path==='/api/progress/assessment'?'assessment':null;
  if(!scope)return response({error:'Not found'},404);
  if(request.method==='GET') {
   const row=await env.DB.prepare('SELECT state, revision, updated_at FROM user_progress WHERE user_id=? AND scope=?').bind(userId,scope).first();
   return response({state:row?JSON.parse(row.state):null,revision:row?.revision||0,updatedAt:row?.updated_at||null});
  }
  if(request.method!=='PUT')return response({error:'Method not allowed'},405);
  if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')return response({error:'Invalid request origin'},403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'JSON required'},415);
  if(Number(request.headers.get('Content-Length'))>300000)return response({error:'Progress is too large'},413);
  let input;try {const raw=await request.text();if(new TextEncoder().encode(raw).length>300000)return response({error:'Progress is too large'},413);input=JSON.parse(raw);}catch{return response({error:'Invalid JSON'},400);}
  if(!Number.isSafeInteger(input.revision)||input.revision<0||!validState(scope,input.state))return response({error:'Invalid progress'},400);
  // revision=0 can only insert. A separate guard prevents creating a missing row with a stale revision.
  if(input.revision>0){const exists=await env.DB.prepare('SELECT revision FROM user_progress WHERE user_id=? AND scope=?').bind(userId,scope).first();if(!exists)return response({error:'Progress changed in another tab. Reload to continue.'},409);}
  const row=await env.DB.prepare(UPSERT).bind(userId,scope,JSON.stringify(input.state),Date.now(),input.revision).first();
  if(!row)return response({error:'Progress changed on another device. Reload to continue.'},409);
  return response({revision:row.revision,updatedAt:row.updated_at});
 }
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 const asset=assets[path];if(!asset)return new Response('Not found',{status:404});
 return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...(path==='/runner.js'?{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'"}:{})}});
}
export default {async fetch(request,env){try{return await handle(request,env,ASSETS);}catch{return response({error:'Progress service is unavailable. Please retry.'},503);}}};
