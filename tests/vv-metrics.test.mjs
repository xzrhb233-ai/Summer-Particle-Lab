import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRefinement,parseExperimentCSV,compareExperiment,sampleInputs,summarizeEnsemble,VV_METHOD_REFERENCES} from '../src/simulation/vv-metrics.js';

// All data in this file are analytic/synthetic module checks. They are not
// experimental evidence, benchmark runs, or solver-validation results.
const near=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const powerLaw=(p=2,limit=3)=>[1,.5,.25,.125].map(h=>({h,value:limit+2*h**p}));
const meta={quantity:'displacement',unit:'m'};
const series=(points,extra={})=>({kind:'simulation',...meta,timeUnit:'s',points,...extra});
const experiment=(points,extra={})=>({kind:'experiment',...meta,timeUnit:'s',points,...extra});
const indeterminate=(rows,reason,options)=>{const r=analyzeRefinement(rows,options);assert.equal(r.status,'indeterminate');assert.equal(r.reason,reason);assert.equal(r.observedOrder,null);assert.equal(r.richardson,null);assert.equal(r.gci,null);return r;};

test('analytic power-law refinement recovers order and Richardson limit from four actual resolutions',()=>{
  const rows=powerLaw().map((r,i)=>({...r,requestedH:.1**i})).reverse(),before=structuredClone(rows);
  const r=analyzeRefinement(rows,{expectedOrder:2});assert.equal(r.status,'estimated');
  assert.deepEqual(r.actualRatios,[2,2,2]);near(r.observedOrder,2);near(r.richardson,3);
  near(r.gci.absolute,.0390625);near(r.gci.relative,.0390625/3.03125);assert.equal(r.gci.isConfidenceInterval,false);
  assert.deepEqual(r.evidence.tripletOrders,[2,2]);assert.deepEqual(rows,before);assert.equal(r.rows[0].requestedH,1);
  assert.match(r.limitations.join(' '),/not proof|not establish/);assert.match(VV_METHOD_REFERENCES.refinement,/nasa.gov/);
});

test('three levels do not independently establish asymptotic order, even with a specified expected order',()=>{
  indeterminate(powerLaw().slice(0,3),'insufficient-independent-asymptotic-evidence',{expectedOrder:2});
  indeterminate(powerLaw().slice(0,2),'at-least-three-levels-required');
  assert.equal(analyzeRefinement([]).status,'unavailable');
});

test('actual resolution is mandatory; requested refinement and unequal achieved ratios cannot produce GCI',()=>{
  indeterminate(powerLaw().map(({h,...r})=>({...r,requestedH:h})),'missing-or-invalid-actual-resolution');
  const irregular=[1,.6,.3,.15].map((h,i)=>({h,requestedH:2**-i,value:3+h*h}));
  indeterminate(irregular,'unequal-actual-refinement-ratios');
  const repeated=powerLaw();repeated[2].h=repeated[1].h;indeterminate(repeated,'actual-resolution-did-not-refine');
  const tiny=[1,1/1.01,1/1.01**2,1/1.01**3].map(h=>({h,value:3+h*h}));indeterminate(tiny,'actual-refinement-ratio-too-close-to-one');
  const changed=powerLaw().map(({h,value})=>({actualDt:h,requestedDt:h/10,amplitude:value}));
  assert.equal(analyzeRefinement(changed,{resolutionKey:'actualDt',requestedResolutionKey:'requestedDt',valueKey:'amplitude'}).status,'estimated');
});

test('zero, roundoff-sized, oscillatory, growing and unstable-order differences remain indeterminate',()=>{
  indeterminate(powerLaw().map(r=>({...r,value:2})),'zero-or-unresolved-differences');
  indeterminate(powerLaw().map((r,i)=>({...r,value:2+Number.EPSILON*i})),'zero-or-unresolved-differences');
  indeterminate(powerLaw().map((r,i)=>({...r,value:[4,1,2,1.5][i]})),'non-monotonic-refinement');
  indeterminate(powerLaw().map((r,i)=>({...r,value:[1,2,4,8][i]})),'differences-do-not-decrease');
  indeterminate(powerLaw().map((r,i)=>({...r,value:[10,2,0,-.1][i]})),'observed-orders-are-not-stable');
  indeterminate(powerLaw(),'observed-order-disagrees-with-expected-order',{expectedOrder:1});
});

