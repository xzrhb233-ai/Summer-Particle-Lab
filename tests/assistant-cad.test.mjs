import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {emptyProject,addProjectPart,updateProjectPart} from '../src/simulation/part-builder.js';
import {parseAssistantResponse,planCommands,prepareAssistantPlan,executePlan} from '../src/simulation/assistant-commands.js';
import {validateCADRecipe} from '../src/three/cad-geometry.js';

const example=JSON.parse(readFileSync(new URL('../cad/examples/perforated-block.json',import.meta.url),'utf8'));
const sample=example.parts[0].geometry.cad,recipe=sample.recipe;
const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const command=(command,args={})=>({command,args});
const response=(...commands)=>({reply:'创建预览，等待应用',commands});
const create=(id='ai-cad',extra={})=>command('cad.create',{id,method:'mpm',name:'AI 通孔块',recipe,...extra});
const buildCAD=async()=>structuredClone(sample);

test('CAD assistant builds a native MPM/PBF plan and only commits on application',async()=>{
  for(const method of ['mpm','pbf']){
    let current=addProjectPart(emptyProject(),{id:'existing',method:'rigid',name:'已有刚体'}),calls=0;
    const before=JSON.stringify(current),plan=await prepareAssistantPlan(current,response(create('ai-cad',{method,density:1000,temperature:35,velocity:[.1,0,0]})),{buildCAD:async r=>{calls++;assert.deepEqual(validateCADRecipe(r),validateCADRecipe(recipe));return buildCAD();}});
    assert.equal(calls,1);assert.equal(JSON.stringify(current),before);assert.equal(plan.before,before);
    assert.equal(plan.project.parts.length,2);assert.equal(plan.project.contactPairs.length,1);
    const added=plan.project.parts.find(p=>p.id==='ai-cad');
    assert.equal(added.method,method);assert.equal(added.geometry.shape,'cad');assert.deepEqual(added.geometry.cad,sample);
    assert.equal(added.material.density,1000);assert.equal(added.initial.temperature,35);assert.deepEqual(added.initial.velocity,[.1,0,0]);
    assert.equal(plan.cadPreviews.length,1);assert.equal(plan.cadPreviews[0].operation,'create');assert.equal(plan.action,null);
    let loads=0;
    await executePlan(plan,{getProject:()=>current,busy:()=>false,assertApplied(){},load:async p=>{current=p;loads++;},control:async()=>{throw Error('No run requested');}});
    assert.equal(loads,1);assert.equal(current.parts.length,2);
  }
});

test('CAD update uses world coordinates once, preserves contacts, initial state and unrelated parts',async()=>{
  let p=addProjectPart(example,{id:'guide',method:'rigid',name:'已有导轨'});
  p=updateProjectPart(p,'mpm-1',{geometry:{center:[.3,1,.1],size:[.4,.25,.3],rotation:[15,35,10]},initial:{temperature:80},boundary:{fixedFace:'minX'}});
  p.contactPairs[0].friction=.73;p.contactPairs[0].thermal=false;
  p.loads.push({id:'guide-force',type:'body-force',target:'guide',force:[0,1,0],torque:[0,0,0]});
  const before=JSON.stringify(p),plan=await prepareAssistantPlan(p,response(command('cad.update',{id:'mpm-1',recipe,name:'更改孔后的试样'})),{buildCAD});
  const old=p.parts.find(v=>v.id==='mpm-1'),part=plan.project.parts.find(v=>v.id==='mpm-1');
  assert.equal(JSON.stringify(p),before);assert.equal(part.name,'更改孔后的试样');assert.equal(part.method,'mpm');
  assert.deepEqual(part.geometry.center,sample.lower.map((v,k)=>(v+sample.upper[k])/2));
  assert.deepEqual(part.geometry.size,sample.upper.map((v,k)=>v-sample.lower[k]));assert.deepEqual(part.geometry.rotation,[0,0,0]);
  assert.deepEqual(part.material,old.material);assert.deepEqual(part.initial,old.initial);assert.deepEqual(part.boundary,old.boundary);assert.deepEqual(part.discretization,old.discretization);
  assert.deepEqual(plan.project.contactPairs,p.contactPairs);assert.deepEqual(plan.project.loads,p.loads);
  assert.deepEqual(plan.project.parts.find(v=>v.id==='guide'),p.parts.find(v=>v.id==='guide'));
  assert.equal(plan.cadPreviews[0].operation,'update');
});

