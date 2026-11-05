import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {prepareAssistantPlan,planCommands,executePlan} from '../src/simulation/assistant-commands.js';
import {validateCurveSpec,validateMeshOptions} from '../src/three/cad-tools.js';

const example=JSON.parse(readFileSync(new URL('../cad/examples/perforated-block.json',import.meta.url),'utf8'));
const cad=example.parts[0].geometry.cad;
const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const command=(command,args={})=>({command,args}),response=(...commands)=>({reply:'请检查几何预览',commands});
const line={kind:'line',points:[[0,0,0],[1,0,0]],samples:8};
function curveData(input){const spec=validateCurveSpec(input),points=Array.from({length:spec.samples+1},(_,i)=>spec.points[0].map((v,k)=>v+(spec.points[1][k]-v)*i/spec.samples));return {schema:'summer-cad-curve/1',kernel:'SMLib',spec,points,length:Math.hypot(...spec.points[1].map((v,k)=>v-spec.points[0][k])),closed:false,bounds:{lower:points[0],upper:points.at(-1)}};}
const buildCurve=async spec=>curveData(spec);
const surfaceMesh=options=>({schema:'summer-cad-mesh/1',kind:'surface',cad:structuredClone(cad),nodes:structuredClone(cad.vertices),elements:Array.from({length:cad.indices.length/3},(_,i)=>cad.indices.slice(i*3,i*3+3)),surface:Array.from({length:cad.indices.length/3},(_,i)=>cad.indices.slice(i*3,i*3+3)),options:validateMeshOptions(options)});

test('AI geometry curves create, update and delete atomically without replacing parts or load curves',async()=>{
  const p=addProjectPart(emptyProject(),{method:'rigid',id:'existing'}),before=JSON.stringify(p);
  const created=await prepareAssistantPlan(p,response(command('cad.curve.create',{id:'path',name:'参考线',spec:line})),{buildCurve});
  assert.equal(JSON.stringify(p),before);assert.equal(created.project.cadCurves.length,1);assert.deepEqual(created.project.parts,p.parts);assert.deepEqual(created.project.curves,p.curves);
  assert.equal(created.curvePreviews[0].operation,'create');assert.equal(created.cadPreviews.length,0);assert.equal(created.project.cadCurves[0].data.length,1);
  const updated=await prepareAssistantPlan(created.project,response(command('cad.curve.update',{id:'path',spec:{...line,points:[[0,0,0],[2,0,0]]}})),{buildCurve});
  assert.equal(updated.project.cadCurves[0].name,'参考线');assert.equal(updated.project.cadCurves[0].data.length,2);assert.equal(updated.curvePreviews[0].operation,'update');
  const deleted=await prepareAssistantPlan(updated.project,response(command('cad.curve.delete',{id:'path'})));
  assert.deepEqual(deleted.project.cadCurves,[]);assert.equal(deleted.curvePreviews,undefined);assert.deepEqual(deleted.project.parts,p.parts);
});

test('AI curve guards reject unknown fields, duplicates, missing IDs, limits and returned spec mismatches',async()=>{
  let calls=0;const adapter={buildCurve:async s=>{calls++;return buildCurve(s);}},p=emptyProject();
  for(const spec of [{...line,url:'https://example.test'},{...line,points:[[0,0,0]]},{kind:'bspline',controlPoints:line.points,degree:3},{kind:'arc',center:[0,0,0],radius:1,startAngle:0,endAngle:360},{kind:'sweep',points:line.points}])await assert.rejects(prepareAssistantPlan(p,response(command('cad.curve.create',{id:'path',spec})),adapter));
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.curve.update',{id:'missing',spec:line})),adapter));
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.curve.create',{id:'path',spec:line}),command('cad.curve.delete',{id:'path'})),adapter));
  const full={...p,cadCurves:Array.from({length:32},(_,i)=>({id:'curve-'+i,name:'线'+i,data:curveData(line)}))};
  await assert.rejects(prepareAssistantPlan(full,response(command('cad.curve.create',{id:'path',spec:line})),adapter),/32/);assert.equal(calls,0);
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.curve.create',{id:'path',spec:line})),{buildCurve:async()=>curveData({...line,points:[[0,0,0],[3,0,0]]})}),/不一致/);
});

