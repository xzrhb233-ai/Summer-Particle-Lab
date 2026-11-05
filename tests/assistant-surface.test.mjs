import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {prepareAssistantPlan,planCommands,executePlan} from '../src/simulation/assistant-commands.js';
import {buildAssistantContext} from '../src/simulation/assistant-context.js';
import {validateSurfaceSpec,createSurfaceTemplate} from '../src/three/cad-surfaces.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const command=(command,args={})=>({command,args}),response=(...commands)=>({reply:'请检查开放参考曲面预览',commands});
const spec={kind:'bilinear',controlPoints:[[[0,0,0],[0,0,1]],[[1,0,0],[1,0,1]]],segmentsU:4,segmentsV:4};
const create=(id='surface-1',extra={})=>command('cad.surface.create',{id,name:'参考曲面',spec,...extra});
function surfaceData(input){
  const spec=validateSurfaceSpec(input),nodes=[],elements=[],{segmentsU:u,segmentsV:v,controlPoints:p}=spec,nu=p.length,nv=p[0].length;
  for(let i=0;i<=u;i++)for(let j=0;j<=v;j++)nodes.push([0,1,2].map(k=>(1-i/u)*(1-j/v)*p[0][0][k]+i/u*(1-j/v)*p[nu-1][0][k]+i/u*j/v*p[nu-1][nv-1][k]+(1-i/u)*j/v*p[0][nv-1][k]));
  for(let i=0;i<u;i++)for(let j=0;j<v;j++){const a=i*(v+1)+j,b=a+v+1;elements.push([a,b,b+1],[a,b+1,a+1]);}
  return {schema:'summer-cad-surface/1',kernel:'SMLib',version:'test-fixture',spec,nodes,elements,normals:nodes.map(()=>[0,-1,0]),area:1,areaApproximate:true,bounds:{lower:[0,Math.min(...nodes.map(n=>n[1])),0],upper:[1,Math.max(...nodes.map(n=>n[1])),1]},boundsApproximate:true,closed:false,degreeU:spec.kind==='bilinear'?1:3,degreeV:spec.kind==='bilinear'?1:3};
}
const buildSurface=async s=>surfaceData(s);
const lineData={schema:'summer-cad-curve/1',kernel:'SMLib',spec:{kind:'line',points:[[0,0,0],[1,0,0]],samples:8},points:Array.from({length:9},(_,i)=>[i/8,0,0]),length:1,closed:false,bounds:{lower:[0,0,0],upper:[1,0,0]}};

test('surface create/update/delete use an independent namespace and preserve physics, curves and materials',async()=>{
  const p=addProjectPart(emptyProject(),{id:'shared',method:'rigid'});p.cadCurves=[{id:'shared',name:'同名参考线',data:structuredClone(lineData)}];const before=JSON.stringify(p);
  const created=await prepareAssistantPlan(p,response(create('shared')),{buildSurface});
  assert.equal(JSON.stringify(p),before);assert.equal(created.project.cadSurfaces.length,1);assert.equal(created.surfacePreviews[0].operation,'create');assert.equal(created.surfacePreviews[0].surface.closed,false);assert.equal(created.project.parts.length,1);assert.deepEqual(created.project.cadCurves,p.cadCurves);assert.deepEqual(created.project.parts,p.parts);assert.equal(created.action,null);
  const shifted={...spec,controlPoints:spec.controlPoints.map(row=>row.map(([x,y,z])=>[x,y+.4,z]))};
  const updated=await prepareAssistantPlan(created.project,response(command('cad.surface.update',{id:'shared',spec:shifted})),{buildSurface});
  assert.equal(updated.project.cadSurfaces[0].name,'参考曲面');assert.equal(updated.surfacePreviews[0].operation,'update');assert.equal(updated.project.cadSurfaces[0].data.nodes[0][1],.4);assert.deepEqual(updated.project.parts,p.parts);
  const removed=await prepareAssistantPlan(updated.project,response(command('cad.surface.delete',{id:'shared'})));
  assert.deepEqual(removed.project.cadSurfaces,[]);assert.equal(removed.surfacePreviews,undefined);assert.deepEqual(removed.project.cadCurves,p.cadCurves);assert.deepEqual(removed.project.parts,p.parts);
  let current=p,writes=0;const host={getProject:()=>current,busy:()=>false,assertApplied(){},load:async project=>{current=project;writes++;},control:async()=>{throw Error('no run requested');}};
  const executed=await executePlan(created,host);assert.equal(executed.committed,true);assert.equal(writes,1);assert.equal(current.cadSurfaces.length,1);
});