test('zero fine response keeps absolute GCI but does not invent a relative denominator; failed runs remain invalid evidence',()=>{
  const rows=powerLaw(2,-.03125),r=analyzeRefinement(rows);assert.equal(r.status,'estimated');assert.equal(r.rows.at(-1).value,0);
  near(r.richardson,-.03125);assert.equal(r.gci.relative,null);assert.ok(r.gci.absolute>0);
  indeterminate(rows.map((r,i)=>i===1?{...r,status:'failed',reason:'solver did not converge'}:r),'failed-or-invalid-run');
  indeterminate(rows.map((r,i)=>i===1?{...r,value:NaN}:r),'missing-or-invalid-response');
  assert.throws(()=>analyzeRefinement(rows,{safetyFactor:.5}),/safety factor/);
  assert.throws(()=>analyzeRefinement(rows,{ratioTolerance:.2}),/tolerance/);
});

test('CSV parsing requires explicit quantity/unit and preserves numeric 1-sigma uncertainties and strictly ordered times',()=>{
  const parsed=parseExperimentCSV('\uFEFF"time", "value", "uncertainty"\r\n-1,1e-3,0\r\n0,"2.5",.2\r\n1,3,.3\r\n',meta);
  assert.equal(parsed.kind,'experiment');assert.equal(parsed.timeUnit,'s');assert.equal(parsed.uncertaintyKind,'standard');
  assert.deepEqual(parsed.points,[{time:-1,value:.001,uncertainty:0},{time:0,value:2.5,uncertainty:.2},{time:1,value:3,uncertainty:.3}]);
  assert.throws(()=>parseExperimentCSV('time,value\n0,1',{quantity:'displacement'}),/unit/);
  assert.throws(()=>parseExperimentCSV('time,value\n0,1',{unit:'m'}),/quantity/);
  assert.throws(()=>parseExperimentCSV('time,value\n0,1',{quantity:'displacement',unit:'mm'}),/unit/);
});

test('malformed, nonnumeric, duplicate-time, descending-time and negative-uncertainty CSV data are rejected',()=>{
  for(const csv of ['value,time\n1,0','time,value,extra\n0,1,2','time,value\n0,1\n0,2','time,value\n1,1\n0,2','time,value\n0,NaN','time,value\n0,Infinity','time,value\n0,0x10','time,value\n0,','time,value\n0,1\n\n2,3','time,value\n0,"1','time,value\n0,"1"x','time,value,uncertainty\n0,1,-.1','time,value,uncertainty\n0,1,'])assert.throws(()=>parseExperimentCSV(csv,meta),/CSV|strictly|uncertainty/);
  const empty=parseExperimentCSV('',meta),header=parseExperimentCSV('time,value\n',meta);
  assert.equal(empty.status,'unavailable');assert.deepEqual(empty.points,[]);assert.equal(header.status,'unavailable');
});

test('synthetic comparison recovers interpolation, RMSE, relative L2, signed bias and maximum error',()=>{
  const sim=series([{time:0,value:0},{time:2,value:4}]),exp=experiment([{time:0,value:1},{time:1,value:1},{time:2,value:5}]);
  const snapshot=structuredClone([sim,exp]),r=compareExperiment(sim,exp);
  assert.equal(r.status,'available');assert.equal(r.matchedCount,3);assert.deepEqual(r.samples.map(p=>p.simulation),[0,2,4]);
  near(r.metrics.rmse,1);near(r.metrics.relativeL2,1/3);near(r.metrics.bias,-1/3);near(r.metrics.maxAbsoluteError,1);
  assert.equal(r.coverage.status,'unavailable');assert.equal(r.coverage.fraction,null);assert.deepEqual([sim,exp],snapshot);
});

test('comparison never extrapolates, never fabricates missing data, and reports zero reference norm explicitly',()=>{
  const sim=series([{time:0,value:0},{time:2,value:2}]),exp=experiment([-1,0,1,3].map(time=>({time,value:0})));
  const r=compareExperiment(sim,exp);assert.equal(r.status,'partial');assert.equal(r.matchedCount,2);assert.equal(r.excludedCount,2);
  assert.deepEqual(r.samples.map(s=>s.time),[0,1]);assert.deepEqual(r.excluded.map(s=>s.time),[-1,3]);assert.equal(r.metrics.relativeL2,null);assert.equal(r.metrics.relativeL2Reason,'zero-experimental-norm');
  assert.equal(compareExperiment(null,exp).status,'unavailable');assert.equal(compareExperiment(sim,parseExperimentCSV('',meta)).status,'unavailable');
  assert.equal(compareExperiment(sim,experiment([{time:3,value:0}])).reason,'no-overlapping-time-support');
  const single=compareExperiment(series([{time:1,value:2}]),experiment([{time:0,value:0},{time:1,value:3},{time:2,value:4}]));
  assert.equal(single.matchedCount,1);near(single.metrics.rmse,1);
});

