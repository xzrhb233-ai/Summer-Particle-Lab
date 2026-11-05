import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {mixedThermalContactProject,validateMixed} from '../src/mixed/model.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {partTemperature,interfaceHeat,thermalHistoryCSV} from '../src/simulation/thermal-history.js';
await initialize();
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} vs ${b}, tolerance ${t}`);
test('temperature history never fabricates extrema for a mean-only particle adapter',()=>{
  assert.deepEqual(partTemperature({results:{parts:[{id:'p',method:'mpm',values:{temperature:42}}]}},'p'),{mean:42,min:null,max:null});
});
function run(p,end=30){const s=new MixedSimulation(p),frames=[s.snapshot()];try{while(s.time<end-1e-10)frames.push(s.step(Math.min(1,end-s.time)));return frames;}finally{s.free();}}

test('sustained contact visibly heats a physical thin plate, with thermostat energy accounted for',()=>{
  const p=mixedThermalContactProject();assert.deepEqual(validateMixed(JSON.parse(JSON.stringify(p))),p);
  const frames=run(p),last=frames.at(-1),T=partTemperature(last,'beam'),q=interfaceHeat(last,'pad-plate');
  assert.ok(T.mean>26&&T.mean<28);assert.ok(T.max>55&&T.max<65);assert.ok(T.min>=20-1e-9&&T.max<160);
  const plate=last.results.parts.find(p=>p.id==='beam').values;near(plate.mass,.018);near(q.heat,plate.mass*1500*(T.mean-20),1e-6);
  near(last.thermal.externalHeat,q.heat,1e-6);assert.ok(Math.abs(last.thermal.residual)<1e-6);
  assert.ok(q.rate>0&&q.rate<interfaceHeat(frames[1],'pad-plate').rate);
  for(const [i,f] of frames.entries()){
    if(i)assert.ok(partTemperature(f,'beam').mean>partTemperature(frames[i-1],'beam').mean);
    near(partTemperature(f,'hot-pad').mean,160);near(f.mixed.clock.maxDrift,0);near(f.fem.parts[0].summary.maxDisplacement,0);
    near(f.mixed.energy.mechanical,0);assert.deepEqual(f.contactPairs[0].totalImpulse,[0,0,0]);
    // Temperatures alone evolve; positions and APIC velocities remain fixed.
    for(let n=0;n<f.particles.length;n+=8)for(let k=0;k<3;k++)near(f.particles[n+k],frames[0].particles[n+k],0);
  }
  const csv=thermalHistoryCSV(frames,'beam','pad-plate').split('\n').map(r=>r.split(','));assert.equal(csv.length,frames.length+1);assert.ok(csv.every(r=>r.length===csv[0].length));near(+csv.at(-1)[2],T.mean);near(+csv.at(-1)[4],q.rate);
  assert.equal(csv[0][8],'plastic_work_J');assert.ok(csv.slice(1).every(r=>r.slice(8).every(v=>v==='')));
});
test('fixed geometry refuses edits that would silently discard motion, phase or expansion',()=>{
  for(const edit of [p=>p.environment.gravity[1]=-9.81,p=>p.parts[1].initial.velocity[0]=1,p=>p.parts[0].material.expansion=1e-5,p=>p.parts[1].material.phaseChange.enabled=true,p=>p.contactPairs[0].mechanical=true,p=>p.loads=p.loads.filter(l=>l.id!=='fix-pad'),p=>p.solver.thermalMode='unknown',p=>p.loads.find(l=>l.type==='fem-force').force[1]=1]){
    const p=structuredClone(mixedThermalContactProject());edit(p);assert.throws(()=>validateMixed(p));
  }
});
test('separated hot pad transfers no heat; reversing the temperature gradient cools the plate',()=>{
  const gap=mixedThermalContactProject();gap.parts[1].geometry.center[1]+=.05;const a=run(gap,1).at(-1);near(partTemperature(a,'beam').mean,20);near(a.thermal.externalHeat,0);near(interfaceHeat(a,'pad-plate').heat,0);
  const cold=mixedThermalContactProject();cold.parts[1].initial.temperature=20;cold.loads.find(l=>l.id==='pad-thermostat').temperature=20;cold.parts[0].initial.temperature=80;
  const b=run(cold,2).at(-1);assert.ok(partTemperature(b,'beam').mean<80);assert.ok(interfaceHeat(b,'pad-plate').heat<0);assert.ok(b.thermal.externalHeat<0);near(b.thermal.residual,0,1e-6);
});
test('finite hot pad cools when the thermostat is disabled and total energy is conserved',()=>{
  const p=mixedThermalContactProject();p.loads.find(l=>l.id==='pad-thermostat').enabled=false;
  const f=run(p,2).at(-1);assert.ok(partTemperature(f,'hot-pad').mean<160);assert.ok(partTemperature(f,'beam').mean>20);near(f.thermal.externalHeat,0);near(f.thermal.residual,0,1e-6);
});
test('thermal time refinement converges without changing mass or heat capacity',()=>{
  const results=[.02,.005,.0025].map(dt=>{const p=mixedThermalContactProject();p.solver.dt=dt;return run(p,5).at(-1);});
  const exact=partTemperature(results[2],'beam'),coarse=partTemperature(results[0],'beam'),fine=partTemperature(results[1],'beam');
  assert.ok(Math.abs(fine.max-exact.max)<Math.abs(coarse.max-exact.max));assert.ok(Math.abs(coarse.mean-exact.mean)<.002);assert.ok(Math.abs(coarse.max-exact.max)<.05);
});
test('failed fixed-geometry interval rolls back temperatures, thermostat and shared clock',()=>{
  const s=new MixedSimulation(mixedThermalContactProject());try{const b=s.backup(),original=s.contacts.exchange;s.contacts.exchange=function(dt){original.call(this,dt);throw Error('injected thermal failure');};
    assert.throws(()=>s.step(.1),/injected/);assert.deepEqual(s.backup(),b);s.contacts.exchange=original;assert.ok(s.step(.1).thermal.externalHeat>0);
  }finally{s.free();}
});
