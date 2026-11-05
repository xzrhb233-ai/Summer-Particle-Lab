import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
function isolated(){const s=new Simulation();s.settings.gravity='none';s.settings.thermal=false;return s;}
test('solid blocks retain pair distances; sand remains unbonded',()=>{
  const s=isolated();for(let y=0;y<12;y+=3.4)for(let x=0;x<12;x+=3.9)s.add(x,y,0);
  s.add(80,0,6);s.add(83.9,0,6);s.buildGrid();s.flushBonds();
  assert.ok(s.structures.edges.length>25);assert.ok(s.structures.edges.every(e=>e.a<16 && e.b<16));
  for(let i=0;i<s.count;i++){s.vx[i]=7;s.vy[i]=-2;}
  for(let i=0;i<120;i++)s.step();
  for(const e of s.structures.edges)assert.ok(Math.abs(Math.hypot(s.x[e.a]-s.x[e.b],s.y[e.a]-s.y[e.b])-e.rest)<.15);
});
test('elastic links deform under load and return after unloading; steel is stiffer',()=>{
  const lengths=[];
  for(const mat of [7,8]){
    const s=isolated();s.add(0,0,mat);s.add(8,0,mat);s.kind[0]=s.kind[1]=1;s.structures.add(0,1,true);s.structures.pin(0,true);
    for(let i=0;i<180;i++){s.vx[1]+=10;s.step(1/120);}lengths.push(s.x[1]);
    const loaded=s.x[1];for(let i=0;i<240;i++)s.step(1/120);
    assert.equal(s.x[0],0);assert.ok(Math.abs(s.x[1]-8)<Math.abs(loaded-8)+.001);
  }
  assert.ok(lengths[1]>lengths[0]+.5);
});
test('rope carries tension but does not resist compression',()=>{
  const s=isolated();s.add(0,0,9);s.add(10,0,9);s.structures.add(0,1,true);
  s.x[1]=5;s.structures.begin();s.structures.solve(1/60);assert.equal(s.x[1],5);
  s.x[1]=14;s.structures.begin();s.structures.solve(1/60);assert.ok(s.x[1]-s.x[0]<11);
});
test('anchored segments stop falling material; cut, release and deletion keep indices valid',()=>{
  const s=isolated();s.settings.gravity='uniform';s.structures.create({x1:-24,y1:0,x2:24,y2:0,material:7});
  const start=s.count;for(let i=0;i<start;i++)s.structures.pin(i,true);
  s.add(0,15,6);for(let i=0;i<180;i++)s.step();assert.ok(s.y[start]>3);
  const before=s.structures.edges.length;s.structures.brush('cut',0,0,5);assert.ok(s.structures.edges.length<before);
  s.structures.brush('release',-24,0,10);assert.equal(s.pinned[0],0);
  s.removeAt(2);assert.ok(s.structures.edges.every(e=>e.a<s.count && e.b<s.count && e.a!==e.b));
  s.step();for(let i=0;i<s.count;i++)assert.ok(Number.isFinite(s.x[i]+s.y[i]));
});
test('structure creation is atomic at capacity and rejects invalid input',()=>{
  const s=isolated();s.count=s.x.length-3;
  assert.equal(s.structures.create({x1:0,y1:0,x2:30,y2:0}),false);assert.equal(s.count,s.x.length-3);
  assert.equal(s.structures.create({x1:NaN,y1:0,x2:30,y2:0}),false);
});
