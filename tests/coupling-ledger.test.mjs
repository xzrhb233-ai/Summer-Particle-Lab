import test from 'node:test';
import assert from 'node:assert/strict';
import {CouplingStepper,exchangeImpulse,exchangeHeat,ExchangeBook} from '../src/simulation/coupling-interface.js';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {mixedImpactProject} from '../src/mixed/model.js';
import {mixedEnergyCSV} from '../src/mixed/energy.js';
import {FEMHistory} from '../src/fem/dynamic.js';
await initialize();
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const withSim=(p,fn)=>{const s=new MixedSimulation(p);try{return fn(s);}finally{s.free();}};

test('shared tick hits events and output endpoints, and advances each domain exactly once',()=>{
  const traces=[[],[]],ports=traces.map((trace,i)=>({id:String(i),time:()=>trace.at(-1)?.end??0,steps:()=>trace.length,stableDt:()=>.001,
    schedule:()=>({nextEvent:(trace.at(-1)?.end??0)<.00135-1e-12?.00135:Infinity}),advance:t=>trace.push(t)}));
  const clock=new CouplingStepper(.001,ports);while(ports[0].time()<.0032-1e-12)clock.advance(clock.next(.0032));
  assert.deepEqual(traces[0],traces[1]);assert.ok(traces[0].some(t=>t.end===.00135));near(ports[0].time(),.0032);near(clock.snapshot().maxDrift,0);
  assert.equal(clock.snapshot().eventCuts,1);assert.equal(clock.snapshot().requestCuts,1);
});
test('shared contract rejects a hidden mechanical subcycle',()=>{
  let time=0,steps=0;const clock=new CouplingStepper(.001,[{id:'bad',time:()=>time,steps:()=>steps,stableDt:()=>.001,schedule:()=>({}),advance:t=>{time=t.end;steps+=2;}}]);
  assert.throws(()=>clock.advance(clock.next(.001)),/共享子步/);
});
test('domain-independent impulse ports return actual work, support impulse and dissipative balance',()=>{
  const port=(mass,v,fixed=false)=>({applyImpulse(J){let work=0;for(let k=0;k<3;k++)if(!fixed){work+=J[k]*v[k]+J[k]**2/(2*mass);v[k]+=J[k]/mass;}return {work,impulse:J.map(x=>fixed?0:x),support:J.map(x=>fixed?x:0)};}});
  const r=exchangeImpulse(port(2,[1,0,0]),port(3,[0,0,0]),[-1.2,0,0]);near(r.workA+r.workB,-.6);r.impulseResidual.forEach(x=>near(x,0));
  const b=new ExchangeBook();b.impulse('__proto__',r,'normal',.6);near(b.snapshot().pairs[0].workResidual,0);
  const fixed=exchangeImpulse(port(2,[1,0,0]),port(3,[0,0,0],true),[-2,0,0]);assert.deepEqual(fixed.support,[2,0,0]);near(fixed.workA+fixed.workB,-1);
});
test('domain-independent heat graph conserves unequal capacities with monotone subcycling',()=>{
  const port=(C,T)=>({capacity:()=>C,temperature:()=>T,receive:q=>{const before=C*T;T+=q/C;return C*T-before;}});
  const a=port(1,100),b=port(10,0),c=port(2,20),receipt=exchangeHeat([{a,b,g:100,pair:'ab'},{a,b:c,g:200,pair:'ac'}],1);
  near(a.temperature()+10*b.temperature()+2*c.temperature(),140,1e-9);assert.ok(receipt.substeps>1);
  for(const p of [a,b,c])assert.ok(p.temperature()>=0&&p.temperature()<=100);
  for(const p of receipt.results.values())near(p.heatA+p.heatB,0);near(receipt.residual,0,1e-9);
  assert.throws(()=>exchangeHeat([{a,b,g:NaN,pair:'bad'}],1));
});
test('actual MPM and FEM use the shared steps, including off-grid output intervals',()=>withSim(mixedImpactProject(),s=>{
  for(const h of [.00035,.00072,.001]){const f=s.step(h),c=f.mixed.clock;near(c.maxDrift,0);assert.equal(s.mpm.steps,s.fem.steps);assert.equal(c.steps,s.steps);assert.equal(c.steps,s.mpm.steps);near(s.time,s.mpm.time);}
}));
test('free translation has no invented physical loss or hidden energy source',()=>{
  const p=mixedImpactProject();p.contactPairs=[];p.solver.damping=0;
  withSim(p,s=>{const e=s.step(.005).mixed.energy;assert.ok(e.complete);near(e.physical.total,0);near(e.unexplainedResidual,0,1e-8);near(e.rawResidual,0,1e-8);});
});
test('energy observer does not change MPM positions, velocities, F or C',()=>{
  const p=mixedImpactProject();p.contactPairs=[];const a=new MixedSimulation(p),b=new MixedSimulation(p);
  try{
    for(const sim of [a,b]){const s=sim.mpm.particles;for(let i=0;i<s.count;i++){s.vx[i]=i%2?3:-3;s.mpm.C[i*9]=i%3;}}
    b.mpm.particles.energyObserver=null;a.step(.003);b.step(.003);
    for(const k of ['x','y','z','vx','vy','vz'])assert.deepEqual(a.mpm.particles[k],b.mpm.particles[k]);
    for(const k of ['F','C'])assert.deepEqual(a.mpm.particles.mpm[k],b.mpm.particles.mpm[k]);
    assert.ok(a.energy.observer.values.p2g<-.001);assert.ok(a.energy.observer.values.g2p<=1e-9);
  }finally{a.free();b.free();}
});
test('position cleanup reports FEM elastic work and MPM gravity potential work',()=>withSim(mixedImpactProject(),s=>{
  const p=s.mpm.particles;s.contacts.gravity=[0,-9.81,0];const f=s.fem.states[0];
  // Impose a shallow overlap without advancing gravity or mechanics.
  const gap=Math.min(...p.y.subarray(0,p.count))*.025-(f.part.geometry.center[1]+f.part.geometry.size[1]/2)-.025;
  for(let i=0;i<p.count;i++)p.y[i]-=(gap+.00001)/.025;
  let before=0;for(let i=0;i<p.count;i++)before+=9.81*p.mass[i]*p.y[i]*.025;
  s.contacts.begin(.001);s.contacts.mechanical();let after=0;for(let i=0;i<p.count;i++)after+=9.81*p.mass[i]*p.y[i]*.025;
  const r=s.contacts.results()[0];near(after-before,r.particleCorrectionWork,1e-10);assert.ok(r.particleCorrectionWork>0);assert.ok(r.correctionWork>0);assert.ok(f.contactWork!==0);
}));
test('unsupported plastic energy never becomes a zero residual in UI/results/CSV',()=>{
  const p=mixedImpactProject();p.parts[1].material.model=4;
  withSim(p,s=>{const f=s.step(.001),e=f.mixed.energy;assert.equal(e.complete,false);assert.equal(e.unexplainedResidual,null);assert.equal(f.results.balance.energyResidual,null);
    assert.ok(e.reasons.length);const csv=mixedEnergyCSV([f]),[header,row]=csv.split('\n').map(x=>x.split(','));assert.equal(row[header.indexOf('unexplained_residual_J')],'');});
});
test('ledger, exchange receipts and shared clock roll back together and remain replayable',()=>withSim(mixedImpactProject(),s=>{
  const before=s.backup(),old=s.contacts.exchange;s.contacts.exchange=function(dt){old.call(this,dt);throw Error('fail');};
  assert.throws(()=>s.step(.001),/fail/);assert.deepEqual(s.backup(),before);s.contacts.exchange=old;
  const f=s.step(.002),h=new FEMHistory();h.record(f,true);assert.deepEqual(h.samples[0].mixed,f.mixed);
  const csv=mixedEnergyCSV(h.samples).split('\n').map(x=>x.split(','));assert.equal(csv[0].length,csv[1].length);assert.equal(JSON.parse(JSON.stringify(f.mixed)).clock.maxDrift,0);
}));
test('prescribed initial FEM temperature does not double count thermal strain work',()=>{
  const p=mixedImpactProject();p.parts[0].material.expansion=1e-4;p.loads.push({id:'warm',type:'thermal-temperature',target:'beam',temperature:30,region:{type:'whole'},enabled:true});
  withSim(p,s=>near(s.snapshot().mixed.energy.rawResidual,0,1e-9));
});

test('real FEM pulse event splits both domains identically and preserves applied impulse',()=>{
  const p=mixedImpactProject();p.contactPairs=[];p.curves=[{id:'pulse',name:'pulse',type:'step',points:[[0,0],[.000371,1],[.000493,0],[1,0]]}];
  p.loadBindings=[{id:'pulse-force',name:'pulse',kind:'fem-force',target:'beam',load:'beam-traction',component:1,curve:'pulse',scale:-30,offset:0,enabled:true}];
  withSim(p,s=>{const f=s.step(.001);assert.equal(f.mixed.clock.eventCuts,2);assert.equal(s.mpm.steps,s.fem.steps);near(f.loadResponses[0].commandIntegral,-30*(.000493-.000371),1e-12);});
});
