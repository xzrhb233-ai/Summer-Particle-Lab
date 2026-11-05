import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCAD} from '../cad-server.mjs';
import {createParametricSpec,compileParametricRecipe} from '../src/simulation/cad-parametric.js';
import {listPartSurfaces,validateSurfaceRegion,resolveSurfaceSelection} from '../src/simulation/surface-selections.js';
import {validateReferences} from '../src/simulation/references.js';
import {normalizeThermalLoads} from '../src/simulation/thermal-loads.js';
import {femPart,cantileverProject,validateFEM,dynamicCantileverProject} from '../src/fem/model.js';
import {boxMesh} from '../src/fem/mesh.js';
import {boundaryData,FEMSimulation} from '../src/fem/solver.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';

const python=fileURLToPath(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const available=existsSync(python)&&spawnSync(python,['-c','import usd_brep, meshpy.tet'],{windowsHide:true}).status===0;
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const region=surface=>({type:'surface',surface});
const selection=(part,surface,id='wall')=>({id,name:surface,part:part.id,entity:'face',region:region(surface)});
const nativeCache=new Map();
async function native(template,parameters={},targetSize=.2){
  const modeling=createParametricSpec(template,parameters),key=JSON.stringify([modeling,targetSize]);
  if(!nativeCache.has(key))nativeCache.set(key,runCAD({action:'mesh',recipe:compileParametricRecipe(modeling),options:{kind:'volume',targetSize}}));
  const generated=structuredClone(await nativeCache.get(key)),part=femPart('beam',{young:1e5,conductivity:0});
  part.modeling=modeling;part.geometry={shape:'cad',cad:generated.cad,center:[0,0,0],rotation:[0,0,0],size:generated.cad.upper.map((v,k)=>v-generated.cad.lower[k])};
  part.discretization={element:'tet4',mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes:generated.nodes,elements:generated.elements,surface:generated.surface,source:generated.source}};
  return part;
}
function projectFor(part,{dynamic=false}={}){
  const p=dynamic?dynamicCantileverProject({force:[0,0,0]}):cantileverProject({force:[0,0,0]});p.parts=[part];
  p.curves=[];p.loadBindings=[];p.environment.gravity=[0,0,0];p.solver.initialState='rest';return p;
}

test('named box surfaces preserve legacy nodal loads and solve after JSON round trip',()=>{
  const old=cantileverProject({divisions:[3,2,2],force:[1,-2,3]}),p=structuredClone(old),part=p.parts[0];
  assert.deepEqual(listPartSurfaces(part).map(s=>s.key),['box:x-','box:x+','box:y-','box:y+','box:z-','box:z+']);
  for(const s of p.selectionSets)s.region=region('box:'+s.region.face);
  const mesh=boxMesh(part),before=boundaryData(old,old.parts[0],mesh),after=boundaryData(p,part,mesh);
  assert.deepEqual(after.f,before.f);assert.deepEqual(after.fixed,before.fixed);
  assert.deepEqual(after.fixedSurfaceKeys,['box:x-']);assert.ok(after.fixedTriangles.length>0);
  const result=new FEMSimulation(JSON.parse(JSON.stringify(p))).step().fem.parts[0];
  assert.ok(result.summary.maxDisplacement>0);assert.ok(Math.hypot(...result.summary.forceBalance)<1e-6);
  const gpu=structuredClone(p);gpu.solver.computeBackend='gpu';assert.throws(()=>validateFEM(gpu),/CPU.*GPU/);
});

test('surface descriptors reject unknown, wrong-part and stale mesh references without fallback',()=>{
  const p=cantileverProject({divisions:[2,2,2]}),part=p.parts[0],mesh=boxMesh(part),s=selection(part,'box:x+');
  assert.throws(()=>validateSurfaceRegion(part,region('arbitrary-face-id')),/不存在|不受支持/);
  assert.throws(()=>resolveSurfaceSelection(part,mesh,{...s,part:'missing'}),/所属部件/);
  assert.throws(()=>validateReferences({...p,selectionSets:[{...s,entity:'node'}]}),/face/);
  part.geometry.center[0]+=.1;assert.throws(()=>resolveSurfaceSelection(part,mesh,s),/来源已变化/);
  part.geometry.center[0]-=.1;part.geometry.size[0]*=2;assert.throws(()=>resolveSurfaceSelection(part,mesh,s),/来源已变化/);
  const fresh=boxMesh(part);fresh.surface=fresh.surface.filter(t=>t.surfaceKey!=='box:x+'||t.nodes.includes(0));
  assert.throws(()=>resolveSurfaceSelection(part,fresh,s),/没有匹配|边界缺失/);
});

