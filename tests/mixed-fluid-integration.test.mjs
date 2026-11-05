import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {mixedImpactProject} from '../src/mixed/model.js';
import {contactDOFs} from '../src/mixed/contact.js';
import {particleMechanics} from '../src/simulation/mechanical-diagnostics.js';
import {cross} from '../src/fem/mesh.js';
await initialize();
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function slide(friction){
  const p=mixedImpactProject();p.parts[0].geometry.center[1]=.525;
  const b=p.parts[1];b.method='pbf';b.geometry.center=[.7,.7,0];b.initial.velocity=[.3,-.1,0];b.initial.temperature=60;
  p.contactPairs[0].friction=friction;const s=new MixedSimulation(p);
  try{
    const frame=s.step(.003),pair=frame.contactPairs[0];
    assert.equal(frame.results.parts[1].values.liquids,64);
    assert.ok(frame.particles.every(Number.isFinite));assert.ok(pair.samples>0);assert.ok(pair.accumulatedHeat<0);
    near(frame.thermal.residual,0,1e-6);near(frame.thermal.externalHeat,0);
    for(const r of frame.mixed.exchanges.pairs)for(const x of r.impulseResidual)near(x,0);
    return {pair,vx:frame.results.parts[1].values.velocity[0]};
  }finally{s.free();}
}
test('PBF sliding against FEM enables Coulomb friction and conserves exchanged heat',()=>{
  const free=slide(0),rough=slide(.5);
  near(Math.hypot(...free.pair.tangentialForce),0);near(free.pair.frictionLoss,0);
  assert.ok(rough.pair.tangentialForce[0]<-1);assert.ok(rough.pair.frictionLoss>0);
  assert.ok(rough.vx<free.vx-.01);assert.ok(rough.vx>0);
  assert.ok(Math.hypot(...rough.pair.tangentialForce)<=.5*rough.pair.normalForce+1e-7);
});
test('APIC impulse retains angular momentum after a prior contact moved the FEM witness',()=>{
  const sim=new MixedSimulation(mixedImpactProject());try{
    const s=sim.mpm.particles,f=sim.fem.states[0];f.fixed.fill(0);
    const ids=f.mesh.surface[0].nodes,weights=[.2,.3,.5];
    const point=[0,1,2].map(k=>ids.reduce((sum,n,a)=>sum+weights[a]*f.mesh.nodes[n][k],0)),arm=point.map((x,k)=>x-s[['x','y','z'][k]][0]*.025);
    for(let a=0;a<3;a++)for(let k=0;k<3;k++)f.u[3*ids[a]+k]=.001*(a+1)*(k+1);
    const angular=()=>{
      const a=particleMechanics(s,[0,0,0]).angular.slice();
      for(let n=0;n<f.mesh.nodes.length;n++){
        const position=f.mesh.nodes[n].map((x,k)=>x+f.u[3*n+k]),momentum=Array.from(f.v.subarray(3*n,3*n+3),x=>x*f.m[3*n]);
        const l=cross(position,momentum);for(let k=0;k<3;k++)a[k]+=l[k];
      }return a;
    };
    const before=angular(),d=contactDOFs(s,0,f,{ids,weights,point,arm});d.apply([.17,-.2,.31]);
    angular().forEach((x,k)=>near(x,before[k],1e-12));
  }finally{sim.free();}
});
