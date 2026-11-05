import test from 'node:test';
import assert from 'node:assert/strict';
import {cantileverProject,dynamicCantileverProject,setPartLoads,validateFEM} from '../src/fem/model.js';
import {boxMesh} from '../src/fem/mesh.js';
import {validateExplicitMesh} from '../src/fem/explicit-mesh.js';
import {FEMSimulation,assemble,recover,boundaryData} from '../src/fem/solver.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {emptyProject,addProjectPart,updateProjectPart} from '../src/simulation/part-builder.js';
import {normalizeProject} from '../src/simulation/project.js';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCAD} from '../cad-server.mjs';
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

// Exact structured fixture (not a kernel integration fixture): remove whole
// cells to make a square through-hole, retaining a conforming positive mesh.
function explicitPart(part,{hole=false,skew=false}={}){
  const source=structuredClone(part),g=source.geometry;g.rotation=[0,0,0];
  const mesh=boxMesh(source),lower=g.center.map((v,k)=>v-g.size[k]/2),upper=g.center.map((v,k)=>v+g.size[k]/2);
  let elements=mesh.cells.map(c=>c.ids);
  if(hole)elements=elements.filter(ids=>{
    const p=[0,1,2].map(k=>ids.reduce((s,i)=>s+mesh.nodes[i][k],0)/4);
    return Math.abs(p[0]-g.center[0])>=g.size[0]/4||Math.abs(p[2]-g.center[2])>=g.size[2]/4;
  });
  const ids=[...new Set(elements.flat())].sort((a,b)=>a-b),mapping=new Map(ids.map((n,i)=>[n,i])),nodes=ids.map(i=>mesh.nodes[i].slice());
  elements=elements.map(t=>t.map(i=>mapping.get(i)));
  if(skew){const i=nodes.findIndex(p=>p.every((v,k)=>Math.abs(v-g.center[k])<1e-10));nodes[i][0]+=.12*g.size[0];nodes[i][1]+=.08*g.size[1];}
  const recipe=[{shape:'box',operation:'base',center:g.center.slice(),size:g.size.slice(),rotation:[0,0,0]}];
  if(hole)recipe.push({shape:'box',operation:'difference',center:g.center.slice(),size:[g.size[0]/2,g.size[1]*2,g.size[2]/2],rotation:[0,0,0]});
  const cad={schema:'summer-cad/1',kernel:'SMLib',version:'fixture',recipe,lower,upper,closed:true,volume:g.size.reduce((v,x)=>v*x,1)*(hole?.75:1),vertices:mesh.nodes,indices:mesh.surface.flatMap(t=>t.nodes)};
  part.geometry={...part.geometry,shape:'cad',cad};
  part.discretization={element:'tet4',mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes,elements,source:{recipe:structuredClone(recipe),lower:lower.slice(),upper:upper.slice()}}};
  return part;
}
function holeProject(){
  const p=cantileverProject({size:[.8,.4,.8],center:[0,.6,0],divisions:[4,2,4],force:[0,-10,0]});
  explicitPart(p.parts[0],{hole:true});return p;
}

test('explicit Tet4 preserves holes, outward interior-wall surfaces and reference transforms',()=>{
  const p=holeProject(),part=p.parts[0],mesh=boxMesh(part);
  close(mesh.quality.volume,.8*.4*.8*.75);assert.ok(mesh.surface.some(t=>t.face==='surface'));
  assert.equal(mesh.quality.components,1);
  for(const cell of mesh.cells){
    const center=[0,1,2].map(k=>cell.ids.reduce((s,i)=>s+mesh.nodes[i][k],0)/4);
    assert.ok(Math.abs(center[0])>=.2-1e-10||Math.abs(center[2])>=.2-1e-10);
  }
  const before=mesh.nodes;part.geometry.center=[2,3,4];part.geometry.size=part.geometry.size.map(v=>v*2);part.geometry.rotation=[0,0,90];
  const moved=boxMesh(part);close(moved.quality.volume,mesh.quality.volume*8);
  moved.nodes.forEach((v,i)=>{close(v[0],2-2*(before[i][1]-.6));close(v[1],3+2*before[i][0]);close(v[2],4+2*before[i][2]);});
});