test('AI mesh command is a read-only original CAD coordinate preview with no solver or part edits',async()=>{
  const p=structuredClone(example);p.parts[0].geometry.center=[.5,1,.4];p.parts[0].geometry.rotation=[0,45,0];const before=JSON.stringify(p),options={kind:'surface',targetSize:.12};
  const plan=await prepareAssistantPlan(p,response(command('cad.mesh',{id:'mpm-1',options})),{buildMesh:async(recipe,o)=>{assert.deepEqual(recipe,cad.recipe);return surfaceMesh(o);}});
  assert.equal(plan.changed,false);assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify(plan.project),before);assert.deepEqual(plan.meshPreviews[0].mesh.nodes,cad.vertices);
  assert.equal(plan.meshPreviews[0].id,'mpm-1');assert.equal(plan.cadPreviews.length,0);
  let writes=0;await executePlan(plan,{getProject:()=>p,busy:()=>false,load:async()=>writes++,control:async()=>{},assertApplied(){}});assert.equal(writes,0);
});

test('mesh request guards and a failed mixed curve/part batch preserve the entire input project',async()=>{
  const p=structuredClone(example),before=JSON.stringify(p);let calls=0;
  for(const options of [{kind:'shell'},{kind:'surface',path:'x'},{kind:'surface',targetSize:0}])await assert.rejects(prepareAssistantPlan(p,response(command('cad.mesh',{id:'mpm-1',options})),{buildMesh:async()=>{calls++;}}));assert.equal(calls,0);
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.mesh',{id:'none',options:{kind:'surface'}})),{buildMesh:async()=>{calls++;}}));assert.equal(calls,0);
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.curve.create',{id:'path',spec:line}),command('part.create',{method:'rigid',id:'new'}),command('cad.mesh',{id:'mpm-1',options:{kind:'volume'}})),{buildCurve,buildMesh:async()=>{throw Error('mesh failed');}}),/mesh failed/);
  assert.equal(JSON.stringify(p),before);
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.mesh',{id:'mpm-1',options:{kind:'surface'}})),{buildMesh:async()=>surfaceMesh({kind:'surface',targetSize:.3})}),/不一致/);
  await assert.rejects(prepareAssistantPlan(p,response(...Array.from({length:5},(_,i)=>command('cad.curve.create',{id:'path-'+i,spec:line}))),{buildCurve}),/4/);
});

test('mesh previews reject later deletion, replacement and transforms before calling the builder',async()=>{
  const p=structuredClone(example),before=JSON.stringify(p);let calls=0;
  const preview=command('cad.mesh',{id:'mpm-1',options:{kind:'surface'}}),adapter={buildMesh:async(_recipe,options)=>{calls++;return surfaceMesh(options);}};
  for(const later of [command('part.delete',{id:'mpm-1'}),command('project.new'),command('cad.update',{id:'mpm-1',recipe:cad.recipe}),command('part.update',{id:'mpm-1',shape:'box'}),command('part.update',{id:'mpm-1',center:[1,1,1]})])await assert.rejects(prepareAssistantPlan(p,response(preview,later),adapter),/CAD|几何/);
  assert.equal(calls,0);assert.equal(JSON.stringify(p),before);
  const renamed=await prepareAssistantPlan(p,response(preview,command('part.update',{id:'mpm-1',name:'最终试样名'})),adapter);assert.equal(renamed.meshPreviews[0].name,'最终试样名');
});

test('CAD FEM strict loading rejects atomically without falling back or starting a simulation',async()=>{
  let current=emptyProject(),runtime={time:1.5,result:'previous simulation'},normalLoads=0,strictLoads=0,controls=0;
  const oldRuntime=runtime,before=JSON.stringify(current),plan={...planCommands(current,response(command('part.create',{method:'fem',id:'prepared-fem'}),command('simulation.run'))),cadPreviews:[{id:'prepared-fem',method:'fem'}]};
  const host={getProject:()=>current,busy:()=>false,assertApplied(){},load:async project=>{normalLoads++;current=project;runtime=null;},loadStrict:async()=>{strictLoads++;throw Error('CAD component has no support');},control:async()=>controls++};
  await assert.rejects(executePlan(plan,host),e=>e.message==='CAD component has no support'&&e.committed===false);
  assert.equal(strictLoads,1);assert.equal(normalLoads,0);assert.equal(controls,0);assert.equal(JSON.stringify(current),before);assert.equal(runtime,oldRuntime);
  host.loadStrict=async project=>{strictLoads++;current=project;runtime={time:0};};
  const result=await executePlan(plan,host);assert.equal(result.committed,true);assert.equal(result.action,'run');assert.equal(strictLoads,2);assert.equal(normalLoads,0);assert.equal(controls,1);
  current=JSON.parse(before);const {loadStrict,...fallback}=host;
  await executePlan(plan,fallback);assert.equal(normalLoads,1,'non-workspace hosts keep the existing load fallback');
});