test('surface validation rejects code, mesh injection, unsupported conversion and malformed control nets before builds',async()=>{
  const p=emptyProject(),before=JSON.stringify(p);let calls=0;const adapter={buildSurface:async s=>{calls++;return buildSurface(s);}};
  for(const extra of [{nodes:[]},{elements:[]},{path:'C:/private'},{url:'https://example.test'},{method:'fem'},{code:'eval(1)'}])await assert.rejects(prepareAssistantPlan(p,response(create('bad',extra)),adapter));
  const invalid=[{...spec,degreeU:3},{...spec,code:'eval(1)'},{...spec,segmentsU:0},{...spec,segmentsV:65},{...spec,segmentsU:4.5},{...spec,controlPoints:[spec.controlPoints[0]]},{...spec,controlPoints:[spec.controlPoints[0],[[1,0,0]]]},{...spec,controlPoints:[[[Infinity,0,0],[0,0,1]],spec.controlPoints[1]]},{...spec,kind:'bezier'},{...spec,kind:'bspline'},{...spec,kind:'constructor'}];
  for(const bad of invalid)await assert.rejects(prepareAssistantPlan(p,response(create('bad',{spec:bad})),adapter));
  assert.equal(calls,0);assert.equal(JSON.stringify(p),before);
  assert.throws(()=>planCommands(p,response(create())),/SMLib/);
  const references={...p,cadSurfaces:[{id:'open',name:'开放面',data:surfaceData(spec)}]};
  await assert.rejects(prepareAssistantPlan(references,response(command('cad.mesh',{id:'open',options:{kind:'volume'}})),{buildMesh:async()=>{calls++;}}),/现有 CAD 部件/);assert.equal(calls,0);
});

test('surface identity, size and shared build-budget guards are enforced before native work',async()=>{
  const p={...emptyProject(),cadSurfaces:[{id:'old',name:'已有面',data:surfaceData(spec)}]};let calls=0;const adapter={buildSurface:async s=>{calls++;return buildSurface(s);},buildCurve:async()=>{calls++;return structuredClone(lineData);}};
  for(const r of [response(create('old')),response(command('cad.surface.update',{id:'missing',spec})),response(command('cad.surface.delete',{id:'missing'})),response(create('new'),command('cad.surface.delete',{id:'new'})),response(create('new'),command('project.new'))])await assert.rejects(prepareAssistantPlan(p,r,adapter));
  const full={...emptyProject(),cadSurfaces:Array.from({length:16},(_,i)=>({id:'surface-'+i,name:'面'+i,data:surfaceData(spec)}))};await assert.rejects(prepareAssistantPlan(full,response(create('extra')),adapter),/16/);
  await assert.rejects(prepareAssistantPlan(p,response(...Array.from({length:4},(_,i)=>create('new-'+i)),command('cad.curve.create',{id:'curve',spec:lineData.spec})),adapter),/4/);assert.equal(calls,0);
  const deletes=await prepareAssistantPlan(full,response(...full.cadSurfaces.slice(0,5).map(s=>command('cad.surface.delete',{id:s.id}))));assert.equal(deletes.project.cadSurfaces.length,11);assert.equal(deletes.surfacePreviews,undefined);
});

