import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation,MotionHistory} from '../src/multibody/engine.js';
import {preset} from '../src/multibody/presets.js';
import {validateModel,quaternion,rotate,sub,norm,inertia} from '../src/multibody/model.js';
await initialize();
const body=(id,position,type='dynamic')=>({id,name:id,type,shape:'box',position,size:[1,1,1],mass:2});
const model=(bodies,joints=[],gravity=[0,0,0])=>({schema:'summer-mbd/1',dt:1/240,gravity,bodies,joints});
const advance=(s,n)=>{let f=s.snapshot();for(let i=0;i<n;i++)f=s.step();return f;};
test('rigid body motion responds to mass, gravity, torque and initial velocities in SI units',()=>{
  const s=new MultibodySimulation(model([{...body('a',[0,20,0]),force:[4,0,0],torque:[0,0,1],velocity:[0,0,3]}],[],[0,-9.81,0]));
  try{const b=advance(s,240).bodies[0];assert.ok(Math.abs(b.velocity[0]-2)<.001);assert.ok(Math.abs(b.velocity[1]+9.81)<.002);assert.ok(Math.abs(b.position[1]-(20-4.905))<.025);assert.ok(Math.abs(b.position[2]-3)<.001);assert.ok(Math.abs(b.angularVelocity[2]-3)<.003);assert.ok(Math.abs(norm(b.rotation)-1)<1e-5);assert.ok(Math.abs(b.acceleration[1]+9.81)<.005);}finally{s.free();}
});
test('fixed joint preserves relative rotated poses and fixed body remains immobile',()=>{
  const a={...body('base',[0,3,0],'fixed'),rotation:[10,20,30]},b={...body('arm',[1,3,0]),rotation:[-10,0,50]};
  const s=new MultibodySimulation(model([a,b],[{id:'weld',type:'fixed',a:'base',b:'arm',anchor:[.5,3,0]}],[0,-9.81,0]));
  try{const f=advance(s,480);assert.ok(norm(sub(f.bodies[1].position,b.position))<1e-4);assert.ok(f.maxError<1e-4);assert.ok(Math.abs(Math.abs(f.bodies[1].rotation.reduce((sum,x,i)=>sum+x*quaternion(b.rotation)[i],0))-1)<1e-5);assert.deepEqual(f.bodies[0].velocity,[0,0,0]);}finally{s.free();}
});
test('spherical joint constrains its anchor while permitting three-dimensional rotation',()=>{
  const s=new MultibodySimulation(model([body('base',[0,5,0],'fixed'),{...body('arm',[1,4,0]),angularVelocity:[1,.3,2]}],[{id:'ball',type:'spherical',a:'base',b:'arm',anchor:[0,5,0]}],[0,-9.81,0]));
  try{const f=advance(s,480);assert.ok(f.maxError<.005);assert.ok(Math.abs(f.bodies[1].position[2])>.01);}finally{s.free();}
});
test('prismatic guide removes transverse motion and enforces travel limits',()=>{
  const s=new MultibodySimulation(model([body('base',[0,4,0],'fixed'),{...body('slider',[2,4,0]),force:[20,10,6]}],[{id:'guide',type:'prismatic',a:'base',b:'slider',anchor:[2,4,0],axis:[1,0,0],limits:[-.5,.5]}]));
  try{const f=advance(s,480);assert.ok(f.maxError<1e-4);assert.ok(Math.abs(f.bodies[1].position[1]-4)<1e-4);assert.ok(Math.abs(f.joints[0].coordinate-.5)<.005);}finally{s.free();}
});
test('spring damper settles near the mass/gravity/stiffness equilibrium',()=>{
  const d=preset('suspension');d.joints.find(j=>j.type==='spring').damping=40;const s=new MultibodySimulation(d);
  try{const f=advance(s,2400),spring=f.joints.find(j=>j.type==='spring');assert.ok(Math.abs(spring.coordinate-(2.3+5*9.81/150))<.003);assert.ok(Math.abs(spring.springForce-5*9.81)<.4);assert.ok(f.maxError<1e-5);}finally{s.free();}
});
test('position motor reaches a hinge target and respects a tighter angular stop',()=>{
  for(const limits of [null,[-.3,.3]]){
    const s=new MultibodySimulation(model([body('base',[0,3,0],'fixed'),body('arm',[2,3,0])],[{id:'motor',type:'revolute',a:'base',b:'arm',anchor:[0,3,0],axis:[0,0,1],limits,motor:{mode:'position',target:.7,stiffness:80,damping:20}}]));
    try{const f=advance(s,1920);assert.ok(Math.abs(f.joints[0].coordinate-(limits?.[1]??.7))<.002);assert.ok(f.maxError<.001);assert.ok(norm(f.bodies[1].angularVelocity)<.01);}finally{s.free();}
  }
});
test('driven closed-loop crank completes a revolution with small constraint error',()=>{
  const s=new MultibodySimulation(preset('crank'));try{const start=s.snapshot().joints[0].coordinate,f=advance(s,1800);assert.ok(f.joints[0].coordinate-start>6);assert.ok(f.maxError<.002);assert.ok(Math.abs(f.bodies.find(b=>b.id==='slider').position[1]-2.5)<.002);}finally{s.free();}
});
test('frictional contact keeps falling rigid shapes above the floor',()=>{
  const d=preset('empty');d.bodies.push({...body('ball',[0,3,0]),shape:'sphere'});const s=new MultibodySimulation(d);
  try{const b=advance(s,720).bodies.find(b=>b.id==='ball');assert.ok(b.position[1]>.48&&b.position[1]<.52);assert.ok(norm(b.velocity)<.01);}finally{s.free();}
});
test('double pendulum is dynamical and retains energy within a bounded short-run drift',()=>{
  const s=new MultibodySimulation(preset('pendulum'));try{const initial=s.snapshot(),f=advance(s,1200);assert.ok(f.maxError<.003);assert.ok(Math.abs(f.energy-initial.energy)/Math.abs(initial.energy)<.03);assert.ok(norm(sub(initial.bodies[2].position,f.bodies[2].position))>.1);}finally{s.free();}
});
test('malformed topology, dimensions and nonfinite inputs reject atomically',()=>{
  for(const edit of [d=>d.bodies.push(d.bodies[0]),d=>d.bodies[0].mass=-1,d=>d.dt=NaN,d=>d.bodies[0].position=[Infinity,0,0],d=>d.joints[0].b='missing',d=>d.joints[0].axis=[0,0,0],d=>d.joints[0].limits=[1,-1]]){const d=preset();edit(d);assert.throws(()=>validateModel(d));}
  const good=new MultibodySimulation(preset());try{const initial=good.snapshot();const bad=preset();bad.bodies[2].rotation=[NaN,0,0];assert.throws(()=>new MultibodySimulation(bad),/旋转角/);assert.deepEqual(good.snapshot().bodies,initial.bodies);}finally{good.free();}
});
test('history replay is read-only, stores independent frames and exports measured values',()=>{
  const d=model([{...body('a',[0,0,0]),name:'=danger, quoted "name"',velocity:[1,0,0]}]),s=new MultibodySimulation(d),h=new MotionHistory();try{h.record(s.snapshot());for(let i=0;i<240;i++)h.record(s.step());assert.ok(h.frames.length>=60&&h.frames.length<=61);const now=s.time,first=structuredClone(h.at(0));assert.equal(h.at(0).time,0);assert.equal(s.time,now);assert.ok(h.at(100000).time>.99);const csv=h.csv();assert.match(csv,/time_s,body_id/);assert.match(csv,/"'=danger, quoted ""name"""/);assert.deepEqual(h.at(0),first);assert.equal(inertia(d.bodies[0])[0],1/3);}finally{s.free();}
});