test('explicit Tet4 matches structured FEM static solve and passes affine stress patch',()=>{
  const p=cantileverProject({divisions:[4,2,2],poisson:0,force:[100,0,0]}),base=new FEMSimulation(p).step().fem.parts[0];
  explicitPart(p.parts[0]);const actual=new FEMSimulation(p).step().fem.parts[0];
  actual.displacement.forEach((v,i)=>close(v,base.displacement[i],1e-11));close(actual.summary.reaction[0],-100,1e-6);
  const mesh=boxMesh(p.parts[0]),A=assemble(mesh,p.parts[0].material),u=Float64Array.from(mesh.nodes.flatMap(([x,y,z])=>[.001*x,-.0002*y,.0003*z]));
  const r=recover(mesh,A,u),tr=.001-.0002+.0003;
  r.stress.forEach(s=>{close(s[0],A.lambda*tr+2*A.mu*.001,1e-7);close(s[1],A.lambda*tr-2*A.mu*.0002,1e-7);});
});

test('CAD hole CPU solve has balanced loads and supports survive project JSON and authoring edits',()=>{
  const p=holeProject(),result=new FEMSimulation(p).step().fem.parts[0];
  assert.ok(result.summary.maxDisplacement>0);assert.ok(Math.hypot(...result.summary.forceBalance)<1e-6);
  const part=structuredClone(p.parts[0]);part.boundary.fixedFace='y-';
  let project=addProjectPart(emptyProject(),part);project=normalizeProject(JSON.parse(JSON.stringify(project)));
  const before=structuredClone(project.parts[0].discretization.mesh);
  project=updateProjectPart(project,part.id,{geometry:{center:[1,2,3],size:[1.6,.8,1.6]},material:{young:3e5}});
  assert.deepEqual(project.parts[0].discretization.mesh,before);
  const sim=new FEMDynamicSimulation(project);sim.step(.00001);assert.equal(sim.time,.00001);
});

test('CAD Tet4 validation rejects flipped cells, stale CAD, orphan nodes, boundary mismatch and unsupported GPU',()=>{
  const original=holeProject();
  for(const mutate of [
    p=>{const t=p.parts[0].discretization.mesh.elements[0];[t[0],t[1]]=[t[1],t[0]];},
    p=>p.parts[0].discretization.mesh.nodes.push([0,.6,0]),
    p=>p.parts[0].geometry.cad.recipe[0].size[0]=.9,
    p=>p.parts[0].discretization.mesh.surface=[],
    p=>p.solver.computeBackend='gpu'
  ]){
    const p=structuredClone(original);mutate(p);
    assert.throws(()=>validateFEM(p));
  }
  const missing=structuredClone(original);missing.parts[0].geometry.rotation=[0,0,0];
  const mesh=boxMesh(missing.parts[0]);mesh.surface=mesh.surface.filter(t=>t.face!=='x-');
  assert.throws(()=>boundaryData(missing,missing.parts[0],mesh),/没有平面/);
});

test('every disconnected CAD component needs an independent non-collinear support',()=>{
  const p=cantileverProject({size:[.4,.4,.4],center:[-.4,.2,0],divisions:[2,2,2],force:[0,0,0]}),part=explicitPart(p.parts[0]);
  const right=structuredClone(part);right.geometry.center[0]=.4;
  // Build another exact cube mesh directly from the structured generator.
  right.geometry.shape='box';right.discretization={element:'tet4',divisions:[2,2,2]};explicitPart(right);
  const mesh=part.discretization.mesh,offset=mesh.nodes.length;
  mesh.nodes.push(...right.discretization.mesh.nodes);mesh.elements.push(...right.discretization.mesh.elements.map(t=>t.map(i=>i+offset)));
  const c=part.geometry.cad;c.recipe.push({...right.geometry.cad.recipe[0],operation:'union'});c.upper[0]=.6;c.volume*=2;
  part.geometry.size[0]=1.2;part.geometry.center[0]=0;
  mesh.source={recipe:structuredClone(c.recipe),lower:c.lower.slice(),upper:c.upper.slice()};
  assert.throws(()=>new FEMSimulation(p).step(),/独立网格区域/);
  setPartLoads(p,part,{fixed:'y-',loaded:'y+',force:[0,0,0]});
  const result=new FEMSimulation(p).step();assert.equal(result.fem.parts[0].summary.maxDisplacement,0);
});