test('surface failures, response mismatch, cancellation and stale execution do not partially edit projects',async()=>{
  const p=emptyProject(),before=JSON.stringify(p);let calls=0;
  await assert.rejects(prepareAssistantPlan(p,response(command('part.create',{id:'new-rigid',method:'rigid'}),create('first'),create('second')),{buildSurface:async s=>{if(++calls===2)throw Error('kernel rejected singular surface');return buildSurface(s);}}),/singular/);assert.equal(calls,2);assert.equal(JSON.stringify(p),before);
  await assert.rejects(prepareAssistantPlan(p,response(create()),{buildSurface:async s=>({...surfaceData(s),closed:true})}),/开放曲面/);
  await assert.rejects(prepareAssistantPlan(p,response(create()),{buildSurface:async()=>surfaceData({...spec,segmentsU:8})}),/不一致/);
  const controller=new AbortController();calls=0;await assert.rejects(prepareAssistantPlan(p,response(create()),{signal:controller.signal,buildSurface:async(s,{signal})=>{assert.equal(signal,controller.signal);calls++;controller.abort();return buildSurface(s);}}),e=>e.name==='AbortError');assert.equal(calls,1);assert.equal(JSON.stringify(p),before);
  const plan=await prepareAssistantPlan(p,response(create()),{buildSurface});let writes=0;await assert.rejects(executePlan(plan,{getProject:()=>({...p,name:'changed'}),busy:()=>false,assertApplied(){},load:async()=>writes++,control:async()=>{}}),/项目已变化/);assert.equal(writes,0);
});

test('reference surfaces preserve the chosen GPU solver and can coexist with curve IDs in the same plan',async()=>{
  const p=planCommands(emptyProject(),response(command('part.create',{id:'particle',method:'mpm'}),command('solver.configure',{device:'gpu'}))).project;
  const plan=await prepareAssistantPlan(p,response(create('shared'),command('cad.curve.create',{id:'shared',spec:lineData.spec})),{buildSurface,buildCurve:async()=>structuredClone(lineData)});
  assert.equal(plan.project.solver.computeBackend,'gpu');assert.deepEqual(plan.project.solver,p.solver);assert.equal(plan.project.cadSurfaces[0].id,'shared');assert.equal(plan.project.cadCurves[0].id,'shared');
});

test('surface context omits samples and retains safe definitions, approximate metrics and independent drafts',()=>{
  const p=emptyProject(),data=surfaceData({...spec,segmentsU:64,segmentsV:64});p.cadSurfaces=[{id:'surface',name:'曲面',data}];data.nodes[0][0]=.01234567890123456;data.secret='secret-marker';
  const source=JSON.stringify(p),draft={recipe:[],curveDraft:{invalidDraft:true},surfaceDraft:{id:'surface',name:'草稿',spec:{...spec,path:'private-path',secret:'secret-marker'},unsavedChanges:true,previewCurrent:false,nodes:[[999,999,999]],code:'do not execute'}};
  const context=buildAssistantContext(p,{time:0},draft),saved=context.project.cadSurfaces[0].data,safe=context.cadDraft.surfaceDraft;
  assert.deepEqual(saved.spec,{...spec,segmentsU:64,segmentsV:64});assert.deepEqual(saved.mesh,{omitted:true,nodeCount:4225,triangleCount:8192,normalCount:4225});assert.equal(saved.area,1);assert.equal(saved.areaApproximate,true);assert.equal(saved.boundsApproximate,true);assert.equal(saved.closed,false);assert.equal(saved.degreeU,1);assert.deepEqual(saved.bounds,data.bounds);
  for(const key of ['nodes','elements','normals'])assert.equal(key in saved,false);assert.equal(JSON.stringify(p),source);assert.ok(JSON.stringify(context).length<12000);assert.equal(JSON.stringify(context).includes('0.01234567890123456'),false);
  assert.equal(context.cadDraft.valid,false);assert.equal(context.cadDraft.curveDraft.valid,false);assert.equal(safe.valid,true);assert.equal(safe.id,'surface');assert.equal(safe.unsavedChanges,true);assert.equal(safe.previewCurrent,false);assert.equal(safe.previewIsSimulationResult,false);
  for(const denied of ['private-path','secret-marker','do not execute','999'])assert.equal(JSON.stringify(context).includes(denied),false);
  saved.spec.controlPoints[0][0][0]=99;safe.spec.controlPoints[0][0][0]=99;assert.equal(JSON.stringify(p),source);assert.equal(draft.surfaceDraft.spec.controlPoints[0][0][0],0);
  const cap=context.capabilities.cad.surfaces;assert.deepEqual(cap.kinds,['bilinear','bezier','bspline']);assert.equal(cap.storage,'project.cadSurfaces');assert.match(cap.role,/no closed volume/);assert.match(cap.accuracy,/approximations/);assert.equal(cap.limits.maxSurfaces,16);
});

