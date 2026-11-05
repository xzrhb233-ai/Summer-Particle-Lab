import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {prepareAssistantPlan,parseAssistantResponse,SYSTEM_PROMPT,COMMANDS,executePlan} from '../src/simulation/assistant-commands.js';
import {buildAssistantContext} from '../src/simulation/assistant-context.js';
import {validateCADRecipe} from '../src/three/cad-geometry.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const command=(command,args={})=>({command,args}),response=(...commands)=>({reply:'检查轮廓实体预览后应用',commands});
const extrude={shape:'extrude',operation:'base',center:[0,.7,0],rotation:[0,0,0],profile:[[-.4,-.3],[.4,-.3],[.4,-.1],[-.2,-.1],[-.2,.3],[-.4,.3]],depth:.2};
const revolve={shape:'revolve',operation:'base',center:[0,.7,0],rotation:[0,0,0],profile:[[.2,-.3],[.35,-.3],[.35,.3],[.2,.3]],angle:360};
const create=(id,step,extra={})=>command('cad.create',{id,name:'轮廓实体',method:'mpm',recipe:[step],...extra});
const native={buildCAD:recipe=>runCAD({action:'build',recipe}),buildMesh:(recipe,options)=>runCAD({action:'mesh',recipe,options})};

test('profile instructions extend the existing closed commands and describe local axes and examples',()=>{
  assert.ok(COMMANDS['cad.create'].includes('recipe'));assert.equal(COMMANDS['cad.extrude'],undefined);assert.equal(COMMANDS['cad.revolve'],undefined);assert.equal(COMMANDS.eval,undefined);
  for(const phrase of ['L形支架','回转套筒','shape=extrude','shape=revolve','局部XY','-depth/2','-Z','3–32','隐式闭合','不能给size','中心','center'])assert.ok(SYSTEM_PROMPT.includes(phrase),phrase);
  assert.throws(()=>parseAssistantResponse(JSON.stringify(response(command('cad.extrude',{code:'eval(1)'})))));
  assert.throws(()=>parseAssistantResponse(JSON.stringify(response(create('bad',extrude,{script:'eval(1)'})))));
});

test('invalid profile trees and arbitrary references fail before a kernel request',async()=>{
  const p=emptyProject(),before=JSON.stringify(p);let calls=0;const adapter={buildCAD:async()=>calls++};
  const invalid=[
    {...extrude,size:[1,1,1]},{...extrude,angle:360},{...revolve,depth:.2},{...extrude,depth:0},{...extrude,depth:13},{...revolve,angle:0},{...revolve,angle:361},
    {...extrude,profile:[[0,0],[1,0]]},{...extrude,profile:[...extrude.profile,extrude.profile[0]]},{...extrude,profile:[[0,0],[1,1],[0,1],[1,0]]},
    {...extrude,profile:[[0,0],[1,0],[2,0]]},{...extrude,profile:[[0,0],[.001,0],[.001,1],[0,1]]},{...extrude,profile:[[0,0],[7,0],[7,1],[0,1]]},
    {...revolve,profile:[[-.1,0],[.5,0],[.5,1],[-.1,1]]},{...extrude,profile:[[[0,0],[1,0],[1,1]]]},{...extrude,profile:[[NaN,0],[1,0],[1,1]]},
    {...extrude,profile:Array.from({length:33},(_,i)=>[Math.cos(i/33*Math.PI*2),Math.sin(i/33*Math.PI*2)])},
    {...extrude,curveId:'curve-1'},{...extrude,surfaceId:'surface-1'},{...extrude,path:'C:/private'},{...extrude,profile:'x=>[x,x]'},{...revolve,script:'1+1'}
  ];
  for(const step of invalid)await assert.rejects(prepareAssistantPlan(p,response(create('invalid',step)),adapter));
  assert.equal(calls,0);assert.equal(JSON.stringify(p),before);
});