test('real SMLib AI Bezier and arc curve definitions return validated sampled geometry',{skip:!available},async()=>{
  const p=emptyProject(),plan=await prepareAssistantPlan(p,response(command('cad.curve.create',{id:'bezier',name:'曲线路径',spec:{kind:'bezier',controlPoints:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],samples:16}}),command('cad.curve.create',{id:'arc',spec:{kind:'arc',center:[0,0,0],radius:.5,startAngle:0,endAngle:90,samples:16}})),{buildCurve:spec=>runCAD({action:'curve',spec})});
  assert.equal(plan.project.cadCurves.length,2);assert.equal(plan.curvePreviews.length,2);assert.equal(plan.project.cadCurves[0].data.points.length,17);assert.ok(plan.project.cadCurves[0].data.length>1);assert.ok(Math.abs(plan.project.cadCurves[1].data.length-Math.PI*.25)<1e-5);
});

test('real AI CAD FEM creation and remeshing preserve settings and produce positive Tet4s',{skip:!available},async()=>{
  const recipe=[{shape:'box',operation:'base',center:[0,.7,0],size:[.4,.4,.4],rotation:[0,0,0]}],meshOptions={targetSize:.2},adapter={buildMesh:(recipe,options)=>runCAD({action:'mesh',recipe,options})};
  const p=emptyProject(),created=await prepareAssistantPlan(p,response(command('cad.create',{id:'fem-cad',method:'fem',recipe,meshOptions,name:'CAD FEM',young:2e5,poisson:.28,cp:700,conductivity:40,temperature:65})),adapter);
  const b=created.project.parts[0];assert.equal(b.method,'fem');assert.equal(b.geometry.shape,'cad');assert.equal(b.boundary.fixedFace,'y-');assert.equal(b.material.young,2e5);assert.equal(b.material.cp,700);assert.equal(b.material.conductivity,40);assert.equal(b.initial.temperature,65);assert.ok(b.discretization.mesh.elements.length>0);assert.equal(created.meshPreviews[0].mesh.quality.negativeElements,0);
  const load=created.project.loads.find(l=>l.type==='fem-fixed');assert.equal(load.target,'fem-cad');assert.equal(created.project.selectionSets.find(s=>s.id===load.selection).region.face,'y-');
  const shifted=[{...recipe[0],center:[.5,.8,.2]}],updated=await prepareAssistantPlan(created.project,response(command('cad.update',{id:'fem-cad',recipe:shifted,meshOptions})),adapter);
  assert.deepEqual(updated.project.parts[0].material,b.material);assert.deepEqual(updated.project.parts[0].boundary,b.boundary);assert.deepEqual(updated.project.parts[0].initial,b.initial);assert.deepEqual(updated.project.parts[0].geometry.rotation,[0,0,0]);assert.deepEqual(updated.project.parts[0].geometry.center,[.5,.8,.2]);assert.deepEqual(updated.project.loads,created.project.loads);
  assert.ok(updated.project.parts[0].discretization.mesh.nodes.every(n=>n[0]>=.3-1e-8));
  const inspected=planCommands(updated.project,response(command('project.inspect')));assert.equal(inspected.changed,false);
  await assert.rejects(prepareAssistantPlan(created.project,response(command('cad.update',{id:'fem-cad',recipe,meshOptions:{kind:'surface'}})),adapter),/volume/);
  await assert.rejects(prepareAssistantPlan(created.project,response(command('solver.configure',{device:'gpu'})),adapter),/GPU/);
  const damaged=structuredClone(created.meshPreviews[0].mesh);[damaged.elements[0][0],damaged.elements[0][1]]=[damaged.elements[0][1],damaged.elements[0][0]];
  await assert.rejects(prepareAssistantPlan(p,response(command('cad.create',{id:'bad',method:'fem',recipe,meshOptions})),{buildMesh:async()=>damaged}),/翻转|退化/);
});
