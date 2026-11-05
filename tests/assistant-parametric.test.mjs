import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {emptyProject,addProjectPart,updateProjectPart} from '../src/simulation/part-builder.js';
import {prepareAssistantPlan,parseAssistantResponse,COMMANDS,SYSTEM_PROMPT,executePlan,assistantErrorDiagnostics} from '../src/simulation/assistant-commands.js';
import {buildAssistantContext} from '../src/simulation/assistant-context.js';
import {createParametricSpec,compileParametricRecipe} from '../src/simulation/cad-parametric.js';
import {validateExplicitMesh} from '../src/fem/explicit-mesh.js';
import {cadMesh} from '../src/fem/mesh.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const native={buildCAD:recipe=>runCAD({action:'build',recipe}),buildMesh:(recipe,options)=>runCAD({action:'mesh',recipe,options})};
const command=(command,args={})=>({command,args}),response=(...commands)=>({reply:'请检查尺寸变化后应用',commands});
const create=(template='four-hole-plate',extra={})=>command('cad.parametric.create',{id:'parametric',template,method:'mpm',...extra});
const update=parameters=>command('cad.parametric.update',{id:'parametric',parameters});

test('parametric commands are bounded numeric template patches with no code, paths or recipe replacement',async()=>{
  assert.ok(COMMANDS['cad.parametric.create'].includes('template'));assert.ok(!COMMANDS['cad.parametric.update'].includes('template'));
  for(const phrase of ['cad.parametric.update','legThickness','holeDiameter','pitchX','diagnostics','整体缩放'])assert.ok(SYSTEM_PROMPT.includes(phrase));
  for(const patch of [{recipe:[]},{template:'sleeve'},{center:[0,0,0]},{path:'private'},{code:'eval(1)'},{nodes:[]}])assert.throws(()=>parseAssistantResponse(JSON.stringify(response(command('cad.parametric.update',{id:'parametric',parameters:{},...patch})))));
  let calls=0;const before=emptyProject(),adapter={buildCAD:async()=>calls++};
  for(const [template,parameters] of [['unknown',{}],['sleeve',{innerRadius:.5,outerRadius:.4}],['l-bracket',{legThickness:1}],['four-hole-plate',{holeDiameter:.5}],['sleeve',{height:'1'}],['sleeve',{path:'secret'}],['sleeve',null]]){
    await assert.rejects(prepareAssistantPlan(before,response(create(template,{parameters})),adapter),error=>Array.isArray(error.issues)&&error.issues.every(issue=>issue.field&&issue.code));
  }
  assert.equal(calls,0);assert.deepEqual(before,emptyProject());
  const diagnostic=assistantErrorDiagnostics({message:'bad value',issues:[{code:'range',field:'width',message:'too small',stack:'private',apiKey:'secret',payload:{path:'private'}}]});
  assert.deepEqual(diagnostic.issues,[{code:'range',field:'width',message:'too small'}]);assert.ok(!JSON.stringify(diagnostic).includes('private'));
});

test('parametric context includes editable dimensions, safe independent drafts and actual placement without mesh arrays',()=>{
  const spec=createParametricSpec('four-hole-plate'),p=emptyProject();
  p.parts=[{id:'parametric',name:'四孔板',method:'mpm',modeling:{...spec,path:'secret'},geometry:{shape:'cad',center:[.2,.7,.1],rotation:[10,20,30],size:[.9,.16,.7],cad:{recipe:compileParametricRecipe(spec),lower:[-.45,-.08,-.35],upper:[.45,.08,.35],volume:.08,vertices:[[0,0,0]],indices:[0,0,0]}}}];
  const draft={sourcePartId:'parametric',name:'待编辑',method:'mpm',modeling:spec,center:[.2,.7,.1],rotation:[10,20,30],unsavedChanges:true,previewCurrent:false};
  Object.defineProperty(draft,'apiKey',{enumerable:true,get(){throw Error('never execute getter');}});
  const context=buildAssistantContext(p,{}, {parametricDraft:draft}),part=context.project.parts[0];
  assert.deepEqual(part.modeling,spec);assert.equal(part.editableParameters.find(f=>f.key==='holeDiameter').value,.14);assert.equal(part.parametricEditing.allowed,true);
  assert.deepEqual(part.geometry.cad.worldPlacement.center,[.2,.7,.1]);assert.deepEqual(part.geometry.cad.worldPlacement.rotation,[10,20,30]);
  assert.equal(context.cadDraft.valid,false);assert.equal(context.cadDraft.parametricDraft.valid,true);assert.equal(context.cadDraft.parametricDraft.unsavedChanges,true);assert.equal(context.cadDraft.parametricDraft.sourcePartId,'parametric');
  assert.equal(context.capabilities.cad.parametric.templates.length,3);assert.ok(!JSON.stringify(context).includes('secret'));assert.ok(!JSON.stringify(context).includes('"vertices"'));
  p.parts[0].geometry.size[0]=1.8;assert.equal(buildAssistantContext(p,{}).project.parts[0].parametricEditing.allowed,false);
  const bad=structuredClone(spec);Object.defineProperty(bad.parameters,'width',{get(){throw Error('never execute getter');}});
  assert.equal(buildAssistantContext(emptyProject(),{},{parametricDraft:{modeling:bad}}).cadDraft.parametricDraft.valid,false);
});

