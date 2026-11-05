import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {MechanicalDiagnostics,elasticDensity,particleMechanics,diagnosticsCSV} from '../src/simulation/mechanical-diagnostics.js';
import {validationProject,runValidationRow,summarizeRefinement,validationPlan} from '../src/simulation/validation.js';
import {toLegacy,normalizeSolverProject,editLegacyProject,fromLegacy} from '../src/simulation/project.js';
import {cpuCoupledAdapter} from '../src/simulation/cpu-adapter.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {constitutiveStress} from '../src/three/constitutive.js';
import {LENGTH as L} from '../src/multibody/coupling-model.js';
import {contactImpulse,arr,cross} from '../src/multibody/contact.js';
import {add,mul,dot,norm,sub} from '../src/multibody/model.js';
await initialize();
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} (${t})`);

for(const model of [0,1])test(`model ${model} stored energy gradient matches the implemented Kirchhoff stress`,()=>{
  const F=[1.07,.04,-.02,.01,.96,.03,0,.01,1.02],P=[],epsilon=1e-6;
  for(let k=0;k<9;k++){const a=F.slice(),b=F.slice();a[k]+=epsilon;b[k]-=epsilon;P[k]=(elasticDensity(a,model)-elasticDensity(b,model))/(2*epsilon);}
  const tau=constitutiveStress(F,model,1,1);
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)near([0,1,2].reduce((s,k)=>s+P[a*3+k]*F[b*3+k],0),tau[a*3+b],2e-8);
  const c=Math.cos(.8),s=Math.sin(.8);near(elasticDensity([c,-s,0,s,c,0,0,0,1],model),0,1e-12);
  assert.equal(elasticDensity([-1,0,0,0,1,0,0,0,1],model),null);
});
test('unsupported plastic energy is unavailable, not zero; diagnostic options survive serialization',()=>{
  const p=validationProject('stretch');p.connections=p.connections.filter(c=>c.type!=='region');p.parts.find(b=>b.method==='mpm').material.model=4;
  // Move the sample outside the clamps now that attachments are removed.
  p.parts.find(b=>b.method==='mpm').geometry.center=[0,1.6,0];
  const a=cpuCoupledAdapter.create(normalizeSolverProject(p));
  try{
    const f=a.snapshot();assert.equal(f.diagnostics.mechanicalEnergy,null);assert.equal(f.diagnostics.materialElastic,null);assert.equal(f.diagnostics.residual,null);
    assert.ok(f.diagnostics.unsupportedParticles>0);assert.equal(JSON.parse(JSON.stringify(a.project)).solver.diagnostics,true);
    assert.equal(editLegacyProject(a.project,m=>{m.dt=1/1920;}).solver.diagnostics,true);
    assert.throws(()=>validateGpuProject(a.project),/诊断/);
    assert.ok(diagnosticsCSV([f]).includes('materialElastic'));
  }finally{a.free();}
});
function freeBlock(){
  return new CoupledSimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[],joints:[],coupling:{enabled:true,thermal:false,mechanical:false,stiffness:1,
    domain:{lower:[-1,0,-1],upper:[1,2,1],cellSize:.2,particlesPerAxis:2},
    parts:[{id:'block',model:0,center:[0,1,0],size:[.4,.4,.4],velocity:[.2,0,0],sampling:{enabled:false}}]}});
}
test('APIC particle kinetic energy and angular momentum match an affine grid field in SI units',()=>{
  const e=freeBlock(),s=e.particles,g=s.mpm,D=(g.H*L)**2/4;
  try{
    for(let i=0;i<s.count;i++){s.vx[i]=(.2-.3*s.z[i]*L)/L;s.vy[i]=0;s.vz[i]=.3*s.x[i];g.C.set([0,0,-.3,0,0,0,.3,0,0],i*9);}
    const before=particleMechanics(s,[0,0,0]);near(before.affine,.5*s.count*s.mass[0]*D*.18,1e-12);assert.ok(before.affine>0);
    let checked=false;
    s.externalGridContact=grid=>{
      let P=[0,0,0],H=[0,0,0],K=0;
      for(let n=0;n<grid.mass.length;n++)if(grid.mass[n]){
        const v=Array.from(grid.v.subarray(n*3,n*3+3),x=>x*L),p=[grid.O[0]+n%grid.N*grid.H,grid.O[1]+Math.floor(n/grid.N)%grid.N*grid.H,grid.O[2]+Math.floor(n/grid.N**2)*grid.H].map(x=>x*L),m=grid.mass[n];
        P=add(P,mul(v,m));H=add(H,cross(p,mul(v,m)));K+=.5*m*dot(v,v);
      }
      near(norm(sub(P,before.momentum)),0,1e-8);near(norm(sub(H,before.angular)),0,1e-8);near(K,before.kinetic+before.affine,1e-8);checked=true;
    };
    g.step(s,1e-4);assert.ok(checked);
  }finally{e.free();}
});
test('free elastic translation preserves total momentum, energy, and total mechanical energy includes MPM',()=>{
  const e=freeBlock(),d=new MechanicalDiagnostics(e),initial=e.snapshot();d.sample(initial);
  try{
    for(let n=0;n<20;n++){const f=e.step(1/960);d.sample(f);}
    const f=e.snapshot(),a=d.sample(f);assert.equal(f.energy,0);assert.ok(a.mechanicalEnergy>0);near(a.energyChange,0,1e-8);near(a.momentumChange,0,1e-8);near(a.angularMomentumChange,0,1e-8);
  }finally{e.free();}
});
test('reported normal/friction work equals measured kinetic energy change for dynamic and fixed contact',()=>{
  for(const type of ['fixed','dynamic']){
    const e=new MultibodySimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[{id:'b',type,shape:'sphere',size:[.4,.4,.4],position:[0,0,0],mass:2}],joints:[]});
    try{
      e.bodies.get('b').rb.recomputeMassPropertiesFromColliders();
      const v=[-1,.4,0],m=.3,K0=e.snapshot().kinetic+.5*m*dot(v,v),r=contactImpulse(e.bodies.get('b'),[.2,0,0],v,m,[1,0,0],.4,.5),K1=e.snapshot().kinetic+.5*m*dot(r.velocity,r.velocity);
      assert.ok(r.normalWork<0&&r.frictionWork<0);near(K1-K0,r.normalWork+r.frictionWork,2e-8);
    }finally{e.free();}
  }
});
test('diagnostics observe without changing the coupled simulation',()=>{
  const p=validationProject('stretch',{cellSize:.2}),a=new CoupledSimulation(toLegacy(p)),b=new CoupledSimulation(toLegacy(p)),d=new MechanicalDiagnostics(b);d.sample(b.snapshot());
  try{
    for(let n=0;n<12;n++){const fa=a.step(1/960),fb=b.step(1/960);d.sample(fb);assert.deepEqual(fa.particles,fb.particles);assert.deepEqual(fa.bodies,fb.bodies);}
    const f=b.snapshot(),r=d.sample(f);assert.ok(r.reasons.includes('motor-work-estimated'));assert.equal(r.physicalSubsteps,12);near(r.minSubstep,1/960,1e-12);assert.ok(Number.isFinite(r.residual));
    const count=d.steps;d.sample(f);assert.equal(d.steps,count);
  }finally{a.free();b.free();}
});
test('constant external force work balances free-body energy and diagnostic baseline resets with replacement',()=>{
  const p=fromLegacy({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[{id:'b',type:'dynamic',shape:'sphere',size:[.2,.2,.2],position:[0,1,0],mass:2,force:[1,0,0]}],joints:[]});p.solver.diagnostics=true;
  const a=cpuCoupledAdapter.create(p);
  try{const first=a.snapshot();assert.equal(first.diagnostics.energyChange,0);let f;for(let i=0;i<120;i++)f=a.step(1/480);near(f.diagnostics.externalWork,.5*2*f.bodies[0].velocity[0]**2,1e-4);assert.ok(f.diagnostics.externalWork>0);assert.ok(Math.abs(f.diagnostics.residual)<1e-4);}
  finally{a.free();}
});
test('grid refinement keeps reference mass, geometry and point density per cell consistent',()=>{
  const masses=[],counts=[];
  for(const cellSize of [.2,.4/3,.1]){const e=new CoupledSimulation(toLegacy(validationProject('stretch',{cellSize})));try{masses.push(e.snapshot().coupling.mass);counts.push(e.particles.count);}finally{e.free();}}
  assert.deepEqual(counts,[192,648,1536]);for(const mass of masses)near(mass,1100*1.2*.4*.4,1e-8);
  assert.equal(validationPlan().length,18);
});
test('analytic oscillator and impact validation use independent reference values',async()=>{
  const coarse=await runValidationRow({case:'oscillator',dt:1/120,cellSize:.1,duration:1}),fine=await runValidationRow({case:'oscillator',dt:1/480,cellSize:.1,duration:1});
  assert.equal(coarse.status,'pass');assert.equal(fine.status,'pass');assert.ok(fine.value<coarse.value*.3);assert.equal(fine.mass,1);
  const impact=await runValidationRow({case:'impact',dt:1/240,cellSize:.1,duration:.5});assert.equal(impact.status,'pass');assert.ok(impact.value<1e-5);assert.ok(impact.maxMomentumChange<1e-6);
  // e=.5, reduced mass=2/3, relative speed=1.5: loss = 0.5625 J.
  near(impact.diagnostics.energyChange,-.5625,1e-6);
});
test('refinement checker keeps unresolved sensitivity visible',()=>{
  const rows=[.1,.08,.06].map(value=>({case:'twist',sweep:'grid',value,status:'stable'}));
  assert.equal(summarizeRefinement(rows)[0].status,'check');
  const converged=[.1,.11,.112].map(value=>({case:'twist',sweep:'grid',value,status:'stable'}));
  assert.equal(summarizeRefinement(converged)[0].status,'consistent');
});