test('native four-hole walls bind only their actual boundary, and remain stable across remesh and parameter changes',{skip:!available},async()=>{
  const a=await native('four-hole-plate'),b=await native('four-hole-plate',{},.14),c=await native('four-hole-plate',{holeDiameter:.18,pitchX:.55,pitchZ:.42,thickness:.2});
  const key='four-hole-plate:hole:x-:z+',s=selection(a,key),areas=[];
  assert.notEqual(a.discretization.mesh.elements.length,b.discretization.mesh.elements.length);
  for(const part of [a,b,c]){
    const mesh=boxMesh(part),resolved=resolveSurfaceSelection(part,mesh,s),parameters=part.modeling.parameters;
    assert.equal(resolved.key,key);assert.ok(resolved.triangles.length>0);assert.ok(resolved.nodes.length>3);
    for(const triangle of resolved.triangles){
      assert.equal(triangle.face,'surface');assert.equal(triangle.surfaceKey,key);
      for(const n of triangle.nodes){const q=part.discretization.mesh.nodes[n];assert.ok(q[0]<0&&q[2]>0);assert.ok(Math.abs(Math.hypot(q[0]+parameters.pitchX/2,q[2]-parameters.pitchZ/2)-parameters.holeDiameter/2)<parameters.holeDiameter*.01);}
    }
    const analytic=Math.PI*parameters.holeDiameter*parameters.thickness;assert.ok(Math.abs(resolved.area/analytic-1)<.004);areas.push(resolved.area);
    const other=resolveSurfaceSelection(part,mesh,region('four-hole-plate:hole:x+:z+'));
    assert.ok(other.nodes.every(n=>!resolved.nodes.includes(n)));
  }
  // The native curved tessellation can change with target size; its area
  // converges to the same analytic wall, while the semantic identity is exact.
  assert.ok(areas[2]>areas[0]);assert.ok(Math.abs(areas[0]/areas[1]-1)<.001);
});

test('native named wall fixed/force/pressure and dynamic curve weights use the same resolved triangles',{skip:!available},async()=>{
  const part=await native('four-hole-plate'),p=projectFor(part),mesh=boxMesh(part);
  p.selectionSets=[selection(part,'four-hole-plate:hole:x-:z-','beam-support'),selection(part,'four-hole-plate:hole:x+:z+','beam-load')];
  const wall=resolveSurfaceSelection(part,mesh,p.selectionSets[1]),support=resolveSurfaceSelection(part,mesh,p.selectionSets[0]);
  p.loads[1].force=[3,4,-5];const force=boundaryData(p,part,mesh);
  for(let k=0;k<3;k++)close(force.f.reduce((sum,v,i)=>sum+(i%3===k?v:0),0),p.loads[1].force[k]);
  for(let n=0;n<mesh.nodes.length;n++){assert.equal(force.fixed[3*n],support.nodes.includes(n)?1:0);if(!wall.nodes.includes(n))assert.deepEqual(Array.from(force.f.slice(3*n,3*n+3)),[0,0,0]);}
  p.loads[1]={id:'beam-traction',type:'fem-pressure',target:part.id,selection:'beam-load',pressure:2500};
  const pressure=boundaryData(p,part,mesh),expected=new Float64Array(pressure.f.length);
  for(const t of wall.triangles)for(const n of t.nodes)for(let k=0;k<3;k++)expected[3*n+k]-=2500*t.area*t.normal[k]/3;
  expected.forEach((v,i)=>close(pressure.f[i],v));assert.ok(expected.some(v=>Math.abs(v)>0));
  const dynamic=projectFor(part,{dynamic:true});dynamic.selectionSets=p.selectionSets;dynamic.loads=p.loads;
  dynamic.curves=[{id:'rise',name:'压力',type:'linear',points:[[0,2],[1,3]]}];
  dynamic.loadBindings=[{id:'pressure-program',kind:'fem-pressure',target:part.id,load:'beam-traction',curve:'rise',scale:1250,offset:0,enabled:true}];
  const sim=new FEMDynamicSimulation(dynamic),state=sim.states[0];
  state.bindings[0].weights.forEach((v,i)=>close(v*2500,expected[i]));
  const frame=sim.step(.00001);assert.ok(state.u.some(v=>v!==0));assert.ok(state.u.every(Number.isFinite));assert.ok(Number.isFinite(frame.loadResponses[0].response));
  assert.deepEqual(frame.fem.parts[0].loadedSurfaceKeys,['four-hole-plate:hole:x+:z+']);
});

