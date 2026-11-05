import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {bicycleCourse} from '../src/multibody/bicycle.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {cpuCoupledAdapter} from '../src/simulation/cpu-adapter.js';
import {Simulation3} from '../src/three/simulation.js';
import {updateDamage} from '../src/three/fracture.js';
import {identity} from '../src/three/math.js';
import {readRecording} from '../src/simulation/recording.js';
await initialize();

test('course round trip keeps three independent methods, geometry and fracture settings',()=>{
  const m=bicycleCourse(),p=fromLegacy(m);assert.deepEqual(toLegacy(JSON.parse(JSON.stringify(p))),m);
  assert.deepEqual(p.parts.slice(-3).map(x=>x.method),['mpm','pbf','mpm']);
  assert.deepEqual(validateGpuProject(p).parts,p.parts);
  const [first,pool,last]=m.coupling.parts;
  assert.ok(Math.abs(pool.center[0]-pool.size[0]/2-first.center[0]-first.size[0]/2)<1e-9);
  assert.ok(Math.abs(pool.center[0]+pool.size[0]/2-last.center[0]+last.size[0]/2)<1e-9);
  assert.equal(pool.size[1],1);assert.ok(pool.size[1]>m.bodies.find(b=>b.id==='front-wheel').size[0]/2);
  assert.equal(m.bodies.some(b=>/^pool-(entry|exit)$/.test(b.id)),false);
  const solver=cpuCoupledAdapter.create(p);
  try{const f=solver.snapshot();assert.equal(f.coupling.liquids,6360);assert.ok(f.coupling.solids>0);assert.ok(f.coupling.count===8376);assert.equal(f.coupling.damaged,0);assert.equal(f.results.parts.at(-2).method,'pbf');assert.ok(Math.abs(f.results.parts.at(-2).values.mass-pool.size.reduce((a,b)=>a*b,1000))<1e-8);assert.equal(f.results.parts.at(-1).values.failed,0);assert.ok(Math.abs(f.results.parts.at(-1).values.mass-950.4)<1e-8);}finally{solver.free();}
  const fluid=p.parts.at(-2);fluid.material.fracture.enabled=true;assert.throws(()=>toLegacy(p),/PBF/);
  fluid.material.fracture.enabled=false;
  for(const t of [-10,0,100,150]){fluid.initial.temperature=t;assert.throws(()=>validateGpuProject(p),/PBF 水初温/);}
});

test('custom material density changes parcel mass and heat capacity without changing volume or fixed faces',()=>{
  const make=density=>new CoupledSimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[],joints:[],coupling:{enabled:true,parts:[{id:'foam',center:[0,1,0],size:[.2,.2,.2],density,model:0,fixedFace:'minY',sampling:{enabled:false}}]}});
  const light=make(250),heavy=make(1000);
  try{
    const a=light.particles,b=heavy.particles;assert.equal(a.count,8);
    assert.deepEqual(a.volume.slice(0,8),b.volume.slice(0,8));assert.deepEqual(a.pinned.slice(0,8),b.pinned.slice(0,8));
    for(let i=0;i<8;i++){assert.equal(a.mass[i],.25);assert.equal(b.mass[i],1);assert.equal(a.invMass[i],a.pinned[i]?0:4);}
    assert.ok(Math.abs(light.totalThermal()*4-heavy.totalThermal())<1e-6);
  }finally{light.free();heavy.free();}
});

test('PBF boundary impulse returns momentum to a free rigid body without adding kinetic energy',()=>{
  const s=new CoupledSimulation({schema:'summer-mbd/1',gravity:[0,0,0],joints:[],bodies:[{id:'ball',type:'dynamic',shape:'sphere',size:[.4,.4,.4],position:[0,1,0],mass:2}],coupling:{enabled:true,thermal:false,friction:0,parts:[{id:'water',method:'pbf',center:[.35,1.05,.05],size:[.1,.1,.1],model:0}]}});
  try{const p=s.particles;assert.equal(p.count,1);assert.equal(p.fluidTransition[0],0);p.x[0]=.21/.025;p.y[0]=1/.025;p.z[0]=0;p.vx[0]=-.4/.025;const momentum=p.mass[0]*-.4,energy=.5*p.mass[0]*.4**2;s.particleContact(1/480,true);const vx=s.bodies.get('ball').rb.linvel().x;
    assert.ok(vx<0);assert.ok(Math.abs(p.mass[0]*p.vx[0]*.025+2*vx-momentum)<1e-7);assert.ok(.5*p.mass[0]*(p.vx[0]*.025)**2+vx*vx<=energy+1e-7);
  }finally{s.free();}
});

