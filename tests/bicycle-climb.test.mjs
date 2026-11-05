import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {bicycleWall} from '../src/multibody/bicycle.js';
import {validateModel,inertia} from '../src/multibody/model.js';
import {fromLegacy,toLegacy,removePart} from '../src/simulation/project.js';
import {contactImpulse} from '../src/multibody/contact.js';
await initialize();
const advance=(s,n)=>{let f;for(let i=0;i<n;i++)f=s.step();return f;};

test('planar constraint permits rise and pitch while preventing sideways drift and tipping',()=>{
  const s=new MultibodySimulation({schema:'summer-mbd/1',dt:1/480,gravity:[0,0,0],bodies:[
    {id:'base',type:'fixed',shape:'box',position:[0,-5,0],size:[1,1,1]},
    {id:'body',type:'dynamic',shape:'box',position:[0,1,0],size:[1,1,1],velocity:[.5,.3,2],angularVelocity:[.4,.2,.6]},
  ],joints:[{id:'plane',type:'planar',a:'base',b:'body',anchor:[0,1,0],axis:[0,0,1]}]});
  try{const f=advance(s,960),b=f.bodies[1];assert.ok(b.displacement[0]>.9);assert.ok(b.displacement[1]>.5);assert.ok(Math.abs(b.position[2])<1e-5);assert.ok(Math.abs(b.rotation[0])+Math.abs(b.rotation[1])<1e-5);assert.ok(Math.abs(b.rotation[2])>.4);assert.ok(f.maxError<1e-5);}finally{s.free();}
});

function gear(omega){return {schema:'summer-mbd/1',dt:1/480,gravity:[0,0,0],bodies:['a','b','frame'].map((id,i)=>({id,type:'dynamic',shape:'disc',position:[3*i,0,0],size:[1,1,.1],mass:2,rotation:[0,0,25],angularVelocity:[0,0,omega[i]]})),joints:[{id:'gear',type:'gear',a:'a',b:'b',carrier:'frame',anchor:[0,0,0],axis:[0,0,1],ratio:1.6,maxTorque:40,stiffness:800,damping:8}]};}
test('pitching transmission measures shaft rotation relative to its carrier',()=>{
  const s=new MultibodySimulation(gear([.6,.6,.6]));try{const f=advance(s,960);assert.ok(Math.abs(f.joints[0].phaseError)<1e-5);assert.ok(Math.abs(f.joints[0].speedError)<1e-5);for(const b of f.bodies)assert.ok(Math.abs(b.angularVelocity[2]-.6)<1e-5);}finally{s.free();}
});
test('three-body transmission returns carrier torque, conserves angular momentum and dissipates energy',()=>{
  const s=new MultibodySimulation(gear([-1,0,.2]));try{const a=s.snapshot(),f=advance(s,960),I=inertia(s.model.bodies[0])[2],momentum=g=>g.bodies.reduce((sum,b)=>sum+I*b.angularVelocity[2],0);assert.ok(Math.abs(momentum(f)-momentum(a))<2e-5);assert.ok(f.kinetic<=a.kinetic+1e-5);assert.ok(Math.abs(f.joints[0].speedError)<.001);assert.ok(Math.abs(f.bodies[2].angularVelocity[2]-.2)>.01);}finally{s.free();}
});
test('climbing uses native editable joints and optional front drive with bounded torque',()=>{
  const m=bicycleWall({climb:true}),p=fromLegacy(m);assert.deepEqual(toLegacy(JSON.parse(JSON.stringify(p))),m);
  assert.equal(m.joints.find(j=>j.id==='plane-guide').type,'planar');assert.ok(!m.joints.some(j=>j.id==='straight-guide'));
  assert.equal(m.joints.find(j=>j.id==='front-drive').carrier,'bike-frame');assert.equal(m.joints.find(j=>j.id==='front-drive').maxTorque,40);
  assert.equal(m.coupling.friction,1.2);assert.equal(m.coupling.parts[0].fixedFace,'minY');
  assert.ok(!bicycleWall({climb:true,frontDrive:false}).joints.some(j=>j.id==='front-drive'));
  assert.ok(!removePart(p,'bike-frame').connections.some(j=>j.carrier==='bike-frame'));
  for(const args of [{climb:'yes'},{climb:true,frontTorque:0},{climb:true,traction:3}])assert.throws(()=>bicycleWall(args));
  m.joints.find(j=>j.id==='front-drive').carrier='missing';assert.throws(()=>validateModel(m));
});

test('a driven front tire gets upward traction from wall friction, with no such lift at zero friction',()=>{
  for(const friction of [0,1.2]){
    const s=new MultibodySimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[{id:'wheel',type:'dynamic',shape:'disc',position:[0,0,0],size:[1.24,1.24,.12],mass:2,angularVelocity:[0,0,-3]}],joints:[]});
    try{const b=s.bodies.get('wheel');b.rb.recomputeMassPropertiesFromColliders();const result=contactImpulse(b,[.62,0,0],[-.5,0,0],2,[1,0,0],friction);
      assert.ok(Math.abs(result.impulse[1])<=friction*result.impulse[0]+1e-9);
      assert.ok(Math.abs(2*b.rb.linvel().y+2*result.velocity[1])<1e-7);
      if(friction){assert.ok(b.rb.linvel().y>.05);assert.ok(result.velocity[1]<-.05);}else assert.equal(b.rb.linvel().y,0);
    }finally{s.free();}
  }
});