test('CAD command schema rejects code, paths, model meshes and malformed nested feature fields',async()=>{
  let calls=0;const adapter={buildCAD:async()=>{calls++;return buildCAD();}},p=emptyProject(),before=JSON.stringify(p);
  for(const extra of [{vertices:[]},{cad:sample},{script:'alert(1)'},{path:'C:/private'},{url:'https://example.test'},{center:[0,0,0]},{method:'fem'},{method:'rigid'},{cp:500}]){
    await assert.rejects(prepareAssistantPlan(p,response(create('cad-1',extra)),adapter));
  }
  for(const badRecipe of [[],Array(9).fill(recipe[0]),[{...recipe[0],code:'eval(1)'}],[{...recipe[0],center:[NaN,0,0]}],[{...recipe[0],size:[0,1,1]}],[{...recipe[0],operation:'difference'}],[{...recipe[0],shape:'sphere',size:[1,2,1]}],[{...recipe[0],shape:'cylinder',size:[1,2,.5]}],[{...recipe[0],rotation:undefined}]]){
    await assert.rejects(prepareAssistantPlan(p,response(create('cad-1',{recipe:badRecipe})),adapter));
  }
  assert.throws(()=>parseAssistantResponse('{"reply":"x","commands":[{"command":"cad.create","args":{"id":"x","method":"mpm","recipe":[],"__proto__":{}}}]}'));
  assert.throws(()=>planCommands(p,response(create())),/SMLib/);
  assert.equal(calls,0);assert.equal(JSON.stringify(p),before);
});

test('CAD native method checks and build limits run before kernel calls',async()=>{
  let calls=0;const adapter={buildCAD:async()=>{calls++;return buildCAD();}};
  const p=addProjectPart(emptyProject(),{id:'existing',method:'mpm'});
  for(const r of [response(create('existing')),response(command('cad.update',{id:'existing',recipe})),response(command('cad.update',{id:'absent',recipe})),response(create('a',{temperature:0,model:1,method:'pbf'})),response(...Array.from({length:5},(_,i)=>create('cad-'+i))),response(command('simulation.run'),create())])await assert.rejects(prepareAssistantPlan(p,r,adapter));
  assert.equal(calls,0);
});

test('CAD preview cannot be invalidated by later geometry edits, deletion, reset or duplicate builds',async()=>{
  let calls=0;const adapter={buildCAD:async()=>{calls++;return buildCAD();}},p=emptyProject();
  for(const tail of [command('part.delete',{id:'ai-cad'}),command('part.update',{id:'ai-cad',center:[1,1,1]}),command('part.update',{id:'ai-cad',size:[.2,.2,.2]}),command('part.update',{id:'ai-cad',rotation:[0,45,0]}),command('part.update',{id:'ai-cad',shape:'box'}),command('project.new'),command('cad.update',{id:'ai-cad',recipe})])await assert.rejects(prepareAssistantPlan(p,response(create(),tail),adapter));
  assert.equal(calls,0);
  const plan=await prepareAssistantPlan(p,response(create(),command('part.update',{id:'ai-cad',name:'最终名称',temperature:50})),adapter);
  assert.equal(plan.cadPreviews[0].name,'最终名称');assert.equal(plan.project.parts[0].initial.temperature,50);
});

test('a failed or mismatched kernel build leaves all preceding commands uncommitted',async()=>{
  const p=emptyProject(),before=JSON.stringify(p);let calls=0;
  await assert.rejects(prepareAssistantPlan(p,response(command('part.create',{method:'rigid'}),create('first'),create('second')),{buildCAD:async()=>{calls++;if(calls===2)throw Error('SMLib rejected empty solid');return buildCAD();}}),/empty solid/);
  assert.equal(calls,2);assert.equal(JSON.stringify(p),before);
  await assert.rejects(prepareAssistantPlan(p,response(create()),{buildCAD:async()=>({...structuredClone(sample),closed:false})}),/实体数据/);
  await assert.rejects(prepareAssistantPlan(p,response(create()),{buildCAD:async()=>({...structuredClone(sample),recipe:[{...recipe[0],center:[.1,.7,0]},recipe[1]]})}),/不一致/);
  assert.equal(JSON.stringify(p),before);
});

