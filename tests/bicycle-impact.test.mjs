import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {bicycle,bicycleWall} from '../src/multibody/bicycle.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {Simulation3} from '../src/three/simulation.js';
import {contactBounds,withinBounds,surface} from '../src/multibody/contact.js';
await initialize();

test('native impact assembly round-trips the enlarged domain, MPM wall and fixed face',()=>{
  const m=bicycleWall(),p=fromLegacy(m),w=p.parts.find(b=>b.id==='impact-wall');
  assert.deepEqual(toLegacy(JSON.parse(JSON.stringify(p))),m);
  assert.equal(w.method,'mpm');assert.equal(w.boundary.fixedFace,'minY');
  assert.deepEqual(m.coupling.domain.upper.map((v,a)=>v-m.coupling.domain.lower[a]),[9,4.4,3.2]);
  for(const args of [{gap:0},{height:Infinity},{thickness:.01},{mode:'stand'},{stiffness:41}])assert.throws(()=>bicycleWall(args));
});

test('enabling coupled integration does not disconnect the bicycle chain drive',()=>{
  const m=bicycleWall();m.coupling.parts=[];const s=new CoupledSimulation(m);
  try{let f;for(let i=0;i<720;i++)f=s.step();const rear=f.bodies.find(b=>b.id==='rear-wheel');
    assert.ok(rear.displacement[0]>.7);assert.ok(rear.angularVelocity[2]<-1);
    assert.ok(Math.abs(f.joints.find(j=>j.id==='chain').phaseError)<.1);
  }finally{s.free();}
});

test('bicycle travels freely before a two-way MPM impact slows it and deforms the wall',()=>{
  const s=new CoupledSimulation(bicycleWall()),free=new MultibodySimulation(bicycle());
  const initial=s.snapshot(),p=s.particles,pins=[];let f,control,first=null,peak=0,approach=0,maxError=0;
  for(let i=0;i<p.count;i++)if(p.pinned[i])pins.push([i,p.x[i],p.y[i],p.z[i]]);
  try{
    assert.equal(p.count,1152);assert.equal(pins.length,48);
    for(let i=0;i<1440;i++){
      f=s.step();control=free.step();const wheel=f.bodies.find(b=>b.id==='front-wheel'),force=Math.hypot(...wheel.contactForce);
      peak=Math.max(peak,force);maxError=Math.max(maxError,f.maxError);
      if(force>1&&first===null){first=f.time;approach=wheel.velocity[0];}
      if(i===959){assert.equal(first,null);assert.ok(wheel.displacement[0]>1.3);assert.ok(wheel.velocity[0]>1);}
    }
    const wheel=f.bodies.find(b=>b.id==='front-wheel'),unobstructed=control.bodies.find(b=>b.id==='front-wheel');
    assert.ok(first>2&&first<2.6);assert.ok(peak>100);assert.ok(approach>1);
    assert.ok(Math.abs(wheel.velocity[0])<.15);assert.ok(unobstructed.displacement[0]-wheel.displacement[0]>.8);
    assert.ok(maxError<.005);assert.ok(f.coupling.maxPenetration<.02);
    let dx=0;for(let i=0;i<p.count;i++)dx=Math.max(dx,Math.abs(f.particles[i*8]-initial.particles[i*8]));
    assert.ok(dx>.1,'wall must deform, not just display particles');
    for(const [i,x,y,z] of pins)assert.deepEqual([p.x[i],p.y[i],p.z[i]],[x,y,z]);
    assert.ok(f.particles.every(Number.isFinite));
  }finally{s.free();free.free();}
});

test('native fixed-face sampling follows local axes after rotating geometry',()=>{
  const s=new Simulation3();s.reset('empty');
  s.createGeometry({shape:'box',center:[0,0,0],size:[16,24,16],rotation:[0,0,90],fixedFace:'minY',sampling:{enabled:true,strength:.2,seed:42}});
  let pinned=0,moving=0;
  for(let i=0;i<s.count;i++)if(s.pinned[i]){pinned++;assert.ok(s.x[i]>8);assert.equal(s.invMass[i],0);}else moving++;
  assert.ok(pinned>0&&moving>pinned);
  assert.throws(()=>s.createGeometry({shape:'box',center:[0,0,0],size:[8,8,8],fixedFace:'invalid'}));
});

test('contact broad phase retains every nearby point for rotated primitive colliders',()=>{
  for(const shape of ['box','sphere','cylinder','disc']){
    const s=new MultibodySimulation({schema:'summer-mbd/1',bodies:[{id:'b',shape,type:'fixed',size:[1,1,shape==='disc'?.2:1],position:[.4,.3,-.2],rotation:[20,30,40]}],joints:[]});
    try{const b=s.bodies.get('b'),bounds=contactBounds(b,.06);for(let x=-.5;x<1.5;x+=.16)for(let y=-.6;y<1.4;y+=.16)for(let z=-1.2;z<.8;z+=.16)if(surface(b,[x,y,z]).distance<=.06)assert.ok(withinBounds(bounds,x,y,z));}finally{s.free();}
  }
});
