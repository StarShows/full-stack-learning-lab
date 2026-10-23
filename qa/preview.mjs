import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {handle} from '../worker/index.js';
const args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1])||4173;
const assets={'/':{body:await readFile('src/index.html','utf8'),type:'text/html'}};
for(const name of ['app.js','app.css','runner.js'])assets['/'+name]={body:await readFile('.sites-runtime/qa/'+name,'utf8'),type:name.endsWith('css')?'text/css':'text/javascript'};
// Preview stays anonymous; hosted sign-in is owned by the deployment gateway.
http.createServer(async(req,res)=>{try{const r=await handle(new Request('http://terminal.local:'+port+req.url,{method:req.method}),{},assets);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch{res.writeHead(503);res.end('Preview unavailable');}}).listen(port,'0.0.0.0');