test('comparison enforces independently identified datasets, aligned quantities, units and standard-uncertainty declarations',()=>{
  const sim=series([{time:0,value:1}]),exp=experiment([{time:0,value:1}]);
  assert.throws(()=>compareExperiment(sim,sim),/independent/);
  assert.throws(()=>compareExperiment({...sim,sourceId:'same'},{...exp,sourceId:'same'}),/independent/);
  assert.throws(()=>compareExperiment(sim,{...exp,kind:'simulation'}),/identified/);
  assert.throws(()=>compareExperiment(sim,{...exp,quantity:'stress'}),/quantity/);
  assert.throws(()=>compareExperiment(sim,{...exp,unit:'Pa'}),/unit/);
  assert.throws(()=>compareExperiment({...sim,timeUnit:'ms'},exp),/Time unit/);
  assert.throws(()=>compareExperiment(series([{time:0,value:1,uncertainty:1}]),exp),/standard/);
  assert.throws(()=>compareExperiment(series([{time:1,value:1},{time:0,value:0}]),exp),/strictly/);
  assert.throws(()=>compareExperiment(series([{time:-1e308,value:1},{time:1e308,value:0}]),exp),/representable/);
});

test('relative norms handle scale overflow explicitly and do not assign ratio meaning to Celsius values',()=>{
  const sim=series([{time:0,value:1e308}]),exp=experiment([{time:0,value:1e-308}]);
  const overflow=compareExperiment(sim,exp);assert.equal(overflow.metrics.relativeL2,null);assert.equal(overflow.metrics.relativeL2Reason,'relative-norm-overflow');assert.ok(Number.isFinite(overflow.metrics.rmse));
  const celsius=compareExperiment({...series([{time:0,value:22}]),quantity:'temperature',unit:'degC'},{...experiment([{time:0,value:20}]),quantity:'temperature',unit:'degC'});
  near(celsius.metrics.rmse,2);assert.equal(celsius.metrics.relativeL2,null);assert.match(celsius.metrics.relativeL2Reason,/affine/);
});

test('coverage needs both uncertainties and states RSS plus conservative temporal interpolation assumptions',()=>{
  const sim=series([{time:0,value:1,uncertainty:3},{time:2,value:3,uncertainty:5}],{uncertaintyKind:'standard'});
  const exp=experiment([{time:0,value:7,uncertainty:4},{time:1,value:8,uncertainty:4},{time:2,value:3,uncertainty:0}],{uncertaintyKind:'standard'});
  const r=compareExperiment(sim,exp);near(r.samples[0].combinedUncertainty,5);near(r.samples[1].simulationUncertainty,4);near(r.samples[1].combinedUncertainty,Math.sqrt(32));
  assert.equal(r.coverage.count,3);assert.equal(r.coverage.coveredCount,1);near(r.coverage.fraction,1/3);assert.equal(compareExperiment(sim,exp,{coverageFactor:2}).coverage.fraction,1);
  assert.match(r.assumptions.join(' '),/independent/);assert.match(r.assumptions.join(' '),/perfect positive correlation/);assert.match(r.assumptions.join(' '),/no Gaussian model/);
  const missing=structuredClone(sim);delete missing.points[1].uncertainty;const partial=compareExperiment(missing,exp);
  assert.equal(partial.coverage.status,'partial');assert.equal(partial.coverage.count,1);assert.equal(partial.samples[1].combinedUncertainty,null);
});

test('sampling has a repeatable seed, a stable prefix, bounded uniform draws and no fabricated solver outputs',()=>{
  const spec=[{key:'young',unit:'Pa',distribution:'uniform',min:10,max:20}],snapshot=structuredClone(spec);
  const sampled=sampleInputs(spec,{seed:12345,count:4});assert.deepEqual(sampled,sampleInputs(spec,{seed:12345,count:4}));assert.deepEqual(spec,snapshot);
  assert.deepEqual(sampled.samples.map(r=>r.inputs.young),[19.797282677609473,13.067522644996643,14.84205421525985,18.17934412509203]);
  assert.deepEqual(sampled.samples.slice(0,2),sampleInputs(spec,{seed:12345,count:2}).samples);
  assert.notDeepEqual(sampled.samples,sampleInputs(spec,{seed:12346,count:4}).samples);
  assert.ok(sampled.samples.every(r=>r.inputs.young>=10&&r.inputs.young<=20&&!Object.hasOwn(r,'value')));
});