test('CAD cancellation and stale project checks cannot apply a partial project',async()=>{
  const p=emptyProject(),before=JSON.stringify(p),controller=new AbortController();let calls=0;
  await assert.rejects(prepareAssistantPlan(p,response(create()),{signal:controller.signal,buildCAD:async(_,{signal})=>{assert.equal(signal,controller.signal);calls++;controller.abort();return buildCAD();}}),e=>e.name==='AbortError');
  assert.equal(calls,1);assert.equal(JSON.stringify(p),before);
  await assert.rejects(prepareAssistantPlan(p,response(create()),{signal:controller.signal,buildCAD:async()=>{calls++;return buildCAD();}}),e=>e.name==='AbortError');assert.equal(calls,1);
  const plan=await prepareAssistantPlan(p,response(create()),{buildCAD});let loads=0;
  await assert.rejects(executePlan(plan,{getProject:()=>({...p,name:'手动更改'}),busy:()=>false,load:async()=>loads++,control:async()=>{},assertApplied(){}}),/项目已变化/);assert.equal(loads,0);
});

test('GPU CAD rejects instead of switching silently; explicitly selecting CPU permits the plan',async()=>{
  const p=planCommands(emptyProject(),response(command('part.create',{id:'old-mpm',method:'mpm'}),command('solver.configure',{device:'gpu'}))).project;
  let calls=0;const adapter={buildCAD:async()=>{calls++;return buildCAD();}};
  await assert.rejects(prepareAssistantPlan(p,response(create()),adapter),/CPU/);assert.equal(calls,0);
  const plan=await prepareAssistantPlan(p,response(command('solver.configure',{device:'cpu'}),create()),adapter);assert.equal(plan.project.solver.computeBackend,'cpu');assert.equal(calls,1);
  await assert.rejects(prepareAssistantPlan(emptyProject(),response(create(),command('solver.configure',{device:'gpu'})),adapter),/CAD/);
  assert.equal(p.solver.computeBackend,'gpu');
});

test('non-CAD plans keep the synchronous behavior and optional final simulation action',async()=>{
  const p=emptyProject(),r=response(command('part.create',{method:'rigid'}),command('simulation.step'));
  const expected=planCommands(p,r),actual=await prepareAssistantPlan(p,r);
  assert.deepEqual(actual,{...expected,cadPreviews:[]});
  const cad=await prepareAssistantPlan(p,response(create(),command('simulation.run')),{buildCAD});assert.equal(cad.action,'run');
});

test('real SMLib assistant union and hole update produce correct volumes and world-coordinate bounds',{skip:!available},async()=>{
  const box={shape:'box',operation:'base',center:[0,.7,0],size:[.4,.4,.4],rotation:[0,0,0]},r=[box,{...box,center:[.2,.7,0],operation:'union'}];
  const adapter={buildCAD:tree=>runCAD({action:'build',recipe:tree})};
  const created=await prepareAssistantPlan(emptyProject(),response(create('native',{recipe:r})),adapter);
  assert.ok(Math.abs(created.project.parts[0].geometry.cad.volume-.096)<1e-7);
  const hole=[...r,{shape:'cylinder',operation:'difference',center:[.1,.7,0],size:[.15,.6,.15],rotation:[0,0,0]}];
  const updated=await prepareAssistantPlan(created.project,response(command('cad.update',{id:'native',recipe:hole})),adapter);
  const geometry=updated.project.parts[0].geometry;
  assert.ok(Math.abs(geometry.cad.volume-(.096-Math.PI*.075**2*.4))<1e-7);
  assert.ok(Math.abs(geometry.center[0]-.1)<1e-8);assert.ok(Math.abs(geometry.size[0]-.6)<1e-8);assert.deepEqual(geometry.rotation,[0,0,0]);
});
