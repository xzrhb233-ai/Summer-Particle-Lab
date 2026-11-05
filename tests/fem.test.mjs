import test from 'node:test';
import assert from 'node:assert/strict';
import {cantileverProject,validateFEM,setPartLoads} from '../src/fem/model.js';
import {boxMesh,tetraData} from '../src/fem/mesh.js';
import {assemble,multiply,recover,FEMSimulation,boundaryData} from '../src/fem/solver.js';
import {tipDisplacement,runFEMValidation} from '../src/fem/validation.js';
import {normalizeProject,toLegacy,removePart} from '../src/simulation/project.js';
import {femStaticAdapter} from '../src/fem/adapter.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {quaternion,rotate} from '../src/multibody/model.js';
const norm=v=>Math.hypot(...v),close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const small=()=>cantileverProject({divisions:[4,2,2]});

test('Tet4 mesh tiles the box without interior surface seams, with positive volume and outward normals',()=>{
  const p=small().parts[0],mesh=boxMesh(p),[L,h,b]=p.geometry.size;
  close(mesh.quality.volume,L*h*b);assert.equal(mesh.cells.length,96);assert.equal(mesh.surface.length,2*(4*2+2*2+4*2)*2);
  for(const face of mesh.surface){
    const axis='xyz'.indexOf(face.face[0]),sign=face.face[1]==='+'?1:-1;
    close(face.normal[axis],sign);
  }
  assert.ok(mesh.quality.minQuality>0&&mesh.quality.minQuality<=1);
  const c=mesh.cells[0].ids;assert.throws(()=>tetraData(mesh.nodes,[c[1],c[0],c[2],c[3]]),/翻转/);
});
test('linear tetra stiffness preserves rigid translations and infinitesimal rotations and is symmetric',()=>{
  const p=small().parts[0],mesh=boxMesh(p),A=assemble(mesh,p.material);
  for(const displacement of [
    ()=>[.3,-.1,.4],([x,y,z])=>[-.01*y,.01*x,0]]){
    const u=Float64Array.from(mesh.nodes.flatMap(displacement));assert.ok(norm(multiply(A,u))<1e-7);
  }
  const x=Float64Array.from({length:mesh.nodes.length*3},(_,i)=>Math.sin(i)),y=Float64Array.from(x,(_,i)=>Math.cos(i));
  const ax=multiply(A,x),ay=multiply(A,y);
  close(x.reduce((s,v,i)=>s+v*ay[i],0),y.reduce((s,v,i)=>s+v*ax[i],0),1e-6);
});
test('affine strain patch recovers constant analytical stress on every tetrahedron',()=>{
  const p=small().parts[0],mesh=boxMesh(p),A=assemble(mesh,p.material),a=.001,b=-.0002,c=.0003,gamma=.0008;
  const u=Float64Array.from(mesh.nodes.flatMap(([x,y,z])=>[a*x+gamma*y,b*y,c*z]));
  const r=recover(mesh,A,u),expected=[A.lambda*(a+b+c)+2*A.mu*a,A.lambda*(a+b+c)+2*A.mu*b,A.lambda*(a+b+c)+2*A.mu*c,A.mu*gamma,0,0];
  for(const stress of r.stress)stress.forEach((x,k)=>close(x,expected[k],1e-8));
});
test('uniaxial tension matches FL/EA, reactions and the elastic work identity',()=>{
  const p=cantileverProject({divisions:[8,2,2],poisson:0,force:[100,0,0]});
  const part=p.parts[0],result=new FEMSimulation(p).step().fem.parts[0],expected=100*2/(.3*.3*2e7);
  close(tipDisplacement(result)[0],expected,1e-10);
  close(result.summary.reaction[0],-100,1e-5);
  close(result.summary.energy*2,result.summary.externalWork,1e-9);
  assert.ok(norm(result.summary.forceBalance)<1e-5);
});
test('pressure is inward, area-consistent and rotates with the geometry while force remains world-referenced',()=>{
  const p=small(),part=p.parts[0];part.geometry.rotation=[0,0,90];
  setPartLoads(p,part,{type:'fem-pressure',pressure:2000});
  const mesh=boxMesh(part),bc=boundaryData(p,part,mesh),F=[0,0,0];
  bc.f.forEach((v,i)=>F[i%3]+=v);
  close(F[0],0);close(F[1],-2000*.3*.3);close(F[2],0);
  const r=new FEMSimulation(p).step().fem.parts[0];assert.ok(norm(r.summary.forceBalance)<1e-5);
});
test('rotated and translated meshes produce equivalent elastic solutions',()=>{
  const p=small(),base=new FEMSimulation(p).step().fem.parts[0],q=quaternion([30,20,40]);
  p.parts[0].geometry.rotation=[30,20,40];p.parts[0].geometry.center=[-3,4,2];p.loads.find(l=>l.type==='fem-force').force=rotate(q,[0,-100,0]);
  const r=new FEMSimulation(p).step().fem.parts[0];
  for(let i=0;i<r.nodes.length;i++)rotate(q,Array.from(base.displacement.subarray(3*i,3*i+3))).forEach((x,k)=>close(x,r.displacement[3*i+k],1e-8));
});
test('gravity integrates density and element volume, and the zero-load state is exact',()=>{
  const p=small();p.loads.find(l=>l.type==='fem-force').force=[0,0,0];
  let r=new FEMSimulation(p).step().fem.parts[0];assert.equal(r.iterations,0);assert.equal(r.summary.maxDisplacement,0);
  p.environment.gravity=[0,-9.81,0];r=new FEMSimulation(p).step().fem.parts[0];
  close(r.summary.force[1],-1000*2*.3*.3*9.81,1e-8);assert.ok(norm(r.summary.forceBalance)<1e-4);
});
test('three-mesh cantilever validation improves displacement and checks actual force/moment residuals',()=>{
  const report=runFEMValidation();for(const [key,value] of Object.entries(report.checks))assert.ok(value,key);
});
test('FEM rejects unsupported coupling, unstable materials, missing supports and oversized meshes before solving',()=>{
  for(const edit of [
    p=>p.parts[0].material.poisson=.5,p=>p.parts[0].material.young=-1,
    p=>p.parts[0].discretization.divisions=[100,100,100],p=>p.parts[0].geometry.size[0]=0,
    p=>p.loads=p.loads.filter(l=>l.type!=='fem-fixed'),p=>p.parts[0].method='mpm',
    p=>p.couplings=[{type:'contact'}],p=>p.loadBindings=[{}],
    p=>p.parts[0].initial.velocity=[1,0,0],p=>p.loads.find(l=>l.type==='fem-force').force=[NaN,0,0],
    p=>p.solver.analysis='dynamic'
  ]){const p=small();edit(p);assert.throws(()=>validateFEM(p));}
});
test('nonconvergence is explicit and never replaces the last successful solution',()=>{
  const sim=new FEMSimulation(small()),good=sim.step();sim.project.solver.maxIterations=1;
  assert.throws(()=>sim.step(),/未收敛/);assert.deepEqual(sim.snapshot(),good);
});
test('FEM round-trips through the common project session, preserves IDs and rejects incompatible edits transactionally',async()=>{
  const s=new ProjectSession(new SolverRegistry().register(femStaticAdapter));
  const p=normalizeProject(JSON.parse(JSON.stringify(small())));await s.replaceAsync(p);await s.step();
  const before=s.snapshot(),doc=s.project;assert.equal(s.time,0);assert.equal(before.fem.solved,true);assert.throws(()=>toLegacy(doc),/FEM/);
  const invalid=s.project;invalid.parts[0].material.young=-1;await assert.rejects(s.replaceAsync(invalid));assert.deepEqual(s.project,doc);assert.deepEqual(s.snapshot(),before);
  const removed=removePart(doc,'beam');assert.equal(removed.parts.length,0);assert.equal(removed.loads.length,0);assert.equal(removed.selectionSets.length,0);
  await s.replaceAsync(removed);assert.equal(s.snapshot().fem.parts.length,0);s.free();
});