test('real parametric templates produce local closed CAD with stable actual placement and readable initial dimensions',{skip:!available},async()=>{
  for(const template of ['l-bracket','sleeve','four-hole-plate']){
    const original=emptyProject(),before=JSON.stringify(original),plan=await prepareAssistantPlan(original,response(create(template,{center:[.1,.8,.2],rotation:[0,25,0]})),native),part=plan.project.parts[0];
    assert.equal(JSON.stringify(original),before);assert.equal(part.modeling.template,template);assert.deepEqual(part.geometry.cad.recipe,compileParametricRecipe(part.modeling));
    assert.deepEqual(part.geometry.center,[.1,.8,.2]);assert.deepEqual(part.geometry.rotation,[0,25,0]);assert.ok(part.geometry.cad.closed);assert.ok(part.geometry.cad.volume>0);
    assert.ok(plan.parameterChanges[0].changes.every(change=>change.before===null&&Number.isFinite(change.after)&&change.label));assert.equal(plan.parameterChanges[0].operation,'create');
  }
});

test('real parameter patch preserves IDs, transforms, materials, support, contact and undo snapshot; raw edit detaches spec',{skip:!available},async()=>{
  const base=addProjectPart(emptyProject(),{id:'existing',method:'rigid'}),created=await prepareAssistantPlan(base,response(create('four-hole-plate',{center:[.1,.8,.2],rotation:[15,25,10],density:1200,temperature:55,velocity:[.1,0,0],fixedFace:'minX'})),native);
  const p=created.project,old=p.parts.find(b=>b.id==='parametric'),before=JSON.stringify(p);p.contactPairs[0].friction=.37;
  const source=JSON.stringify(p),plan=await prepareAssistantPlan(p,response(update({holeDiameter:.18,pitchX:.55})),native),part=plan.project.parts.find(b=>b.id==='parametric');
  assert.equal(JSON.stringify(p),source);assert.equal(part.id,old.id);assert.deepEqual(part.geometry.center,old.geometry.center);assert.deepEqual(part.geometry.rotation,old.geometry.rotation);
  for(const key of ['material','initial','boundary'])assert.deepEqual(part[key],old[key]);for(const key of ['loads','selectionSets','loadBindings','contactPairs','frames','curves'])assert.deepEqual(plan.project[key],p[key]);
  assert.deepEqual(plan.project.parts.find(b=>b.id==='existing'),p.parts.find(b=>b.id==='existing'));
  assert.deepEqual(plan.parameterChanges[0].changes.map(c=>[c.field,c.before,c.after]),[['holeDiameter',.14,.18],['pitchX',.5,.55]]);
  assert.equal(part.modeling.parameters.width,old.modeling.parameters.width);assert.ok(part.geometry.cad.volume<old.geometry.cad.volume);
  let current=p,loads=0;const host={getProject:()=>current,busy:()=>false,assertApplied(){},load:async value=>{current=value;loads++;},control:async()=>assert.fail('no requested run')};
  await executePlan(plan,host);assert.equal(loads,1);assert.equal(current.parts.find(b=>b.id==='parametric').modeling.parameters.holeDiameter,.18);
  await host.load(JSON.parse(plan.before));assert.equal(JSON.stringify(current),source,'undo restores the complete before snapshot');
  current=JSON.parse(before);await assert.rejects(executePlan(plan,host),/项目已变化/);
  const raw=await prepareAssistantPlan(p,response(command('cad.update',{id:'parametric',recipe:old.geometry.cad.recipe})),native);assert.equal(raw.project.parts.find(b=>b.id==='parametric').modeling,undefined);
});

