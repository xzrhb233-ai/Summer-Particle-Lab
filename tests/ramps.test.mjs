import test from 'node:test';
import assert from 'node:assert/strict';
import {bicycleRamps} from '../src/multibody/bicycle.js';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {surface} from '../src/multibody/contact.js';
import {inertia} from '../src/multibody/model.js';
import {Simulation3} from '../src/three/simulation.js';
await initialize();

test('fixed ramp basin is editable, GPU compatible, and joins roads and submerged floor continuously',()=>{
  const m=bicycleRamps(),p=fromLegacy(m);assert.deepEqual(toLegacy(JSON.parse(JSON.stringify(p))),m);validateGpuProject(p);
  assert.ok(m.coupling.parts.every(p=>p.method==='pbf'));assert.equal(m.coupling.parts.length,9);
  const s=new CoupledSimulation(m);
  try{
    assert.equal(s.particles.count,5076);assert.equal(s.snapshot().coupling.solids,0);
    const water=m.coupling.parts[0],toe=water.center[0]-water.size[0]/2,far=water.center[0]+water.size[0]/2;
    for(const [id,points] of [['pool-ramp-entry',[[3.2,0,0],[toe,-1.2,0]]],['pool-ramp-exit',[[far,-1.2,0],[far+toe-3.2,0,0]]]]){
      const body=s.bodies.get(id);assert.equal(body.definition.type,'fixed');
      for(const p of points)assert.ok(Math.abs(surface(body,p).distance)<1e-5);
    }
    // No horizontal road spans the basin and blocks the descending wheel.
    for(const id of ['road-0','road-1'])assert.ok(surface(s.bodies.get(id),[water.center[0],-.5,0]).distance>1);
    assert.ok(surface(s.bodies.get('pool-floor'),[water.center[0],-1.2,0]).distance<1e-6);
  }finally{s.free();}
});

test('physical drivetrain descends and exits both 34 degree ramps without prescribed position',()=>{
  const m=bicycleRamps();delete m.coupling;const s=new MultibodySimulation(m);let lowest=Infinity,maxError=0,f;
  try{
    for(let i=0;i<4800;i++){f=s.step();lowest=Math.min(lowest,f.bodies.find(b=>b.id==='front-wheel').position[1]);maxError=Math.max(maxError,f.maxError);}
    assert.ok(lowest<-.4,`front wheel descended to ${lowest}`);
    const end=f.bodies.find(b=>b.id==='rear-wheel');assert.ok(end.position[0]>11,`rear wheel only reached ${end.position[0]}`);assert.ok(Math.abs(end.position[1]-.62)<.03);
    assert.ok(maxError<.002,`joint error ${maxError}`);
    for(const b of f.bodies.filter(b=>b.type==='fixed'))assert.ok(Math.hypot(...b.displacement)<1e-6);
  }finally{s.free();}
});

test('ramp settings reject unsupported slopes and water levels',()=>{
  for(const options of [{angle:0},{angle:41},{waterDepth:1.3},{angle:NaN},{pitchSupport:'yes'},{wheelTorque:501},{driveGain:1001},{waterFriction:NaN}])assert.throws(()=>bicycleRamps(options));
  assert.ok(!bicycleRamps({pitchSupport:false}).joints.some(j=>j.id==='pitch-support'));
  const spring=bicycleRamps().joints.find(j=>j.id==='pitch-support');assert.equal(spring.type,'gear');assert.equal(spring.maxTorque,500);
});

test('hollow tire admits water and rigid bodies through its center and uses torus inertia',()=>{
  const s=new MultibodySimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[
    {id:'tire',shape:'torus',type:'fixed',position:[0,0,0],size:[1.24,1.24,.12],mass:2},
    {id:'ball',shape:'sphere',type:'dynamic',position:[0,0,-.5],size:[.1,.1,.1],mass:1,velocity:[0,0,.5]},
  ],joints:[]});
  try{
    const tire=s.bodies.get('tire');assert.ok(Math.abs(surface(tire,[0,0,0]).distance-.5)<1e-6);
    assert.ok(surface(tire,[.53,0,0]).distance<0);assert.ok(surface(tire,[.5,0,0]).normal[0]<-.99);
    for(let i=0;i<480;i++)s.step();assert.ok(s.bodies.get('ball').rb.translation().z>.49);
  }finally{s.free();}
  const m=bicycleRamps(),wheel=m.bodies.find(b=>b.id==='front-wheel');assert.equal(wheel.shape,'torus');
  const isolated=new MultibodySimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[wheel],joints:[]});
  try{const rb=isolated.bodies.get('front-wheel').rb;rb.recomputeMassPropertiesFromColliders();assert.ok(Math.abs(rb.mass()-wheel.mass)<1e-6);rb.applyTorqueImpulse({x:0,y:0,z:1},true);assert.ok(Math.abs(rb.angvel().z-1/inertia(wheel)[2])<1e-5);}finally{isolated.free();}
});

test('coupled liquid density repair preserves momentum without generating kinetic energy',()=>{
  const s=new Simulation3();s.reset('empty');s.createGeometry({material:2,center:[0,0,0],size:[12,12,12],sampling:{enabled:false}});s.energySafePressure=true;
  for(let i=0;i<s.count;i++)for(const [a,old] of [['x','ox'],['y','oy'],['z','oz']]){s[a][i]*=.65;s[old][i]=s[a][i]-.03*Math.sin(i+1);}
  const energy=()=>Array.from({length:s.count},(_,i)=>s.mass[i]*(['x','y','z'].reduce((v,a,k)=>v+(s[a][i]-s[['ox','oy','oz'][k]][i])**2,0))).reduce((a,b)=>a+b,0);
  const momentum=()=>['x','y','z'].map((a,k)=>Array.from({length:s.count},(_,i)=>s.mass[i]*(s[a][i]-s[['ox','oy','oz'][k]][i])).reduce((a,b)=>a+b,0));
  const e=energy(),p=momentum(),span=Math.max(...s.x.subarray(0,s.count))-Math.min(...s.x.subarray(0,s.count));
  s.buildGrid();s.pairs=[];for(let i=0;i<s.count;i++)s.near(i,j=>{if(j>i)s.pairs.push(i,j);});
  s.density(1/480);
  assert.ok(energy()<=e+1e-9);momentum().forEach((v,a)=>assert.ok(Math.abs(v-p[a])<1e-9));
  assert.ok(Math.max(...s.x.subarray(0,s.count))-Math.min(...s.x.subarray(0,s.count))>span,'density repair must not freeze a compressed block');
});
