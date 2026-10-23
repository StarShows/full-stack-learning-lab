import {build} from 'esbuild';
import {mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const config={bundle:true,minify:true,write:false,target:'es2020'};
const client=await build({...config,entryPoints:['src/app.jsx'],outfile:'app.js',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'}});
const runner=await build({...config,entryPoints:['src/runner.js'],outfile:'runner.js',define:{'process.env.NODE_ENV':'"development"'}});
await mkdir('.sites-runtime/qa',{recursive:true});
const assets={'/':{type:'text/html; charset=utf-8',body:await readFile('src/index.html','utf8')}};
for(const file of [...client.outputFiles,...runner.outputFiles]){const name=file.path.split('/').pop();await writeFile('.sites-runtime/qa/'+name,file.text);assets['/'+name]={body:file.text,type:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'};}
await build({entryPoints:['worker/index.js'],bundle:true,minify:true,platform:'neutral',format:'esm',target:'es2022',outfile:'dist/server/index.js',define:{ASSETS:JSON.stringify(assets)}});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built authenticated Worker with embedded application assets.');
