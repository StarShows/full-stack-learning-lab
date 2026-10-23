import {generateKeyPairSync,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {validRhythm,reminderDue,localTime} from '../src/rhythm.js';

export function allowedEndpoint(value){
 try{const u=new URL(value);return value.length<2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname!=='/'&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||/^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname));}catch{return false;}
}
function keys(db){
 let row=db.prepare("SELECT private_key FROM reminder_keys WHERE id=1").get();
 if(!row){const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});db.prepare('INSERT OR IGNORE INTO reminder_keys (id,private_key) VALUES (1,?)').run(privateKey.export({type:'pkcs8',format:'pem'}));row=db.prepare('SELECT private_key FROM reminder_keys WHERE id=1').get();}
 const privateKey=createPrivateKey(row.private_key),jwk=createPublicKey(privateKey).export({format:'jwk'});
 return {privateKey,publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url')};
}
export function pushAuthorization(endpoint,key,subject,now=Date.now()){
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const data=b64({typ:'JWT',alg:'ES256'})+'.'+b64({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+3600,sub:subject});
 const token=data+'.'+sign('sha256',Buffer.from(data),{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 return `vapid t=${token}, k=${key.publicKey}`;
}
export function createReminders({db,config,fetcher=fetch,now=()=>Date.now()}){
 const key=keys(db);let timer,running,closed=false;
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 async function handle(request,user){
  if(!user)return json({error:'Sign in to manage reminders.'},401);
  const path=new URL(request.url).pathname;
  if(path==='/api/reminders/status'&&request.method==='GET')return json({available:config.secure,reason:config.secure?null:'https',publicKey:config.secure?key.publicKey:null});
  if(path!=='/api/reminders/subscribe'||!['POST','DELETE'].includes(request.method))return json({error:'Not found'},404);
  if(request.headers.get('origin')!==config.origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid origin'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
  let body;try{const raw=await request.text();if(raw.length>4096)return json({error:'Subscription too large'},413);body=JSON.parse(raw);}catch{return json({error:'Invalid subscription'},400);}
  if(!body||!allowedEndpoint(body.endpoint))return json({error:'Unsupported push endpoint'},400);
  if(request.method==='DELETE'){db.prepare('DELETE FROM reminder_subscriptions WHERE endpoint=? AND user_id=?').run(body.endpoint,user.id);return json({ok:true});}
  if(!config.secure)return json({error:'HTTPS is required for background reminders.'},409);
  // A browser subscription may belong to only one account. Reconnecting transfers this device.
  const count=db.prepare('SELECT count(*) AS n FROM reminder_subscriptions WHERE user_id=? AND endpoint<>?').get(user.id,body.endpoint).n;
  if(count>=5)return json({error:'Five devices are already connected. Disconnect an old device first.'},409);
  db.prepare('INSERT INTO reminder_subscriptions(endpoint,user_id,created_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,created_at=excluded.created_at').run(body.endpoint,user.id,now());
  return json({ok:true});
 }
 async function dispatch(){
  if(!config.secure||closed)return;
  const at=now();db.prepare('DELETE FROM reminder_deliveries WHERE at<?').run(at-35*86400000);
  // Only users with subscribed devices need scheduling work.
  const rows=db.prepare("SELECT p.user_id,p.state FROM user_progress p WHERE p.scope='engagement' AND EXISTS(SELECT 1 FROM reminder_subscriptions s WHERE s.user_id=p.user_id)").all();
  for(const row of rows){
   if(closed)break;
   let prefs;try{prefs=JSON.parse(row.state);}catch{continue;}
   const history=db.prepare('SELECT day,at FROM reminder_deliveries WHERE user_id=?').all(row.user_id);
   if(!reminderDue(prefs,at,history))continue;
   const day=localTime(at,prefs.timezone).day;
   // Claim before external delivery: crashes or parallel instances cannot duplicate a day's reminder.
   const claim=db.prepare('INSERT OR IGNORE INTO reminder_deliveries(user_id,day,at) VALUES(?,?,?)').run(row.user_id,day,at);
   if(!claim.changes)continue;
   const devices=db.prepare('SELECT endpoint FROM reminder_subscriptions WHERE user_id=? ORDER BY created_at DESC').all(row.user_id);
   // One device per reminder avoids ringing several devices at once. Prefer the most recently connected.
   for(const {endpoint} of devices){
    if(!allowedEndpoint(endpoint))continue;
    try{
     // Empty payload intentionally carries no personal data. The service worker displays fixed copy.
     const r=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:pushAuthorization(endpoint,key,config.origin,at),TTL:'60',Urgency:'low',Topic:'learning-reminder','Content-Length':'0'},body:''});
     if(r.status===404||r.status===410){db.prepare('DELETE FROM reminder_subscriptions WHERE endpoint=?').run(endpoint);continue;}
     if(!r.ok)console.warn('Reminder push was not accepted; no automatic retry.');
     await r.body?.cancel();break;
    }catch{console.warn('Reminder delivery unavailable; no automatic retry.');break;}
   }
  }
 }
 function tick(){if(running||closed)return running||Promise.resolve();running=dispatch().catch(()=>console.warn('Reminder scheduler unavailable.')).finally(()=>{running=null;});return running;}
 return {handle,tick,publicKey:key.publicKey,start(){if(timer)return;timer=setInterval(tick,60000);timer.unref();tick();},async close(){closed=true;clearInterval(timer);await running;}};
}
