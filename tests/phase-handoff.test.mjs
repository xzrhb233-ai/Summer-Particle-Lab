import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';

function compact(velocity=[0,0,0]){
  const s=new Simulation3();s.setSettings({gravity:false,thermal:false});
  s.box([-8,-8,-8],[8,8,8],11,false,20,10,.025,35,'box','',velocity,{},{enabled:true,strength:.2,seed:42},{},{},{enabled:true});
  for(let i=0;i<s.count;i++){s.x[i]*=.65;s.y[i]*=.65;s.z[i]*=.65;}
  return s;
}
function melt(s){s.brush('heat',[0,0,0],100,1);assert.equal(s.snapshot().liquids,s.count);}
function kinetic(s){let e=0;for(let i=0;i<s.count;i++)e+=s.mass[i]*(s.vx[i]**2+s.vy[i]**2+s.vz[i]**2)/2;return e;}
function speed(s,offset=[0,0,0]){let v=0;for(let i=0;i<s.count;i++)v=Math.max(v,Math.hypot(s.vx[i]-offset[0],s.vy[i]-offset[1],s.vz[i]-offset[2]));return v;}
function centre(s){const c=[0,0,0];let m=0;for(let i=0;i<s.count;i++){m+=s.mass[i];c[0]+=s.mass[i]*s.x[i];c[1]+=s.mass[i]*s.y[i];c[2]+=s.mass[i]*s.z[i];}return c.map(v=>v/m);}
function momentum(s){const p=[0,0,0];for(let i=0;i<s.count;i++){p[0]+=s.mass[i]*s.vx[i];p[1]+=s.mass[i]*s.vy[i];p[2]+=s.mass[i]*s.vz[i];}return p;}

test('compressed MPM melting repairs packing without a velocity kick at different timesteps',()=>{
  for(const dt of [1/120,1/240,1/1200]){
    const velocity=[3,-2,1],s=compact(velocity);
    // Different quadrature masses/volumes exercise reciprocal pair weighting.
    for(let i=0;i<s.count;i++){s.mass[i]*=i%2?.75:1.25;s.invMass[i]=1/s.mass[i];}
    melt(s);const initial=s.snapshot(),com=centre(s),positions=initial.data.slice();
    for(let k=0;k<Math.round(.1/dt);k++)s.substep(dt,false);
    assert.ok(speed(s,velocity)<1e-7,'packing correction must not become kinetic velocity');
    const after=centre(s);for(let a=0;a<3;a++)assert.ok(Math.abs(after[a]-com[a]-velocity[a]*.1)<1e-9);
    for(let i=0;i<s.count;i++)assert.ok(Math.hypot(s.x[i]-positions[i*8]-.3,s.y[i]-positions[i*8+1]+.2,s.z[i]-positions[i*8+2]-.1)<=.80001,'relaxation is time bounded');
    assert.equal(s.snapshot().mass,initial.mass);assert.equal(s.snapshot().energy,initial.energy);
  }
});

test('handoff finishes, without a delayed explosion or a timestep-dependent pressure kick',()=>{
  for(const dt of [1/120,1/240,1/1200]){
    const s=compact([3,0,0]);melt(s);let peak=0;
    for(let k=0;k<Math.round(2/dt);k++){s.substep(dt,false);peak=Math.max(peak,speed(s,[3,0,0]));}
    assert.ok(peak<15,`unexpected outward kick ${peak}`);
    assert.ok(s.fluidTransition.slice(0,s.count).every(v=>v===0),'must return to ordinary PBF');
  }
});

test('new compression during melting still receives pressure, without Jacobi energy overshoot',()=>{
  const s=compact();melt(s);
  for(let i=0;i<s.count;i++){s.vx[i]=-2*s.x[i];s.vy[i]=-2*s.y[i];s.vz[i]=-2*s.z[i];}
  const before=kinetic(s),p=momentum(s);s.substep(1/240,false);
  assert.ok(kinetic(s)<before*.5,'converging motion must be opposed, not just carried through');
  momentum(s).forEach((v,a)=>assert.ok(Math.abs(v-p[a])<1e-8));
});

test('local melting does not kick the remaining solid or neighboring liquid',()=>{
  const s=compact([3,-2,1]);s.brush('heat',[0,0,0],4,1);
  assert.ok(s.snapshot().solids>0&&s.snapshot().liquids>0);
  const p=momentum(s),e=kinetic(s);s.substep(1/240,true);
  assert.ok(speed(s,[3,-2,1])<1e-7);assert.ok(Math.abs(kinetic(s)-e)<1e-7);
  momentum(s).forEach((v,a)=>assert.ok(Math.abs(v-p[a])<1e-7));
});

test('wall-clipped packing relaxation does not generate a bounce',()=>{
  const s=compact();for(let i=0;i<s.count;i++)s.y[i]=-47+(s.y[i]+5.2)*.1;
  melt(s);s.step(1/240);assert.ok(speed(s)<1e-8);
  assert.ok(s.y.slice(0,s.count).every(y=>y>=-47));
});

test('a physically compressed specimen can be heated while the platen remains enabled',()=>{
  const s=compact();s.reset('empty');s.settings.gravity=true;
  s.box([-8,-40,-8],[8,-24,8],11,false,20,10,.025,35,'box','',[0,0,0],{},{enabled:true,strength:.2,seed:42},{},{},{enabled:true});
  s.press={enabled:true,y:-22,target:-32,speed:8,velocity:0,impulse:0,force:0,origin:-22};
  for(let k=0;k<180;k++)s.step();
  melt(s);const before=s.snapshot();let peak=0;
  for(let k=0;k<120;k++){s.step();peak=Math.max(peak,speed(s));}
  assert.ok(peak<30,`compressed melt sprayed at ${peak}`);
  assert.ok(s.y.slice(0,s.count).every(y=>y>=-47&&y<=s.press.y-1.8));
  assert.equal(s.snapshot().energy,before.energy);assert.equal(s.snapshot().mass,before.mass);
});

test('built-in melting, refreezing, swap deletion and reinsertion own their transition state',()=>{
  const s=compact();melt(s);s.fluidStable[s.count-1]=.035;s.remove(0);
  assert.equal(s.fluidTransition[0],1);assert.equal(s.fluidStable[0],.035);
  s.brush('cool',[0,0,0],100,2);assert.ok(s.fluidTransition.slice(0,s.count).every(v=>v===0));
  s.brush('heat',[0,0,0],100,2);assert.equal(s.snapshot().liquids,s.count);assert.equal(s.fluidStable[0],0);
  s.reset('empty');s.add(0,0,0,4,-10);s.enthalpy[0]=400000;s.phaseTransition(0);
  assert.equal(s.material[0],2);assert.equal(s.fluidTransition[0],1);
  s.enthalpy[0]=-1000;s.phaseTransition(0);assert.equal(s.fluidTransition[0],0);
  s.remove(0);s.add(0,0,0,11,20);assert.equal(s.fluidTransition[0],0);
});

test('anti-clumping strength scales with physical time rather than substep count',()=>{
  const acceleration=[];
  for(const dt of [1/120,1/240,1/1200]){
    const s=new Simulation3();s.setSettings({gravity:false,thermal:false});s.add(-1,0,0,2,20);s.add(1,0,0,2,20);
    s.substep(dt,false);acceleration.push(s.vx[1]/dt);
  }
  assert.ok(Math.max(...acceleration)/Math.min(...acceleration)<1.06);
});
