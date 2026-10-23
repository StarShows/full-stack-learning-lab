import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {openDatabase} from '../server/database.mjs';
import {createReminders,allowedEndpoint} from '../server/reminders.mjs';
import {defaultRhythm,validRhythm,recordOpening,suggestedHour,reminderDue,localTime} from '../src/rhythm.js';
const at=Date.parse('2026-10-23T18:00:00Z'),origin='https://lab.example.test';
const prefs=()=>({...defaultRhythm(),timezone:'UTC',enabled:true,hour:18});
function fixture(){const db=openDatabase(':memory:');for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,'google',id,id+'@example.test',id,at);return db;}
const request=(method,body,headers={})=>new Request(origin+'/api/reminders/subscribe',{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const endpoint='https://web.push.apple.com/abc';
test('pattern consent, distinct days, bounded retention and time zones',()=>{
 let s={...prefs(),patterns:true};for(let i=0;i<40;i++)s=recordOpening(s,at+i*86400000);assert.equal(s.opens.length,35);assert.equal(suggestedHour(s),18);assert.equal(recordOpening(s,at+39*86400000),s);
 assert.equal(suggestedHour({...s,patterns:false}),null);assert.equal(suggestedHour({...s,opens:s.opens.slice(0,4)}),null);
 assert.equal(localTime(at,'America/New_York').hour,14);
 assert.equal(validRhythm({...s,timezone:'made/up'}),false);assert.equal(validRhythm({...s,hour:2}),false);assert.equal(validRhythm({...s,opens:Array(36).fill(s.opens[0])}),false);
 assert.equal(localTime(Date.parse('2026-11-01T05:30:00Z'),'America/New_York').hour,1);assert.equal(localTime(Date.parse('2026-11-01T06:30:00Z'),'America/New_York').hour,1);
});
test('reminders honor opt-in, quiet hours, visited dates, snooze, spacing and weekly limit',()=>{
 assert(reminderDue(prefs(),at));assert(!reminderDue({...prefs(),enabled:false},at));assert(!reminderDue({...prefs(),snooze:at+1},at));assert(!reminderDue(recordOpening(prefs(),at),at));assert(!reminderDue(prefs(),at+15*60000));
 assert(!reminderDue(prefs(),at,[{day:'2026-10-22',at:at-86400000}]));assert(!reminderDue(prefs(),at,[2,4,6].map(n=>({day:'older',at:at-n*86400000}))));assert(!reminderDue({...prefs(),hour:23},at+5*3600000));
});
test('push endpoints reject private networks, credentials, redirects and impostor domains',()=>{
 for(const e of ['http://127.0.0.1/push','https://127.0.0.1/push','https://fcm.googleapis.com.evil.test/x','https://evil.test/?x=push.apple.com','https://user@web.push.apple.com/x','https://web.push.apple.com:8443/x','https://web.push.apple.com/x#frag'])assert(!allowedEndpoint(e),e);
 for(const e of [endpoint,'https://fcm.googleapis.com/wp/a','https://updates.push.services.mozilla.com/wpush/v2/a'])assert(allowedEndpoint(e));
});
test('subscription routes enforce auth, origin, ownership, device limits and account transfer',async()=>{
 const db=fixture(),r=createReminders({db,config:{origin,secure:true}}),user={id:'alice'};
 assert.equal((await r.handle(request('POST',{endpoint}),null)).status,401);
 assert.equal((await r.handle(request('POST',{endpoint},{Origin:'https://evil.test'}),user)).status,403);
 assert.equal((await r.handle(request('POST',{endpoint:'https://localhost/x'}),user)).status,400);
 assert.equal((await r.handle(request('POST',{endpoint}),user)).status,200);
 await r.handle(request('DELETE',{endpoint}),{id:'bob'});assert.equal(db.prepare('SELECT count(*) n FROM reminder_subscriptions').get().n,1);
 await r.handle(request('POST',{endpoint}),{id:'bob'});assert.equal(db.prepare('SELECT user_id FROM reminder_subscriptions').get().user_id,'bob');
 for(let i=0;i<5;i++)await r.handle(request('POST',{endpoint:endpoint+i}),user);
 assert.equal((await r.handle(request('POST',{endpoint:endpoint+'extra'}),user)).status,409);db.close();
});
test('scheduler signs VAPID, sends private empty payload once, persists claim and removes expired subscriptions',async()=>{
 const db=fixture();db.prepare('INSERT INTO user_progress VALUES(?,?,?,?,?)').run('alice','engagement',JSON.stringify(prefs()),1,at);let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.TTL,'60');assert.equal(options.body,'');const m=/^vapid t=([^,]+), k=(.+)$/.exec(options.headers.Authorization);assert(m);const [h,p,s]=m[1].split('.'),raw=Buffer.from(m[2],'base64url');const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});assert(verify('sha256',Buffer.from(h+'.'+p),{key,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));assert.equal(JSON.parse(Buffer.from(p,'base64url')).aud,new URL(url).origin);return new Response(null,{status:calls===1?410:201});};
 const r=createReminders({db,config:{origin,secure:true},now:()=>at,fetcher});await r.handle(request('POST',{endpoint:endpoint+'old'}),{id:'alice'});await r.handle(request('POST',{endpoint}),{id:'alice'});
 await Promise.all([r.tick(),r.tick()]);assert.equal(calls,2);assert.equal(db.prepare('SELECT count(*) n FROM reminder_subscriptions').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM reminder_deliveries').get().n,1);
 const r2=createReminders({db,config:{origin,secure:true},now:()=>at,fetcher});assert.equal(r.publicKey,r2.publicKey);await r2.tick();assert.equal(calls,2);await r.close();await r2.close();db.close();
});