test('profile context keeps original coordinates and safe feature definitions in parts, FEM sources and drafts',()=>{
  const p=emptyProject(),recipe=[{...extrude,id:'stock',name:'L形料'},{...revolve,operation:'union',id:'sleeve',name:'回转环'}],bounds={lower:[-.4,.4,-.35],upper:[.4,1,.35]};
  p.parts=[{id:'profile-part',method:'mpm',name:'组合轮廓体',geometry:{shape:'cad',center:[2,3,4],size:[1.6,1.2,1.4],rotation:[0,0,90],cad:{schema:'summer-cad/1',kernel:'SMLib',version:'fixture',closed:true,recipe,...bounds,volume:.15,vertices:[[0,0,0]],indices:[0,0,0]}},discretization:{mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes:[[0,0,0]],elements:[[0,1,2,3]],surface:[[0,1,2]],source:{recipe,...bounds}}}}];
  const draft={recipe:structuredClone(recipe),method:'fem',sourcePartId:'profile-part',sourceGeometry:{center:[2,3,4],size:[1.6,1.2,1.4],rotation:[0,0,90]},selectedStep:1,unsavedChanges:true};
  draft.recipe[0].apiKey='secret-marker';draft.recipe[1].path='private-path';
  const before=JSON.stringify(p),context=buildAssistantContext(p,{time:0},draft),saved=context.project.parts[0].geometry.cad;
  assert.deepEqual(saved.recipe,recipe);assert.deepEqual(context.project.parts[0].discretization.mesh.source.recipe,recipe);assert.deepEqual(context.cadDraft.recipe,recipe);
  assert.equal(context.cadDraft.valid,true);assert.equal(context.cadDraft.method,'fem');assert.equal(context.cadDraft.coordinateSpace,'original-recipe-before-whole-part-transform');assert.deepEqual(saved.worldPlacement.center,[2,3,4]);assert.deepEqual(saved.recipe[0].center,[0,.7,0]);assert.ok(saved.worldPlacement.scaleFromRecipeBounds.every(n=>Math.abs(n-2)<1e-10));
  assert.equal('size' in saved.recipe[0],false);assert.equal('size' in saved.recipe[1],false);assert.equal(saved.recipe[0].depth,.2);assert.equal(saved.recipe[1].angle,360);
  assert.equal(JSON.stringify(context).includes('secret-marker'),false);assert.equal(JSON.stringify(context).includes('private-path'),false);assert.equal(JSON.stringify(p),before);
  saved.recipe[0].profile[0][0]=99;assert.equal(JSON.stringify(p),before);assert.equal(draft.recipe[0].profile[0][0],-.4);
  assert.deepEqual(context.capabilities.cad.shapes,['box','sphere','cylinder','extrude','revolve']);assert.match(context.capabilities.cad.profiles.revolve,/right-handed/i);assert.match(context.capabilities.cad.profiles.simulation,/CPU MPM\/PBF.*CPU Tet4/);
});

test('profile draft validation is getter-safe for feature fields, vertices and numeric amount',()=>{
  const bomb=()=>{throw Error('must not evaluate arbitrary getter');},step=structuredClone(extrude);
  Object.defineProperty(step,'apiKey',{enumerable:true,get:bomb});Object.defineProperty(step.profile,'map',{get:bomb});Object.defineProperty(step.profile[0],'slice',{get:bomb});
  let safe=buildAssistantContext(emptyProject(),{},{recipe:[step]}).cadDraft;assert.equal(safe.valid,true);assert.deepEqual(safe.recipe[0].profile,extrude.profile);
  Object.defineProperty(step.profile[0],'0',{get:bomb});assert.equal(buildAssistantContext(emptyProject(),{},{recipe:[step]}).cadDraft.valid,false);
  const quantity=structuredClone(revolve);Object.defineProperty(quantity,'angle',{get:bomb});assert.equal(buildAssistantContext(emptyProject(),{},{recipe:[quantity]}).cadDraft.valid,false);
  const accessor={shape:'extrude',operation:'base',center:[0,0,0],rotation:[0,0,0],depth:1};Object.defineProperty(accessor,'profile',{get:bomb});assert.equal(buildAssistantContext(emptyProject(),{},{recipe:[accessor]}).cadDraft.valid,false);
  const crossed={...extrude,profile:[[0,0],[1,1],[0,1],[1,0]]};assert.equal(buildAssistantContext(emptyProject(),{},{recipe:[crossed]}).cadDraft.valid,false);
});