test('surface draft control grids are getter-safe and whitelist only supported specifications',()=>{
  const bomb=()=>{throw Error('getter must not run');};
  for(const kind of ['bilinear','bezier','bspline']){const s=createSurfaceTemplate(kind);const context=buildAssistantContext(emptyProject(),{},{surfaceDraft:{spec:s}});assert.equal(context.cadDraft.surfaceDraft.valid,true);assert.equal(context.cadDraft.surfaceDraft.spec.kind,kind);}
  const s=structuredClone(spec);Object.defineProperty(s,'key',{enumerable:true,get:bomb});Object.defineProperty(s.controlPoints,'map',{get:bomb});Object.defineProperty(s.controlPoints[0],'map',{get:bomb});Object.defineProperty(s.controlPoints[0][0],'slice',{get:bomb});
  let context=buildAssistantContext(emptyProject(),{},{surfaceDraft:{spec:s}});assert.equal(context.cadDraft.surfaceDraft.valid,true);
  Object.defineProperty(s.controlPoints[0][0],'0',{get:bomb});context=buildAssistantContext(emptyProject(),{},{surfaceDraft:{spec:s}});assert.equal(context.cadDraft.surfaceDraft.valid,false);
  const accessor={kind:'bilinear'};Object.defineProperty(accessor,'controlPoints',{get:bomb});assert.equal(buildAssistantContext(emptyProject(),{},{surfaceDraft:{spec:accessor}}).cadDraft.surfaceDraft.valid,false);
  for(const kind of ['constructor','__proto__','sweep'])assert.equal(buildAssistantContext(emptyProject(),{},{surfaceDraft:{spec:{kind}}}).cadDraft.surfaceDraft.valid,false);
  const data=surfaceData(spec);for(const key of ['nodes','elements','normals'])Object.defineProperty(data[key],'0',{get:bomb});context=buildAssistantContext({...emptyProject(),cadSurfaces:[{id:'s',name:'面',data}]},{});assert.equal(context.project.cadSurfaces[0].data.mesh.nodeCount,25);
});

test('real SMLib reference surfaces pass AI validation without becoming simulation parts',{skip:!available},async()=>{
  const p=emptyProject(),plan=await prepareAssistantPlan(p,response(create('bilinear',{spec}),create('bezier',{spec:createSurfaceTemplate('bezier')}),create('bspline',{spec:createSurfaceTemplate('bspline',5,6)})),{buildSurface:spec=>runCAD({action:'surface',spec})});
  assert.equal(plan.project.parts.length,0);assert.equal(plan.project.cadSurfaces.length,3);assert.equal(plan.surfacePreviews.length,3);assert.equal(plan.action,null);
  for(const entry of plan.project.cadSurfaces){assert.equal(entry.data.kernel,'SMLib');assert.equal(entry.data.closed,false);assert.ok(entry.data.area>0);assert.equal(entry.data.areaApproximate,true);assert.equal(entry.data.nodes.length,(entry.data.spec.segmentsU+1)*(entry.data.spec.segmentsV+1));}
  assert.ok(Math.abs(plan.project.cadSurfaces[0].data.area-1)<1e-8);assert.equal(p.cadSurfaces,undefined);
});