test('normal draws retain the specified scale and unbounded distribution; invalid specifications cannot be sampled',()=>{
  const rows=sampleInputs([{key:'rho',unit:'kg/m^3',distribution:'normal',mean:100,standardDeviation:5}],{seed:61,count:1000}).samples;
  const summary=summarizeEnsemble(rows.map(r=>({...r,value:r.inputs.rho})),{quantity:'density',unit:'kg/m^3'});
  near(summary.mean,100,.5);near(summary.standardDeviation,5,.5);
  const negative=sampleInputs([{key:'x',unit:'1',distribution:'normal',mean:0,standardDeviation:1}],{seed:1,count:100});assert.ok(negative.samples.some(r=>r.inputs.x<0));
  const spec=[{key:'x',unit:'1',distribution:'uniform',min:0,max:1}];
  for(const options of [{seed:-1},{seed:1.2},{seed:4294967296},{count:0},{count:10001}])assert.throws(()=>sampleInputs(spec,options));
  for(const invalid of [[...spec,...spec],[{...spec[0],key:'__proto__'}],[{...spec[0],min:2}],[{...spec[0],distribution:'script'}],[{...spec[0],unit:undefined}],[{...spec[0],script:'run()'}],[{key:'x',unit:'1',distribution:'normal',mean:0,standardDeviation:-1}]])assert.throws(()=>sampleInputs(invalid));
});

test('ensemble summary reports empirical quantiles and sampled associations without calling them confidence intervals',()=>{
  const rows=[1,3,5,7].map((value,i)=>({sampleId:'s'+i,status:'passed',value,inputs:{ascending:i+1,descending:4-i,constant:2,tied:i<2?1:2}})),before=structuredClone(rows);
  const r=summarizeEnsemble(rows,meta);assert.equal(r.status,'available');assert.equal(r.count,4);near(r.mean,4);near(r.standardDeviation,Math.sqrt(20/3));
  assert.deepEqual(r.quantiles.map(q=>q.probability),[.05,.5,.95]);[1.3,4,6.7].forEach((v,i)=>near(r.quantiles[i].value,v));
  const association=input=>r.sensitivity.find(s=>s.input===input);near(association('ascending').pearson,1);near(association('ascending').spearman,1);near(association('descending').spearman,-1);near(association('tied').spearman,Math.sqrt(.8));assert.equal(association('constant').pearson,null);
  assert.equal(r.intervalInterpretation,'empirical-output-quantiles-not-confidence-intervals');assert.match(r.limitations.join(' '),/not causal/);assert.deepEqual(rows,before);
});

test('failed or invalid ensemble runs stay visible and do not silently make a conditional subset a successful full ensemble',()=>{
  const r=summarizeEnsemble([{sampleId:'a',value:1,inputs:{x:1}},{sampleId:'b',value:3,inputs:{x:2}},{sampleId:'c',value:100,status:'failed',reason:'unstable',inputs:{x:3}},{sampleId:'d',value:Infinity}],meta);
  assert.equal(r.status,'partial');assert.equal(r.totalCount,4);assert.equal(r.count,2);assert.equal(r.failedCount,2);near(r.mean,2);assert.equal(r.failedSamples[0].reason,'unstable');assert.equal(r.sensitivity[0].pearson,null);
  assert.match(r.limitations.join(' '),/conditional on successful runs/);
  const none=summarizeEnsemble([{status:'failed',reason:'failure'}],meta);assert.equal(none.status,'unavailable');assert.equal(none.mean,null);assert.deepEqual(none.quantiles,[]);
  assert.equal(summarizeEnsemble([],meta).reason,'no-data');
  const one=summarizeEnsemble([{value:2}],meta);assert.equal(one.standardDeviation,null);assert.ok(one.quantiles.every(q=>q.value===2));
  const duplicate=summarizeEnsemble([{sampleId:'same',value:2},{sampleId:'same',value:100}],meta);assert.equal(duplicate.status,'partial');assert.equal(duplicate.count,1);assert.equal(duplicate.failedSamples[0].reason,'invalid-or-duplicate-sample-id');
  const emptyReason=summarizeEnsemble([{status:'failed',reason:'',value:2}],meta);assert.equal(emptyReason.count,0);assert.equal(emptyReason.failedSamples[0].reason,'solver-run-failed');
});