test('real profile solids create and update CPU MPM/PBF while preserving IDs, contacts and materials',{skip:!available},async()=>{
  for(const method of ['mpm','pbf']){
    const p=addProjectPart(emptyProject(),{id:'guide',method:'rigid',geometry:{center:[-.8,1,0]}}),before=JSON.stringify(p);
    const created=await prepareAssistantPlan(p,response(create('profile-part',extrude,{method,density:1200,temperature:35})),native);
    let part=created.project.parts.find(b=>b.id==='profile-part');assert.equal(part.method,method);assert.equal(part.geometry.shape,'cad');assert.ok(Math.abs(part.geometry.cad.volume-.048)<1e-8);assert.equal(part.material.density,1200);assert.deepEqual(validateCADRecipe(part.geometry.cad.recipe),validateCADRecipe([extrude]));
    assert.equal(JSON.stringify(p),before);assert.equal(created.project.contactPairs.length,1);created.project.contactPairs[0].friction=.41;
    const updated=await prepareAssistantPlan(created.project,response(command('cad.update',{id:'profile-part',recipe:[revolve]})),native),changed=updated.project.parts.find(b=>b.id==='profile-part');
    assert.equal(changed.method,method);assert.deepEqual(changed.material,part.material);assert.deepEqual(changed.initial,part.initial);assert.deepEqual(updated.project.contactPairs,created.project.contactPairs);assert.deepEqual(updated.project.parts.find(b=>b.id==='guide'),p.parts[0]);assert.ok(Math.abs(changed.geometry.cad.volume-Math.PI*(.35**2-.2**2)*.6)<1e-7);assert.deepEqual(changed.geometry.rotation,[0,0,0]);
    assert.equal(updated.cadPreviews[0].operation,'update');assert.equal(updated.action,null);
  }
});

test('real profile plans preserve canonical matching, cancellation and stale apply protection',{skip:!available},async()=>{
  const p=emptyProject(),before=JSON.stringify(p),cad=await native.buildCAD([extrude]);
  const reordered={depth:extrude.depth,profile:extrude.profile,rotation:extrude.rotation,center:extrude.center,operation:'base',shape:'extrude'};
  const plan=await prepareAssistantPlan(p,response(create('part',reordered)),{buildCAD:async()=>cad});assert.equal(plan.project.parts.length,1);
  await assert.rejects(prepareAssistantPlan(p,response(create('part',{...extrude,depth:.3})),{buildCAD:async()=>cad}),/不一致/);
  const controller=new AbortController();await assert.rejects(prepareAssistantPlan(p,response(create('part',extrude)),{signal:controller.signal,buildCAD:async(_,{signal})=>{assert.equal(signal,controller.signal);controller.abort();return cad;}}),e=>e.name==='AbortError');assert.equal(JSON.stringify(p),before);
  let writes=0;await assert.rejects(executePlan(plan,{getProject:()=>({...p,name:'manually changed'}),busy:()=>false,assertApplied(){},load:async()=>writes++,control:async()=>{}}),/项目已变化/);assert.equal(writes,0);
});

test('real profile CAD surface preview and CPU FEM meshing use existing safe commands',{skip:!available},async()=>{
  const p=emptyProject(),solid=await prepareAssistantPlan(p,response(create('profile-part',extrude)),native);
  const preview=await prepareAssistantPlan(solid.project,response(command('cad.mesh',{id:'profile-part',options:{kind:'surface',targetSize:.2}})),native);
  assert.equal(preview.changed,false);assert.ok(preview.meshPreviews[0].mesh.elements.length>0);assert.deepEqual(validateCADRecipe(preview.meshPreviews[0].mesh.cad.recipe),validateCADRecipe([extrude]));
  const fem=await prepareAssistantPlan(p,response(create('profile-fem',extrude,{method:'fem',young:2e5,meshOptions:{targetSize:.2}})),native),part=fem.project.parts[0];
  assert.equal(part.method,'fem');assert.equal(part.boundary.fixedFace,'y-');assert.equal(part.material.young,2e5);assert.ok(part.discretization.mesh.elements.length>0);assert.equal(fem.meshPreviews[0].mesh.quality.negativeElements,0);assert.deepEqual(validateCADRecipe(part.discretization.mesh.source.recipe),validateCADRecipe([extrude]));
});