test('non-acute explicit Tet4 keeps signed FE thermal fluxes and conserves heat',()=>{
  const p=dynamicCantileverProject({size:[1,1,1],center:[0,.5,0],divisions:[2,2,2],force:[0,0,0],young:1e4,conductivity:50});
  p.curves=[];p.loadBindings=[];p.solver.initialState='rest';p.solver.thermal=true;
  explicitPart(p.parts[0],{skew:true});const sim=new FEMDynamicSimulation(p),s=sim.states[0];
  assert.ok(s.thermal.edges.some(e=>e.g<0));s.thermal.temperature[13]=100;
  const before=sim.thermal.energy();sim.thermal.step(.01);close(sim.thermal.energy(),before,1e-6);
  assert.ok(s.thermal.temperature.every(Number.isFinite));
  const maxRow=new Float64Array(s.mesh.nodes.length);for(const e of s.thermal.edges){maxRow[e.i]+=Math.abs(e.g);maxRow[e.j]+=Math.abs(e.g);}
  for(let i=0;i<maxRow.length;i++)if(maxRow[i]>0)assert.ok(s.thermal.criticalDt<=.45*s.thermal.capacity[i]/maxRow[i]+1e-10);
});

const cadPython=fileURLToPath(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const kernelAvailable=existsSync(cadPython)&&spawnSync(cadPython,['-c','import usd_brep, meshpy.tet'],{windowsHide:true}).status===0;
test('real SMLib + TetGen through-hole runs CPU FEM mechanics and face heat without filling its bore',{skip:!kernelAvailable},async()=>{
  const recipe=[{shape:'box',operation:'base',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0]},
    {shape:'cylinder',operation:'difference',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0]}];
  const generated=await runCAD({action:'mesh',recipe,options:{kind:'volume',targetSize:.2}}),cad=generated.cad;
  const p=dynamicCantileverProject({size:cad.upper.map((v,k)=>v-cad.lower[k]),center:cad.upper.map((v,k)=>(v+cad.lower[k])/2),young:1e5,force:[0,0,0]});
  p.curves=[];p.loadBindings=[];p.solver.initialState='rest';p.solver.thermal=true;p.environment.gravity=[0,0,0];
  p.parts[0].geometry.shape='cad';p.parts[0].geometry.cad=cad;
  p.parts[0].discretization={element:'tet4',mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes:generated.nodes,elements:generated.elements,surface:generated.surface,source:generated.source}};
  setPartLoads(p,p.parts[0],{fixed:'y-',loaded:'y+',force:[1,0,0]});
  p.loads.push({id:'cad-face-heat',type:'thermal-power',target:p.parts[0].id,power:100,region:{type:'face',face:'y+'},enabled:true});
  const sim=new FEMDynamicSimulation(p),before=sim.thermal.energy();sim.step(.0001);
  assert.ok(sim.states[0].u.some(v=>v!==0));assert.ok(sim.states[0].u.every(Number.isFinite));
  close(sim.thermal.energy()-before,.01,1e-5);close(sim.thermal.externalHeat,.01,1e-10);
  assert.equal(sim.states[0].mesh.cells.length,generated.elements.length);assert.ok(sim.states[0].mesh.quality.volume<.8*.5*.6);
  assert.ok(sim.states[0].mesh.surface.some(t=>t.face==='surface'));
});