test('native template selections follow rigid transforms and nonuniform scale using actual world boundary area',{skip:!available},async()=>{
  const part=await native('sleeve'),key='sleeve:inner-wall',base=boxMesh(part),before=resolveSurfaceSelection(part,base,region(key));
  part.geometry.center=[4,-2,1];part.geometry.rotation=[23,41,-17];
  let transformed=resolveSurfaceSelection(part,boxMesh(part),region(key));close(transformed.area,before.area,1e-10);assert.deepEqual(transformed.nodes,before.nodes);
  part.geometry.size=part.geometry.size.map(v=>v*1.7);transformed=resolveSurfaceSelection(part,boxMesh(part),region(key));close(transformed.area,before.area*1.7**2,1e-9);
  part.geometry.size[1]*=.4;transformed=resolveSurfaceSelection(part,boxMesh(part),region(key));close(transformed.area,before.area*1.7**2*.4,1e-9);
  const outer=resolveSurfaceSelection(part,boxMesh(part),region('sleeve:outer-wall'));assert.ok(outer.nodes.every(n=>!transformed.nodes.includes(n)));assert.ok(outer.area>transformed.area*1.99);
});

test('template disappearance, unsupported raw CAD and broken native boundary coverage are explicit errors',{skip:!available},async()=>{
  const part=await native('sleeve',{angle:230}),mesh=boxMesh(part),set=selection(part,'sleeve:cut-end');
  assert.ok(resolveSurfaceSelection(part,mesh,set).area>0);
  const closed=await native('sleeve');assert.throws(()=>resolveSurfaceSelection(closed,boxMesh(closed),set),/不存在|不受支持/);
  const raw=structuredClone(part);delete raw.modeling;assert.deepEqual(listPartSurfaces(raw),[]);assert.throws(()=>validateSurfaceRegion(raw,set.region),/不受支持/);
  const stale=structuredClone(part);stale.modeling.parameters.innerRadius=.25;assert.throws(()=>validateSurfaceRegion(stale,region('sleeve:inner-wall')),/来源已失效/);
  const broken=structuredClone(part);broken.geometry.cad.indices.splice(0,3);const partial=boxMesh(broken);
  assert.ok(Object.keys(partial.surfaceErrors).length);const invalid=Object.keys(partial.surfaceErrors)[0];assert.throws(()=>resolveSurfaceSelection(broken,partial,region(invalid)),/边界缺失|不一致/);
});

test('L bracket inner step faces are distinct from bounding planes',{skip:!available},async()=>{
  const part=await native('l-bracket'),mesh=boxMesh(part),x=resolveSurfaceSelection(part,mesh,region('l-bracket:inner-x')),y=resolveSurfaceSelection(part,mesh,region('l-bracket:inner-y'));
  close(x.area,.2,1e-7);close(y.area,.3,1e-7);assert.ok(x.triangles.every(t=>t.face==='surface'));assert.ok(y.triangles.every(t=>t.face==='surface'));
  assert.ok(x.triangleIndices.every(i=>!y.triangleIndices.includes(i)));
});

test('named thermal selection stays bound after selection edit and distributes heat only over the chosen native wall',{skip:!available},async()=>{
  const part=await native('sleeve'),p=projectFor(part,{dynamic:true});p.solver.thermal=true;
  p.selectionSets[0].region=region('sleeve:y-');p.selectionSets[1].region=region('sleeve:outer-wall');
  p.loads.push({id:'wall-heat',type:'thermal-power',target:part.id,selection:'beam-load',power:100,enabled:true});
  normalizeThermalLoads(p);assert.equal(p.loads.at(-1).region.surface,'sleeve:outer-wall');
  p.selectionSets[1].region=region('sleeve:inner-wall');normalizeThermalLoads(p);assert.equal(p.loads.at(-1).region.surface,'sleeve:inner-wall');
  const sim=new FEMDynamicSimulation(JSON.parse(JSON.stringify(p))),state=sim.states[0],wall=resolveSurfaceSelection(part,state.mesh,p.selectionSets[1]),entries=sim.thermal.loads.items[0].entries;
  assert.deepEqual(entries.map(e=>e.index).sort((a,b)=>a-b),wall.nodes.slice().sort((a,b)=>a-b));close(entries.reduce((s,e)=>s+e.area,0),wall.area);
  const before=sim.thermal.energy();sim.thermal.step(.001);close(sim.thermal.energy()-before,.1,1e-6);close(sim.thermal.externalHeat,.1,1e-7);
  state.thermal.temperature.forEach((T,n)=>wall.nodes.includes(n)?assert.ok(T>20):close(T,20));
  p.loads.at(-1).selection='missing';assert.throws(()=>normalizeThermalLoads(p),/面选择集/);
});
