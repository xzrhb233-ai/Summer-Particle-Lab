import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {CAD_TEMPLATES,createCADTemplate,moveCADStep,deleteCADStep} from '../src/simulation/cad-templates.js';
import {requestCAD,buildCAD} from '../src/simulation/cad-client.js';
import {runCAD} from '../cad-server.mjs';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));

test('CAD templates return independent declarative recipes and protect the base step',()=>{
  const a=createCADTemplate('four-hole-plate'),original=structuredClone(a.recipe);
  assert.equal(a.recipe.length,5);
  a.recipe[0].size[0]=10;assert.deepEqual(createCADTemplate('four-hole-plate').recipe,original);
  const moved=moveCADStep(original,2,-1);
  assert.deepEqual(moved[0],original[0]);assert.deepEqual(moved[1],original[2]);assert.deepEqual(moved[2],original[1]);
  assert.deepEqual(moveCADStep(moved,1,1),original);
  const removed=deleteCADStep(original,2);assert.equal(removed.length,4);assert.deepEqual(removed[0],original[0]);assert.deepEqual(removed[2],original[3]);
  for(const [i,d] of [[0,1],[1,-1],[4,1]])assert.throws(()=>moveCADStep(original,i,d),/初始实体/);
  assert.throws(()=>deleteCADStep(original,0),/初始实体/);assert.throws(()=>createCADTemplate('unknown'),/未知/);
  for(const {id} of CAD_TEMPLATES){const t=createCADTemplate(id);assert.equal(t.recipe[0].operation,'base');assert.ok(t.recipe.slice(1).every(s=>s.operation!=='base'));assert.ok(t.recipe.length<=8);}
});

test('real SMLib builds all modeling templates with the expected nonzero volume',{skip:!available},async()=>{
  const expected={'through-hole':.8*.5*.6-Math.PI*.15**2*.5,pipe:Math.PI*(.3**2-.16**2)*.7,'l-bracket':.8*.16*.5+.2*.6*.5-.2*.13*.5,'four-hole-plate':.9*.16*.7-4*Math.PI*.07**2*.16,'extruded-l-bracket':.12,'revolved-sleeve':Math.PI*(.4**2-.2**2)*.6};
  for(const {id} of CAD_TEMPLATES){
    const cad=await runCAD({action:'build',recipe:createCADTemplate(id).recipe});
    // The worker requests a 1e-6 volume integration tolerance from SMLib.
    assert.equal(cad.closed,true,id);assert.ok(Math.abs(cad.volume-expected[id])<1e-6,`${id} volume`);
    assert.ok(cad.lower.every((v,k)=>v>=[-1,0,-1][k]));assert.ok(cad.upper.every((v,k)=>v<=[1,1.2,1][k]));
  }
});

test('CAD client restricts actions, handles malformed failures, and validates built data',async()=>{
  const previous=globalThis.fetch;
  try{
    let request;
    globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({ready:true}),{status:200});};
    assert.deepEqual(await requestCAD('health'),{ready:true});assert.equal(request.url,'/api/cad');assert.deepEqual(JSON.parse(request.options.body),{action:'health'});
    await assert.rejects(requestCAD('exec',[]),/未知/);
    await assert.rejects(buildCAD(createCADTemplate('pipe').recipe),/实体数据无效/);
    globalThis.fetch=async()=>new Response('not json',{status:500});await assert.rejects(requestCAD('health'),/无法读取/);
    globalThis.fetch=async()=>new Response('missing',{status:404});await assert.rejects(requestCAD('health'),/重启/);
    globalThis.fetch=async()=>{throw new TypeError('network');};await assert.rejects(requestCAD('health'),/无法连接本地/);
    const abort=new DOMException('aborted','AbortError');globalThis.fetch=async()=>{throw abort;};await assert.rejects(requestCAD('health'),error=>error===abort);
  }finally{globalThis.fetch=previous;}
});
