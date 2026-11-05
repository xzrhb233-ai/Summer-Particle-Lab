import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation,MotionHistory} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {contactImpulse,surface,arr,cross} from '../src/multibody/contact.js';
import {LENGTH as L} from '../src/multibody/coupling-model.js';
import {inertia,norm,add,sub,mul} from '../src/multibody/model.js';
import {preset} from '../src/multibody/presets.js';
import {coupledCSV} from '../src/multibody/coupling-ui.js';
await initialize();
const body=(id,position,type='dynamic',extra={})=>({id,type,shape:'box',position,size:[.2,.2,.2],mass:2,...extra});
const sample=(center=[0,0,0],size=[.1,.1,.1],extra={})=>({center,size,model:10,temperature:20,sampling:{enabled:false},...extra});
const model=(bodies,parts,extra={})=>({schema:'summer-mbd/1',gravity:[0,0,0],bodies,joints:[],coupling:{enabled:true,domain:{lower:[-1,-1,-1],upper:[1,1,1],cellSize:.1,particlesPerAxis:2},parts,...extra}});
function momentum(s){let p=[0,0,0];for(const b of s.bodies.values())if(b.definition.type==='dynamic')p=add(p,mul(arr(b.rb.linvel()),b.definition.mass));const a=s.particles;for(let i=0;i<a.count;i++)p=add(p,[a.vx[i],a.vy[i],a.vz[i]].map(x=>x*L*a.mass[i]));return p;}
function advance(s,time){let f;for(let i=0;i<Math.round(time*240);i++)f=s.step(1/240);return f;}
test('contact impulse conserves linear/angular momentum and friction dissipates energy',()=>{
  const s=new MultibodySimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[body('b',[0,0,0], 'dynamic',{shape:'sphere',size:[1,1,1]})],joints:[]});
  try{const b=s.bodies.get('b');b.rb.recomputeMassPropertiesFromColliders();const p=[.4,.5,0],v=[2,-1,.3],m=3,P=mul(v,m),angular=cross(p,P),before=.5*m*norm(v)**2;
    const r=contactImpulse(b,p,v,m,[0,1,0],.5,0),bodyP=mul(arr(b.rb.linvel()),2),afterP=add(mul(r.velocity,m),bodyP),w=arr(b.rb.angvel()),I=inertia(b.definition);
    assert.ok(norm(sub(afterP,P))<1e-6);assert.ok(norm(sub(add(cross(p,mul(r.velocity,m)),w.map((x,i)=>x*I[i])),angular))<1e-6);assert.ok(norm(w)>.01);
    assert.ok(.5*m*norm(r.velocity)**2+norm(bodyP)**2/4+.5*w.reduce((x,v,i)=>x+v*v*I[i],0)<before);
  }finally{s.free();}
});
test('rotated box, sphere and cylinder expose finite outward signed distances',()=>{
  for(const shape of ['box','sphere','cylinder']){const s=new MultibodySimulation({schema:'summer-mbd/1',bodies:[body('b',[0,0,0],'fixed',{shape,size:[1,1,1],rotation:[20,30,40]})],joints:[]});try{const b=s.bodies.get('b');assert.ok(surface(b,[0,0,0]).distance<0);const hit=surface(b,[3,1,2]);assert.ok(hit.distance>2);assert.ok(Math.abs(norm(hit.normal)-1)<1e-6);}finally{s.free();}}
});
test('MPM grid contact transfers momentum back to a free rigid body with deformation',()=>{
  const s=new CoupledSimulation(model([body('ball',[.3,.3,0],'dynamic',{shape:'sphere',size:[.4,.4,.4]})],[sample([-.15,.3,0],[.2,.2,.2],{velocity:[1,0,0],model:0})]));
  try{const initial=momentum(s),f=advance(s,.3);assert.ok(f.bodies[0].velocity[0]>.1);assert.ok(norm(sub(momentum(s),initial))<.001);assert.ok(f.coupling.maxStress>.001);assert.ok(s.particles.mpm.F.some((v,i)=>i<9*s.particles.count&&Math.abs(v-(i%4===0?1:0))>.001));assert.ok(Math.abs(f.time-s.particles.time)<1e-12);}finally{s.free();}
});
test('finite-capacity fixed rigid body and MPM temperatures approach equilibrium with conserved heat',()=>{
  const s=new CoupledSimulation(model([body('hot',[.2,0,0],'fixed',{thermal:{temperature:100,cp:500,conductivity:50}})],[sample([.05,0,0])],{thermalScale:1000,mechanical:false}));
  try{const initial=s.totalThermal(),mass=s.snapshot().coupling.mass,equilibrium=initial/(2*500+mass*1800);for(let i=0;i<10000;i++)s.heatStep(.1);const f=s.snapshot();assert.ok(Math.abs(s.totalThermal()-initial)<1e-6);assert.ok(f.bodies[0].temperature<100&&f.coupling.meanTemperature>20);assert.ok(Math.abs(f.bodies[0].temperature-equilibrium)<1e-5);assert.ok(f.coupling.minTemperature>=20&&f.coupling.maxTemperature<=100);}finally{s.free();}
});
test('separated bodies exchange no heat and disabling contact removes two-way forces',()=>{
  const s=new CoupledSimulation(model([body('hot',[.7,0,0],'fixed',{thermal:{temperature:400}})],[sample()],{thermalScale:1000,mechanical:false}));try{const f=advance(s,.1);assert.equal(f.bodies[0].temperature,400);assert.ok(Math.abs(f.coupling.meanTemperature-20)<1e-10);assert.deepEqual(f.bodies[0].contactForce,[0,0,0]);}finally{s.free();}
});
test('heating/cooling acts without reset, accounts external joules and drives reversible phase handoff',()=>{
  const s=new CoupledSimulation(model([], [sample([0,0,0],[.1,.1,.1],{phaseChange:{enabled:true,meltingPoint:40,latentHeat:1000}})],{thermal:false,mechanical:false}));
  try{const count=s.particles.count;s.setHeater({center:[0,0,0],radius:1,power:200000});let f=advance(s,.5);assert.equal(f.coupling.solids,0);assert.ok(Math.abs(f.coupling.externalHeat-100000)<1e-6);assert.ok(Math.abs(f.coupling.thermalResidual)<1e-6);assert.equal(f.coupling.count,count);s.setHeater({power:-200000});f=advance(s,.5);assert.equal(f.coupling.solids,count);assert.ok(Math.abs(f.coupling.meanTemperature-20)<1e-7);assert.ok(Math.abs(f.coupling.thermalResidual)<1e-6);assert.ok(Math.abs(f.time-1)<1e-10);s.setHeater({power:0});assert.throws(()=>s.setHeater({power:NaN}));assert.equal(s.model.coupling.heater.power,0);}finally{s.free();}
});
test('hot-platen mechanism transmits contact loads and heat into a temperature-dependent MPM sample',()=>{
  const s=new CoupledSimulation(preset('coupling'));try{const f=advance(s,1);assert.ok(f.bodies.find(b=>b.id==='hot-platen').temperature<400);assert.ok(f.coupling.maxTemperature>20.1);assert.ok(norm(f.bodies[2].contactForce)>1);assert.ok(f.coupling.maxStress>0);assert.ok(f.maxError<.003);assert.ok(Math.abs(f.coupling.thermalResidual)<1e-5);}finally{s.free();}
});
test('live temperature changes the loaded MPM constitutive response, not only its color',()=>{
  const values=[];
  for(const power of [0,1e7]){const d=preset('coupling');d.coupling.thermal=false;d.coupling.heater={center:[0,.2,0],radius:2,power};const s=new CoupledSimulation(d);
    try{const f=advance(s,1);assert.ok(Math.abs(f.coupling.thermalResidual)<.001);values.push({temperature:f.coupling.meanTemperature,plastic:f.coupling.maxPlastic,y:f.bodies[2].position[1]});}finally{s.free();}}
  assert.ok(values[1].temperature-values[0].temperature>20);assert.ok(values[1].plastic-values[0].plastic>.02);assert.ok(values[1].y<values[0].y-.005);
});
test('invalid coupling models reject before replacing existing state; history includes particle temperature',()=>{
  const d=model([body('b',[.5,0,0])],[sample()]),s=new CoupledSimulation(d);
  try{for(const edit of [m=>m.coupling.thermalScale=-1,m=>m.coupling.parts.push(structuredClone(m.coupling.parts[0])),m=>m.bodies[0].thermal={cp:0},m=>m.coupling.parts[0].center=[.5,0,0],m=>m.coupling.parts[0].size=[1,1,1]]){const bad=structuredClone(d);edit(bad);assert.throws(()=>new CoupledSimulation(bad));}
    const h=new MotionHistory(),first=s.snapshot();h.record(first);s.setHeater({power:1000,radius:1});h.record(advance(s,.1));assert.equal(h.at(0).particles[4],20);assert.ok(h.at(1).particles[4]>20);assert.match(coupledCSV(h.frames),/contact_heat_W/);assert.equal(h.at(0).coupling.externalHeat,0);
  }finally{s.free();}
});
