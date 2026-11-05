import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createAppServer,isPublicAsset} from '../server.mjs';

async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'summer-web-test-')),root=join(directory,'site');await mkdir(root);
  for(const [path,body] of [['index.html','public page'],['src/app.js','export const publicValue=1;'],['server.mjs','server private source'],['artifacts/local-log.json','private log'],['artifacts/course-replay.json','{"frames":[]}']]){
    const full=join(root,path);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,body);
  }
  const server=createAppServer({root,aiHandler:(req,res)=>res.end('ai '+req.url),cadHandler:(req,res)=>res.end('cad')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return {directory,root,port,get:(path,options={})=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,...options},res=>{const chunks=[];res.on('data',v=>chunks.push(v));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();
  })};
}
test('web server exposes only browser entrypoints, source modules and named saved reports',async t=>{
  const f=await fixture(t);assert.equal((await f.get('/')).body,'public page');assert.equal((await f.get('/src/app.js')).status,200);assert.equal((await f.get('/artifacts/course-replay.json')).status,200);
  for(const path of ['/server.mjs','/ai-server.mjs','/cad/worker.py','/package.json','/.env','/.git/config','/artifacts/local-log.json','/tests/anything.test.mjs'])assert.equal((await f.get(path)).status,404,path);
});
test('web server checks Host and Origin before routing services',async t=>{
  const f=await fixture(t);assert.equal((await f.get('/api/ai/chat',{headers:{host:'attacker.invalid'}})).status,403);
  assert.equal((await f.get('/api/cad',{headers:{origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await f.get('/api/ai/chat',{headers:{origin:`http://127.0.0.1:${f.port}`}})).body,'ai /chat');
  assert.equal((await f.get('/',{headers:{origin:'null'}})).status,403);
});
test('web server serves HEAD without a body and rejects static mutations',async t=>{
  const f=await fixture(t),head=await f.get('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),11);assert.equal(head.headers['x-frame-options'],'DENY');
  assert.equal((await f.get('/',{method:'POST'})).status,405);assert.equal((await f.get('/%zz')).status,404);
  for(const p of ['/src/%2e%2e/server.mjs','/src/%5c..%5cserver.mjs','/src/app.js%00'])assert.equal((await f.get(p)).status,404,p);
});
test('web server refuses a symlink or junction that escapes its public root',async t=>{
  const f=await fixture(t),outside=join(f.directory,'outside');await mkdir(outside);await writeFile(join(outside,'hidden.js'),'private');
  await symlink(outside,join(f.root,'src','linked'),process.platform==='win32'?'junction':'dir');
  assert.equal((await f.get('/src/linked/hidden.js')).status,404);
  const privateDir=join(f.root,'private');await mkdir(privateDir);await writeFile(join(privateDir,'config.js'),'private');
  await symlink(privateDir,join(f.root,'src','local-private'),process.platform==='win32'?'junction':'dir');
  assert.equal((await f.get('/src/local-private/config.js')).status,404);
});
test('asset policy does not expose dependency metadata or arbitrary extensions',()=>{
  assert.equal(isPublicAsset('/node_modules/@dimforge/rapier3d-compat/rapier.mjs'),true);
  for(const path of ['/node_modules/@dimforge/rapier3d-compat/package.json','/src/secret.json','/src/.cache/data.js','/src/../server.mjs'])assert.equal(isPublicAsset(path),false);
});