test('scaled parametric solids reject dimension patches before building and require restoring native size',{skip:!available},async()=>{
  const created=await prepareAssistantPlan(emptyProject(),response(create('sleeve')),native),part=created.project.parts[0],scaled=updateProjectPart(created.project,part.id,{geometry:{size:part.geometry.size.map(n=>n*2)}});let calls=0;
  await assert.rejects(prepareAssistantPlan(scaled,response(update({outerRadius:.45})),{buildCAD:async()=>calls++}),e=>e.issues.some(i=>i.code==='scaled_geometry'&&i.field==='geometry.size')&&/恢复/.test(e.message));assert.equal(calls,0);
  const restored=updateProjectPart(scaled,part.id,{geometry:{size:part.geometry.size}}),plan=await prepareAssistantPlan(restored,response(update({outerRadius:.45})),native);
  assert.equal(plan.project.parts[0].modeling.parameters.outerRadius,.45);
});

test('parametric kernel mismatch, cancellation and mixed failures remain atomic',{skip:!available},async()=>{
  const original=emptyProject(),before=JSON.stringify(original),built=await native.buildCAD(compileParametricRecipe(createParametricSpec('sleeve')));
  await assert.rejects(prepareAssistantPlan(original,response(create('l-bracket')),{buildCAD:async()=>built}),/不一致/);
  const controller=new AbortController();await assert.rejects(prepareAssistantPlan(original,response(create('sleeve')),{signal:controller.signal,buildCAD:async()=>{controller.abort();return built;}}),e=>e.name==='AbortError');
  await assert.rejects(prepareAssistantPlan(original,response(create('sleeve'),command('cad.parametric.update',{id:'missing',parameters:{height:.5}})),{buildCAD:async()=>built}),/现有/);
  assert.equal(JSON.stringify(original),before);
});

test('real FEM parametric change remeshes positive Tet4 elements and keeps support/material/load settings',{skip:!available},async()=>{
  const created=await prepareAssistantPlan(emptyProject(),response(create('l-bracket',{method:'fem',center:[.1,.8,.2],rotation:[0,20,0],meshOptions:{targetSize:.22},young:2e5,poisson:.28,density:1300,cp:700,conductivity:40,temperature:65,fixedFace:'y-'})),native);
  const old=created.project.parts[0];let requestedOptions;
  const plan=await prepareAssistantPlan(created.project,response(command('cad.parametric.update',{id:'parametric',parameters:{legThickness:.24}})),{...native,buildMesh:(recipe,options)=>{requestedOptions=options;return native.buildMesh(recipe,options);}}),part=plan.project.parts[0];
  assert.equal(old.discretization.cadMeshOptions.targetSize,.22);assert.deepEqual(requestedOptions,old.discretization.cadMeshOptions);assert.deepEqual(part.discretization.cadMeshOptions,old.discretization.cadMeshOptions);
  validateExplicitMesh(part.discretization.mesh,part.geometry.cad);assert.ok(part.discretization.mesh.elements.length>0);assert.equal(plan.meshPreviews[0].mesh.quality.negativeElements,0);
  assert.notDeepEqual(part.discretization.mesh.nodes,old.discretization.mesh.nodes);assert.deepEqual(part.geometry.center,old.geometry.center);assert.deepEqual(part.geometry.rotation,old.geometry.rotation);
  for(const key of ['material','initial','boundary'])assert.deepEqual(part[key],old[key]);for(const key of ['loads','selectionSets','loadBindings','contactPairs'])assert.deepEqual(plan.project[key],created.project[key]);
  assert.equal(plan.parameterChanges[0].changes[0].field,'legThickness');assert.equal(part.modeling.parameters.legThickness,.24);
  const runtime=cadMesh(part),angle=20*Math.PI/180;
  for(const [i,[x,y,z]] of part.discretization.mesh.nodes.entries()){
    const expected=[.1+x*Math.cos(angle)+z*Math.sin(angle),.8+y,.2-x*Math.sin(angle)+z*Math.cos(angle)];
    assert.ok(runtime.nodes[i].every((n,k)=>Math.abs(n-expected[k])<1e-9),'solver mesh applies the saved actual placement exactly once');
  }
});
