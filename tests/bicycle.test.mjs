import test from 'node:test';
import assert from 'node:assert/strict';
import {bicycle} from '../src/multibody/bicycle.js';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {surface} from '../src/multibody/contact.js';
import {validateModel,inertia} from '../src/multibody/model.js';
await initialize();
const advance=(s,n)=>{let f;for(let i=0;i<n;i++)f=s.step();return f;};

test('native assembly round-trips editable display geometry, collision families and transmission through project JSON',()=>{
  const m=bicycle({radius:.7,wheelbase:2.4,rpm:35,ratio:2,origin:[1,2,3]});
  assert.equal(m.bodies.length,14);assert.equal(m.joints.length,14);
  assert.deepEqual(toLegacy(JSON.parse(JSON.stringify(fromLegacy(m)))),m);
  assert.equal(m.bodies.find(b=>b.id==='rear-wheel').size[0],1.4);
  assert.equal(m.joints.find(j=>j.id==='chain').ratio,2);
  assert.ok(m.bodies.find(b=>b.id==='pelican').appearance.length>10);
});
test('12 seconds of pedaling retains closed-loop feet, rolls both wheels and transmits crank motion with reaction',()=>{
  const s=new MultibodySimulation(bicycle());let maxError=0,maxPhase=0,f;
  try{
    for(let i=0;i<5760;i++){f=s.step();maxError=Math.max(maxError,f.maxError);maxPhase=Math.max(maxPhase,Math.abs(f.joints.find(j=>j.id==='chain').phaseError));}
    const b=id=>f.bodies.find(b=>b.id===id),gear=f.joints.find(j=>j.id==='chain');
    assert.ok(maxError<.001,`anchor error ${maxError}`);assert.ok(maxPhase<.1,`phase ${maxPhase}`);
    assert.ok(b('bike-frame').displacement[0]>15);assert.ok(Math.abs(b('bike-frame').displacement[2])<.001);
    assert.ok(b('crank').angularVelocity[2]<-2);assert.ok(b('rear-wheel').angularVelocity[2]<-3);
    assert.ok(Math.abs(b('front-wheel').velocity[0]+.62*b('front-wheel').angularVelocity[2])<.05);
    assert.ok(Math.abs(gear.phaseError)<.02);assert.ok(Math.abs(gear.speedError)<.15);
    assert.ok(Math.abs(f.joints.find(j=>j.id==='cadence').coordinate)>20);
    assert.ok(f.joints.filter(j=>j.id.endsWith('pedal-pin')||j.id.endsWith('ankle')).every(j=>j.error<.001));
  }finally{s.free();}
});
test('without actuation or gravity the bicycle does not animate itself',()=>{
  const m=bicycle();m.gravity=[0,0,0];m.joints.find(j=>j.id==='cadence').motor=null;const s=new MultibodySimulation(m);
  try{const f=advance(s,960);assert.ok(f.bodies.every(b=>Math.hypot(...b.displacement)<1e-4));assert.ok(Math.abs(f.joints.find(j=>j.id==='cadence').coordinate)<1e-4);}finally{s.free();}
});
test('stationary trainer holds the frame and lifts the driven wheel clear of the road',()=>{
  const s=new MultibodySimulation(bicycle({mode:'stand'}));
  try{const f=advance(s,1440),b=id=>f.bodies.find(b=>b.id===id);assert.ok(f.maxError<.001);assert.ok(Math.abs(b('bike-frame').displacement[0])<1e-5);assert.ok(b('rear-wheel').position[1]>.7);assert.ok(b('rear-wheel').angularVelocity[2]<-3);assert.ok(Math.abs(b('front-wheel').angularVelocity[2])<.01);}finally{s.free();}
});
test('reversing gear uses reaction impulses and dissipates rather than creates energy',()=>{
  const m={schema:'summer-mbd/1',dt:1/480,gravity:[0,0,0],bodies:['a','b'].map((id,i)=>({id,type:'dynamic',shape:'disc',position:[i*3,0,0],size:[1,1,.1],mass:2,angularVelocity:[0,0,i?0:-1]})),joints:[{id:'drive',type:'gear',a:'a',b:'b',anchor:[0,0,0],axis:[0,0,1],ratio:-2,maxTorque:80,stiffness:800,damping:8}]};
  const s=new MultibodySimulation(m);try{const initial=s.snapshot(),f=advance(s,960),I=inertia(s.model.bodies[0])[2];assert.ok(f.bodies[1].angularVelocity[2]>0);assert.ok(Math.abs(f.joints[0].speedError)<.001);assert.ok(Math.abs(I*(f.bodies[0].angularVelocity[2]-2*f.bodies[1].angularVelocity[2])+I)<1e-5);assert.ok(f.kinetic<=initial.kinetic+1e-5);}finally{s.free();}
});
test('Z-axis wheel contact normals and inertia match its cylinder collider',()=>{
  const s=new MultibodySimulation({schema:'summer-mbd/1',bodies:[{id:'wheel',type:'dynamic',shape:'disc',size:[2,2,.2],position:[0,0,0],mass:2}],joints:[]});
  try{const body=s.bodies.get('wheel');assert.ok(Math.abs(surface(body,[1.3,0,0]).distance-.3)<1e-9);assert.deepEqual(surface(body,[0,0,.2]).normal,[0,0,1]);assert.ok(Math.abs(surface(body,[0,0,.2]).distance-.1)<1e-9);body.rb.applyTorqueImpulse({x:0,y:0,z:1},true);assert.ok(Math.abs(body.rb.angvel().z-1/inertia(body.definition)[2])<1e-6);}finally{s.free();}
});
test('invalid assembly dimensions and appearance fail before replacing a model',()=>{
  for(const args of [{radius:NaN},{rpm:1000},{wheelbase:0},{ratio:0},{origin:[0,Infinity,0]}])assert.throws(()=>bicycle(args));
  const m=bicycle();m.bodies[0].appearance[0].color='url(unsafe)';assert.throws(()=>validateModel(m));
});
