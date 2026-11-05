import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {rigidFEMContacts,rigidCenterInsideFEM} from '../src/mixed/rigid-geometry.js';
import {boxMesh} from '../src/fem/mesh.js';
import {rigidDOFs} from '../src/mixed/rigid-contact.js';
import {arr,cross} from '../src/multibody/contact.js';
import {dot,sub,rotate,quaternion,inverse,inertia} from '../src/multibody/model.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
await initialize();
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const vertices=[[-1,0,-1],[-1,0,1],[1,0,1],[1,0,-1]];
const faces=[[0,1,2],[0,2,3]].map(ids=>({ids,v:ids.map(i=>vertices[i]),normal:[0,1,0],lo:[-1,0,-1],hi:[1,0,1]}));
function rigid(shape,size,position,rotation=[0,0,0]){
  const engine=new MultibodySimulation({schema:'summer-mbd/1',name:'shape test',gravity:[0,0,0],bodies:[{id:'rigid',name:'rigid',shape,size,position,rotation,type:'dynamic',mass:2}],joints:[]});
  const body=engine.bodies.get('rigid');body.rb.recomputeMassPropertiesFromColliders();return {body,free:()=>engine.free()};
}
const withRigid=(shape,size,position,rotation,fn)=>{const r=rigid(shape,size,position,rotation);try{fn(r.body);}finally{r.free();}};
test('thin box uses its actual face rather than a bounding sphere',()=>{
  withRigid('box',[.6,.04,.08],[0,.06,0],[0,0,0],b=>assert.equal(rigidFEMContacts(b,faces).length,0));
  withRigid('box',[.6,.04,.08],[0,.02,0],[0,0,0],b=>{
    const hits=rigidFEMContacts(b,faces);assert.ok(hits.length>=4);
    assert.ok(Math.min(...hits.map(h=>h.point[0]))<-.29);assert.ok(Math.max(...hits.map(h=>h.point[0]))>.29);
    assert.ok(Math.min(...hits.map(h=>h.point[2]))<-.039);assert.ok(Math.max(...hits.map(h=>h.point[2]))>.039);
    for(const h of hits){near(h.point[1],0);near(h.normal[1],1);near(h.weights.reduce((a,x)=>a+x,0),1);assert.ok(h.weights.every(w=>w>=-1e-8));}
  });
});
test('rotated box features contact at the transformed corner and remain separated when lifted',()=>{
  const height=(.6+.04)/(2*Math.sqrt(2));
  withRigid('box',[.6,.04,.08],[0,height,0],[0,0,45],b=>{
    const hits=rigidFEMContacts(b,faces);assert.ok(hits.length>0);
    for(const h of hits){near(h.point[1],0);assert.ok(h.point[0]<-.19);assert.ok(Math.abs(h.depth)<2e-6);}
  });
  withRigid('box',[.6,.04,.08],[0,height+.01,0],[0,0,45],b=>assert.equal(rigidFEMContacts(b,faces).length,0));
});
test('cylinder height and orientation determine its contact instead of its diameter',()=>{
  withRigid('cylinder',[.1,.4,.1],[0,.205,0],[0,0,0],b=>assert.equal(rigidFEMContacts(b,faces).length,0));
  withRigid('cylinder',[.1,.4,.1],[0,.2,0],[0,0,0],b=>assert.ok(rigidFEMContacts(b,faces).length>0));
  withRigid('cylinder',[.1,.4,.1],[0,.05,0],[0,0,90],b=>assert.ok(rigidFEMContacts(b,faces).length>0));
});
test('disc uses authored Z thickness and rotation',()=>{
  withRigid('disc',[.4,.4,.04],[0,.025,0],[90,0,0],b=>assert.equal(rigidFEMContacts(b,faces).length,0));
  withRigid('disc',[.4,.4,.04],[0,.02,0],[90,0,0],b=>assert.ok(rigidFEMContacts(b,faces).length>0));
  withRigid('disc',[.4,.4,.04],[0,.2,0],[0,0,0],b=>assert.ok(rigidFEMContacts(b,faces).length>0));
});
test('rotated nonspherical inertia gives opposite linear and angular momentum with FEM',()=>{
  withRigid('box',[.6,.12,.2],[0,.5,0],[23,37,15],body=>{
    const state={mesh:{nodes:vertices},u:new Float64Array(12),v:new Float64Array(12),m:new Float64Array(12).fill(3),fixed:new Uint8Array(12),contactWork:0};
    state.u.set([.01,.02,0,-.02,.01,.03,.01,0,-.01,0,0,0]);
    const weights=[.3,.2,.5],ids=[0,1,2],point=[0,1,2].map(k=>ids.reduce((sum,n,a)=>sum+weights[a]*vertices[n][k],0)),center=arr(body.rb.translation()),hit={point,weights,ids,arm:sub(point,center)},J=[.03,-.04,.05];
    const q=quaternion([23,37,15]),I=inertia(body.definition),inverseI=v=>rotate(q,rotate(inverse(q),v).map((x,k)=>x/I[k]));
    const currentPoint=point.map((x,k)=>x+ids.reduce((sum,n,a)=>sum+weights[a]*state.u[3*n+k],0));
    const expectedSpin=inverseI(cross(sub(currentPoint,center),J)),receipt=rigidDOFs(body,state,hit).apply(J),omega=arr(body.rb.angvel()),v=arr(body.rb.linvel());
    for(let k=0;k<3;k++){near(v[k]*2,J[k]);near(omega[k],expectedSpin[k],2e-5);near(receipt.impulseResidual[k],0);}
    const linear=[0,0,0],angular=cross(center,J),spin=rotate(q,rotate(inverse(q),omega).map((x,k)=>x*I[k]));
    for(let k=0;k<3;k++)angular[k]+=spin[k];
    for(let a=0;a<3;a++){
      const momentum=Array.from(state.v.subarray(3*ids[a],3*ids[a]+3),x=>x*3),torque=cross(vertices[ids[a]].map((x,k)=>x+state.u[3*ids[a]+k]),momentum);
      for(let k=0;k<3;k++){linear[k]+=momentum[k];angular[k]+=torque[k];}
    }
    for(let k=0;k<3;k++){near(linear[k]+J[k],0);near(angular[k],0,2e-6);}
    assert.ok(Number.isFinite(receipt.workA+receipt.workB));
  });
});
test('a tiny body centered exactly on an interior FEM mesh node is enclosed',()=>{
  const mesh=boxMesh({id:'volume',geometry:{center:[0,0,0],rotation:[0,0,0],size:[2,2,2]},discretization:{divisions:[2,2,2]}});
  const state={mesh,u:new Float64Array(mesh.nodes.length*3)};
  assert.ok(mesh.nodes.some(p=>p.every(x=>x===0)));
  withRigid('box',[.02,.02,.02],[0,0,0],[0,0,0],b=>assert.equal(rigidCenterInsideFEM(b,state),true));
});
test('a rigid center fully inside a FEM tetrahedron is detected without a surface crossing',()=>{
  const state={mesh:{nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],cells:[{ids:[0,1,2,3]}]},u:new Float64Array(12)};
  withRigid('box',[.02,.02,.02],[.2,.2,.2],[0,0,0],b=>assert.equal(rigidCenterInsideFEM(b,state),true));
  withRigid('box',[.02,.02,.02],[2,2,2],[0,0,0],b=>assert.equal(rigidCenterInsideFEM(b,state),false));
});
function impact(shape,size,rotation){
  let p=emptyProject();p.environment.gravity=[0,0,0];
  p=addProjectPart(p,{id:'plate',name:'plate',method:'fem',geometry:{center:[0,.2,0],size:[1.2,.2,.6]},material:{young:1e6,density:1000,conductivity:20},discretization:{divisions:[4,1,2]}});
  const n=rotate(inverse(quaternion(rotation)),[0,1,0]);
  const extent=shape==='box'?size.reduce((sum,x,k)=>sum+.5*x*Math.abs(n[k]),0):shape==='cylinder'?size[1]/2*Math.abs(n[1])+size[0]/2*Math.hypot(n[0],n[2]):size[2]/2*Math.abs(n[2])+size[0]/2*Math.hypot(n[0],n[1]);
  p=addProjectPart(p,{id:'impactor',name:'impactor',method:'rigid',geometry:{shape,size,rotation,center:[.2,.3+extent+.00001,0]},initial:{temperature:100,velocity:[.08,-.1,0]},material:{mass:2,conductivity:50}});
  Object.assign(p.solver,{dt:.0001,duration:.01,thermal:true,damping:0});return p;
}
test('zero-particle rotated box, cylinder and disc exchange impulse and heat with FEM on one clock',()=>{
  for(const [shape,size,rotation] of [['box',[.3,.1,.2],[0,0,20]],['cylinder',[.15,.3,.15],[0,0,30]],['disc',[.3,.3,.04],[30,20,10]]]){
    const p=impact(shape,size,rotation),s=new MixedSimulation(p);
    try{
      assert.equal(s.mpm.particles.count,0);
      const f=s.step(.003),pair=f.contactPairs[0];
      assert.ok(pair.samples>0,shape+' impulse');assert.ok(pair.accumulatedHeat<0,shape+' heat');
      assert.equal(f.mixed.clock.maxDrift,0);assert.equal(f.results.parts.length,2);
      assert.ok(f.fem.parts[0].summary.maxDisplacement>0);assert.ok(Math.abs(f.thermal.residual)<1e-6,shape+' thermal residual');
      assert.ok(f.bodies.flatMap(b=>[...b.position,...b.velocity,...b.angularVelocity]).every(Number.isFinite));
      for(const p of f.mixed.exchanges.pairs)for(const r of p.impulseResidual)near(r,0);
    }finally{s.free();}
  }
});
test('a separated flat rigid body cannot conduct or collide through its unused bounding volume',()=>{
  const p=impact('box',[.6,.04,.08],[0,0,0]),b=p.parts.find(b=>b.id==='impactor');b.geometry.center[1]+=.02;b.initial.velocity=[0,0,0];
  const s=new MixedSimulation(p);try{const f=s.step(.003);near(f.contactPairs[0].heat,0);near(f.contactPairs[0].normalForce,0);near(f.fem.parts[0].summary.maxDisplacement,0);}finally{s.free();}
});
