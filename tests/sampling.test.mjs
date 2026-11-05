import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
import {samplingOptions} from '../src/three/sampling.js';
function create(shape='box',sampling={},fixed=false,material=11){
  const s=new Simulation3();assert.ok(s.box([-8,0,-8],[8,16,8],material,fixed,20,0,.025,35,shape,'',[0,0,0],{},sampling));return s;
}
const xyz=s=>Array.from({length:s.count},(_,i)=>[s.x[i],s.y[i],s.z[i]]);
test('creation noise is repeatable, bounded, and preserves sample count, mass and enthalpy',()=>{
  for(const shape of ['box','ellipsoid','cylinder']){
    const base=create(shape),s=create(shape,{enabled:true,strength:.35,seed:123});
    assert.equal(s.count,base.count);assert.equal(s.snapshot().mass,base.snapshot().mass);assert.equal(s.snapshot().energy,base.snapshot().energy);
    assert.deepEqual(xyz(s),xyz(create(shape,{enabled:true,strength:.35,seed:123})));
    assert.notDeepEqual(xyz(s),xyz(create(shape,{enabled:true,strength:.35,seed:124})));
    let moved=0;
    for(let i=0;i<s.count;i++){
      const p=[s.x[i],s.y[i],s.z[i]],d=Math.hypot(...p.map((v,a)=>v-[base.x[i],base.y[i],base.z[i]][a]));
      assert.ok(d<=1.4+1e-10);if(d>1e-6)moved++;
      assert.ok(p[0]>=-8&&p[0]<=8&&p[1]>=0&&p[1]<=16&&p[2]>=-8&&p[2]<=8);
      const q=[p[0]/8,(p[1]-8)/8,p[2]/8];if(shape!=='box')assert.ok(q[0]**2+q[2]**2+(shape==='ellipsoid'?q[1]**2:0)<=1+1e-10);
      for(let j=0;j<i;j++)assert.ok(Math.hypot(s.x[i]-s.x[j],s.y[i]-s.y[j],s.z[i]-s.z[j])>=1.2-1e-10);
    }
    assert.ok(moved>s.count*.8);
  }
});
test('zero/disabled noise reproduces old geometry and fixed-face membership survives noise',()=>{
  assert.deepEqual(xyz(create()),xyz(create('box',{enabled:true,strength:0})));
  assert.deepEqual(xyz(create()),xyz(create('box',{enabled:false,strength:.35,seed:123})));
  const base=create('box',{},true),s=create('box',{enabled:true},true);
  assert.deepEqual(s.pinned.slice(0,s.count),base.pinned.slice(0,base.count));
  for(let i=0;i<s.count;i++)if(s.pinned[i]){assert.equal(s.x[i],-8);assert.equal(s.ax[i],s.x[i]);assert.equal(s.ay[i],s.y[i]);}
  assert.equal(s.lab.snapshot()[0].displacement,0);
  const fluid=create('box',{enabled:true},false,2);assert.notDeepEqual(xyz(fluid),xyz(create()));
  for(let k=0;k<12;k++)s.step();assert.ok(s.snapshot().minJ>0);
});
test('invalid sampling settings reject creation without partial mutation',()=>{
  for(const bad of [null,[],{enabled:1},{strength:NaN},{strength:-.01},{strength:.36},{seed:1.5},{seed:-1},{seed:2147483648},{unexpected:1}]){
    assert.equal(samplingOptions(bad),null);const s=new Simulation3();
    assert.equal(s.box([0,0,0],[8,8,8],11,false,20,0,.025,35,'box','',[0,0,0],{},bad),false);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  }
});
