import test from 'node:test';
import assert from 'node:assert/strict';
import {runVVBenchmarks,runVVProjectStudy,VV_CASE_IDS} from '../src/simulation/vv-benchmarks.js';
import {handleVVWorkerMessage} from '../src/simulation/vv-worker.js';
import {dynamicCantileverProject,cantileverProject} from '../src/fem/model.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {boxMesh} from '../src/fem/mesh.js';
import {configurationId} from '../src/simulation/workspace-context.js';

const suite=runVVBenchmarks();
function smallProject(){
  const p=dynamicCantileverProject({size:[1,.2,.3],divisions:[4,1,1],force:[0,-.1,0],damping:0});
  p.curves=[];p.loadBindings=[];Object.assign(p.solver,{dt:.0001,initialState:'rest',thermal:false});return p;
}
test('real CPU benchmark suite retains the unresolved spatial evidence',async()=>{
  const r=await suite;assert.deepEqual(r.cases.map(c=>c.id),VV_CASE_IDS);assert.equal(r.status,'inconclusive');
  assert.equal(r.cases.find(c=>c.id==='beam-mesh').status,'inconclusive');
  assert.equal(r.cases.find(c=>c.id==='beam-mesh').refinement.gci,null);
  assert.ok(r.cases.every(c=>Array.isArray(c.checks)&&c.checks.every(k=>k.passed)));
  assert.ok(r.cases.every(c=>c.backend&&c.reference&&c.assumptions.length&&c.limitations.length));
  assert.ok(r.limits.actualSteps>0&&r.limits.actualSteps<=20000);
  assert.ok(JSON.stringify(r).length<100000);
});
test('affine displacement and stress use the analytic continuum solution',async()=>{
  const c=(await suite).cases.find(c=>c.id==='axial-patch');
  assert.equal(c.status,'passed');assert.equal(c.reference.stress,200);assert.equal(c.reference.tipDisplacement,1e-5);
  assert.ok(c.checks.find(k=>k.name.includes('stress')).value<1e-4);
  assert.ok(c.resolutions[0].elements>0&&c.resolutions[0].h>0);
});
test('modal refinement measures actual steps and independent eigenmode error',async()=>{
  const c=(await suite).cases.find(c=>c.id==='modal-time');
  assert.equal(c.status,'passed');assert.equal(c.refinement.status,'estimated');assert.ok(Math.abs(c.refinement.observedOrder-2)<.03);
  assert.ok(c.reference.eigenResidual<1e-5);
  for(const r of c.resolutions){assert.ok(r.steps>0&&r.uniform);assert.equal(r.h,r.maxDt);assert.equal(r.time,c.reference.duration);assert.ok(r.absoluteError<2e-6);}
  assert.ok(c.refinement.gci.absolute>0);
});
test('thermal benchmark checks nodal temperature and independently computed stored heat',async()=>{
  const c=(await suite).cases.find(c=>c.id==='thermal-energy');
  assert.equal(c.status,'passed');assert.equal(c.reference.heat,32);assert.ok(Math.abs(c.measurements.storedHeat-32)<1e-6);
  assert.ok(Math.abs(c.measurements.temperature-c.reference.temperature)<1e-9);
  assert.ok(c.limitations.some(x=>x.includes('does not establish diffusion')));
});
test('ensemble samples are real repeated solves and obey self-weight E/rho scaling',async()=>{
  const c=(await suite).cases.find(c=>c.id==='material-ensemble'),first=c.samples[0];
  assert.equal(c.summary.count,8);assert.equal(new Set(c.samples.map(r=>r.configurationId)).size,8);assert.ok(c.summary.standardDeviation>0);
  for(const r of c.samples){const scaled=r.value/first.value,expected=(r.inputs.density/first.inputs.density)*(first.inputs.young/r.inputs.young);assert.ok(Math.abs(scaled-expected)<1e-7);assert.ok(r.residual<1.05e-8);}
  assert.equal(c.summary.intervalInterpretation,'empirical-output-quantiles-not-confidence-intervals');
});
test('declared zero-width material inputs produce zero empirical variability',async()=>{
  const r=await runVVBenchmarks({cases:['material-ensemble'],ensembleCount:4,seed:0,materialUncertainty:{youngRelativeHalfWidth:0,densityRelativeHalfWidth:0}}),c=r.cases[0];
  assert.equal(c.status,'passed');assert.equal(c.summary.standardDeviation,0);assert.ok(c.samples.every(s=>s.inputs.young===2e7&&s.inputs.density===1000));
  assert.ok(c.summary.sensitivity.every(s=>s.pearson===null));
});
test('unsupported backends and unknown cases remain explicit',async()=>{
  const gpu=await runVVBenchmarks({backend:'gpu',cases:['axial-patch','missing']});assert.equal(gpu.status,'unsupported');assert.equal(gpu.cases.length,2);assert.ok(gpu.cases.every(c=>c.status==='unsupported'));
  const unknown=await runVVBenchmarks({cases:['missing']});assert.equal(unknown.cases[0].status,'unsupported');
});
test('invalid plans reject unsupported fields and unbounded work',async()=>{
  await assert.rejects(runVVBenchmarks({script:'arbitrary'}),/unsupported fields/);
  await assert.rejects(runVVBenchmarks({ensembleCount:100}),/4–16/);
  await assert.rejects(runVVBenchmarks({materialUncertainty:{youngRelativeHalfWidth:.6}}),/half-widths/);
  await assert.rejects(runVVBenchmarks({seed:-1}),/unsigned/);
  await assert.rejects(runVVProjectStudy(smallProject(),{duration:1}),/0.1/);
});
test('aborted and budget-limited cases do not report passes or omit pending cases',async()=>{
  const abort=new AbortController();abort.abort();const r=await runVVBenchmarks({cases:['axial-patch','thermal-energy']},{signal:abort.signal});assert.equal(r.status,'cancelled');assert.ok(r.cases.every(c=>c.status==='cancelled'));
  const limited=await runVVBenchmarks({cases:['thermal-energy','modal-time']},{maxSteps:2});assert.equal(limited.status,'limited');assert.equal(limited.cases.length,2);assert.ok(limited.cases.every(c=>c.status==='limited'));assert.equal(limited.limits.actualSteps,2);
});
test('project refinement preserves exact input configuration and samples the same end time',async()=>{
  const p=smallProject(),before=JSON.stringify(p),progress=[],r=await runVVProjectStudy(p,{duration:.004,field:'tipY',partId:'beam'},{onProgress:x=>progress.push(x)}),c=r.studies[0];
  assert.equal(JSON.stringify(p),before);assert.equal(r.baseConfigurationId,configurationId(p));assert.equal(c.resolutions.length,4);assert.ok(progress.length>=4);
  assert.deepEqual(c.resolutions.map(x=>x.requestedDt),[.0001,.00005,.000025,.0000125]);
  assert.ok(c.resolutions.every(x=>Math.abs(x.time-.004)<1e-12&&Number.isFinite(x.value)&&x.steps>0&&x.uniform));
  const finest=structuredClone(p);finest.solver.dt=.0000125;const sim=new FEMDynamicSimulation(finest);try{const expected=sim.step(.004).fem.parts[0].summary.tip[1];assert.ok(Math.abs(c.resolutions[3].value-expected)<1e-12);}finally{sim.free();}
  assert.equal(c.reference.kind,'self-convergence');assert.equal(c.reference.value,null);
});
test('CFL-limited identical actual steps are not treated as requested refinement',async()=>{
  const p=smallProject();p.solver.dt=.02;const r=await runVVProjectStudy(p,{duration:.004}),c=r.studies[0];
  assert.equal(c.status,'inconclusive');assert.match(c.refinement.reason,/identical/);assert.equal(c.refinement.gci,null);assert.equal(c.refinement.observedOrder,null);
  assert.equal(new Set(c.resolutions.map(x=>x.maxDt)).size,1);assert.equal(new Set(c.resolutions.map(x=>x.requestedDt)).size,4);
});
test('project study rejects unsupported adapter, disabled temperature, and missing tip honestly',async()=>{
  assert.equal((await runVVProjectStudy(cantileverProject(),{})).status,'unsupported');
  const p=smallProject();assert.equal((await runVVProjectStudy(p,{field:'temperature'})).status,'unsupported');
  p.loads=p.loads.filter(l=>l.type==='fem-fixed');const r=await runVVProjectStudy(p,{duration:.001,field:'tipY'});assert.equal(r.status,'unsupported');assert.equal(r.studies[0].failures.length,4);assert.equal(r.studies[0].resolutions.length,0);
});
test('project studies report each bounded failure and cannot reuse requested dt as evidence',async()=>{
  const p=smallProject(),r=await runVVProjectStudy(p,{duration:.004},{maxSteps:1});assert.equal(r.status,'limited');assert.equal(r.studies[0].failures.length,4);assert.equal(r.studies[0].refinement.gci,null);assert.equal(r.limits.actualSteps,1);
  p.solver.dt=1e-7;const below=await runVVProjectStudy(p,{duration:1e-6});assert.equal(below.status,'unsupported');assert.equal(below.studies[0].failures.length,3);
});
test('nonuniform event steps prevent a single-dt extrapolation claim',async()=>{
  const p=smallProject();p.curves=[{id:'switch',type:'step',points:[[0,1],[.00123,0]]}];p.loadBindings=[{id:'switch-force',kind:'fem-force',target:'beam',load:'beam-traction',component:1,curve:'switch',scale:-.1,offset:0,enabled:true}];
  const r=await runVVProjectStudy(p,{duration:.004,field:'tipY'}),c=r.studies[0];
  assert.equal(c.resolutions.length,4);assert.ok(c.resolutions.some(x=>!x.uniform&&x.eventSplits>0));assert.equal(c.refinement.gci,null);assert.match(c.refinement.reason,/Nonuniform/);
});
test('project thermal refinement preserves the supplied named face heat load',async()=>{
  const p=smallProject();p.solver.thermal=true;p.selectionSets.forEach(s=>{s.region={type:'surface',surface:'box:'+s.region.face};});p.loads.push({id:'heat',type:'thermal-power',target:'beam',selection:'beam-load',power:500});
  const before=JSON.stringify(p),r=await runVVProjectStudy(p,{duration:.004,field:'temperature'});
  assert.equal(JSON.stringify(p),before);assert.equal(r.studies[0].resolutions.length,4);assert.ok(r.studies[0].resolutions.every(x=>x.value>20));assert.equal(r.studies[0].refinement.gci,null);
});
test('CPU explicit CAD Tet4 project studies keep their existing mesh',async()=>{
  const p=smallProject(),part=p.parts[0],g=part.geometry,mesh=boxMesh(part),lower=g.center.map((v,k)=>v-g.size[k]/2),upper=g.center.map((v,k)=>v+g.size[k]/2),recipe=[{shape:'box',operation:'base',center:g.center.slice(),size:g.size.slice(),rotation:[0,0,0]}];
  part.geometry={...g,shape:'cad',cad:{schema:'summer-cad/1',kernel:'SMLib',version:'explicit-test-fixture',recipe,lower,upper,closed:true,volume:g.size.reduce((a,b)=>a*b,1),vertices:mesh.nodes,indices:mesh.surface.flatMap(t=>t.nodes)}};
  part.discretization={element:'tet4',mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes:mesh.nodes,elements:mesh.cells.map(c=>c.ids),source:{recipe:structuredClone(recipe),lower:lower.slice(),upper:upper.slice()}}};
  const before=JSON.stringify(p),r=await runVVProjectStudy(p,{duration:.004,field:'maxDisplacement'});
  assert.equal(JSON.stringify(p),before);assert.equal(r.studies[0].resolutions.length,4);assert.ok(r.studies[0].resolutions.every(x=>x.value>0));assert.equal(r.baseConfigurationId,configurationId(p));
});
test('worker protocol emits bounded progress/results and reports invalid requests',async()=>{
  const messages=[];await handleVVWorkerMessage({type:'run',id:'test',plan:{cases:['axial-patch']}},x=>messages.push(x));
  assert.ok(messages.some(x=>x.type==='progress'));assert.equal(messages.at(-1).type,'result');assert.equal(messages.at(-1).id,'test');assert.equal(messages.at(-1).report.status,'passed');
  await handleVVWorkerMessage({type:'execute',id:'bad'},x=>messages.push(x));assert.equal(messages.at(-1).type,'error');
});