test('brittle damage is objective and irreversible, and failure preserves parcel mass and momentum',()=>{
  const s=new Simulation3();s.reset('empty');s.createGeometry({center:[0,0,0],size:[4,4,4],fracture:{enabled:true,onset:.04,failure:.1}});const m=s.mass[0];s.vx[0]=2;s.vy[0]=3;
  s.mpm.F.set([0,-1,0,1,0,0,0,0,1],0);updateDamage(s,0);assert.equal(s.damage[0],0);
  s.mpm.F.set([Math.exp(.07),0,0,0,1,0,0,0,1],0);updateDamage(s,0);assert.ok(Math.abs(s.damage[0]-.5)<1e-8);
  s.mpm.F.set(identity(),0);updateDamage(s,0);assert.ok(s.damage[0]>.49);
  s.mpm.F.set([Math.exp(.11),0,0,0,1,0,0,0,1],0);updateDamage(s,0);assert.equal(s.damage[0],1);assert.equal(s.model[0],3);assert.equal(s.mass[0],m);assert.equal(s.vx[0],2);assert.equal(s.vy[0],3);assert.ok(s.isSolid(0));
  s.mpm.updateStress(s,0);assert.ok(s.mpm.stress[0]<1e-8);
});

test('expanded spatial hash finds nearby particles beyond the old six metre limit',()=>{
  const s=new Simulation3();s.reset('empty');s.configureDomain({lower:[0,-16,-16],upper:[480,16,16],cellSize:8,particlesPerAxis:2});
  s.add(400,0,0,2,20);s.add(404,0,0,2,20);s.add(470,0,0,2,20);s.buildGrid();const neighbors=[];s.near(0,j=>neighbors.push(j));assert.deepEqual(neighbors,[1]);
  s.configureDomain({lower:[0,-16,-16],upper:[960,16,16],cellSize:16,particlesPerAxis:4});s.buildGrid();const more=[];s.near(0,j=>more.push(j));assert.deepEqual(more,[1]);
});

test('computed recordings restore display geometry and reject invalid or inconsistent state',()=>{
  const project=fromLegacy(bicycleCourse()),solver=cpuCoupledAdapter.create(project);
  try{
    const first=solver.snapshot();first.particles=Array.from(first.particles);first.bodies.forEach(b=>delete b.appearance);
    const second=structuredClone(first);second.time=.1;
    const tape={schema:'summer-replay/1',project,frames:[first,second]},read=readRecording(tape);
    assert.equal(read.frames.length,2);assert.ok(read.frames[0].particles instanceof Float32Array);assert.ok(Object.isFrozen(read.frames[0].bodies[3].appearance));
    for(const change of [t=>t.frames[1].time=-1,t=>t.frames[1].particles[0]=NaN,t=>t.frames[1].particles.pop(),t=>t.frames[1].bodies[0].id='unknown']){
      const invalid=structuredClone(tape);change(invalid);assert.throws(()=>readRecording(invalid));
    }
  }finally{solver.free();}
});

test('a detached shallow pool remains available explicitly, while the filled pool follows the wall position',()=>{
  const old=bicycleCourse({fillGap:false,waterDepth:.2,waterLength:1.2});assert.ok(old.bodies.some(b=>b.id==='pool-entry'));assert.ok(Math.abs(old.coupling.parts[1].size[0]-1.2)<1e-9);
  const wide=bicycleCourse({wallX:9.4,waterDepth:1}),s=new CoupledSimulation(wide);try{assert.equal(s.particles.count,8616);}finally{s.free();}
  assert.throws(()=>bicycleCourse({fillGap:false,waterLength:4}),/重叠/);
});
