// Pure numerical assessment utilities. An estimate or comparison is evidence
// about these supplied data, never certification or proof of physical truth.
export const VV_METHOD_REFERENCES=Object.freeze({
  refinement:'https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html',
  uncertainty:'https://www.itl.nist.gov/div898/handbook/mpc/section5/mpc52.htm',
  confidenceIntervals:'https://www.itl.nist.gov/div898/handbook/prc/section1/prc14.htm',
});
export const VV_UNITS=Object.freeze(['1','s','m','m/s','m/s^2','m^2','m^3','kg','kg/m^3','N','N*m','Pa','J','W','K','degC','Hz','W/(m*K)','J/(kg*K)','1/K']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const successful=status=>status===undefined||['passed','success','completed','ok'].includes(status);
const LIMIT=100000;
const assurance='These metrics do not establish physical correctness, experimental validation, or certification.';
function metadata({quantity,unit}={}){
  if(typeof quantity!=='string'||!quantity.trim()||quantity.length>80)throw Error('An explicit quantity name is required');
  if(!VV_UNITS.includes(unit))throw Error('An explicit supported SI unit is required; no unit conversion is inferred');
  return {quantity:quantity.trim(),unit};
}
function bounded(x,min,max,label){if(!finite(x)||x<min||x>max)throw Error(label+' is out of range');return x;}
function records(rows,label){if(!Array.isArray(rows)||rows.length>LIMIT)throw Error(label+' must be an array of at most '+LIMIT+' records');}
const maxAbs=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
function average(values){
  const scale=maxAbs(values);if(!scale)return 0;
  let sum=0,correction=0;for(const value of values){const y=value/scale-correction,t=sum+y;correction=(t-sum)-y;sum=t;}
  return sum/values.length*scale;
}
function rms(values){const scale=maxAbs(values);return scale?Math.sqrt(values.reduce((s,v)=>s+(v/scale)**2,0)/values.length)*scale:0;}

/** Rows contain measured actual h (or actual dt), not requested controls.
 * Four levels provide two independent triplet-order estimates. The usual
 * three-grid GCI-ratio identity is not used as independent asymptotic evidence.
 */
export function analyzeRefinement(input,{resolutionKey='h',valueKey='value',requestedResolutionKey='requestedH',ratioTolerance=1e-6,orderTolerance=.2,expectedOrder=null,safetyFactor=1.25,relativeZeroTolerance=64*Number.EPSILON,absoluteZeroTolerance=0}={}){
  records(input,'Refinement rows');
  bounded(ratioTolerance,0,.05,'Equal-ratio tolerance');bounded(orderTolerance,0,.5,'Order stability tolerance');
  bounded(safetyFactor,1,10,'GCI safety factor');bounded(relativeZeroTolerance,0,.01,'Relative zero tolerance');bounded(absoluteZeroTolerance,0,Number.MAX_VALUE,'Absolute zero tolerance');
  if(expectedOrder!==null)bounded(expectedOrder,Number.EPSILON,100,'Expected order');
  const result={schema:'summer-refinement/1',status:'indeterminate',reason:null,resolutionKey,valueKey,requestedResolutionKey,
    rows:input.map((r,index)=>plain(r)?{...r,index}:{index,invalid:true}),actualRatios:[],successiveDifferences:[],observedOrder:null,richardson:null,gci:null,
    evidence:{equalActualRatios:false,monotonic:false,decreasingDifferences:false,stableOrders:false,tripletOrders:[],expectedOrder},
    limitations:['A stable refinement trend is evidence conditional on systematic refinement and comparable solver settings, not proof of the asymptotic limit.',
      'Requested resolution is recorded separately and is never substituted for actual resolution.',
      'GCI is a discretization-error estimate with a safety factor, not a statistical confidence interval.',assurance]};
  const stop=(reason,status='indeterminate')=>({...result,status,reason});
  if(!input.length)return stop('no-data','unavailable');
  if(input.some(r=>!plain(r)||!successful(r.status)))return stop('failed-or-invalid-run');
  if(input.some(r=>!finite(r[resolutionKey])||r[resolutionKey]<=0))return stop('missing-or-invalid-actual-resolution');
  if(input.some(r=>!finite(r[valueKey])))return stop('missing-or-invalid-response');
  result.rows.sort((a,b)=>b[resolutionKey]-a[resolutionKey]);
  if(input.length<3)return stop('at-least-three-levels-required');
  const h=result.rows.map(r=>r[resolutionKey]),values=result.rows.map(r=>r[valueKey]);
  result.actualRatios=h.slice(0,-1).map((v,i)=>v/h[i+1]);
  if(result.actualRatios.some(r=>!finite(r)||r<=1))return stop('actual-resolution-did-not-refine');
  const ratio=Math.exp(average(result.actualRatios.map(Math.log)));
  result.evidence.refinementRatio=ratio;
  if(result.actualRatios.some(r=>Math.abs(r/ratio-1)>ratioTolerance))return stop('unequal-actual-refinement-ratios');
  result.evidence.equalActualRatios=true;
  if(ratio<1.1)return stop('actual-refinement-ratio-too-close-to-one');
  const delta=values.slice(1).map((v,i)=>v-values[i]);result.successiveDifferences=delta;
  if(delta.some(d=>!finite(d)))return stop('response-difference-overflow');
  const zeroTolerance=Math.max(absoluteZeroTolerance,maxAbs(values)*relativeZeroTolerance);
  result.evidence.zeroTolerance=zeroTolerance;
  if(delta.some(d=>Math.abs(d)<=zeroTolerance))return stop('zero-or-unresolved-differences');
  if(delta.some(d=>Math.sign(d)!==Math.sign(delta[0])))return stop('non-monotonic-refinement');
  result.evidence.monotonic=true;
  if(delta.slice(1).some((d,i)=>Math.abs(d)>=Math.abs(delta[i])))return stop('differences-do-not-decrease');
  result.evidence.decreasingDifferences=true;
  if(input.length<4)return stop('insufficient-independent-asymptotic-evidence');
  const orders=delta.slice(1).map((d,i)=>Math.log(Math.abs(delta[i]/d))/Math.log(ratio));
  if(orders.some(p=>!finite(p)||p<=0))return stop('invalid-observed-order');
  const p=orders.at(-1),spread=(Math.max(...orders)-Math.min(...orders))/average(orders);
  result.evidence.relativeOrderSpread=spread;
  if(spread>orderTolerance)return stop('observed-orders-are-not-stable');
  if(expectedOrder!==null&&orders.some(o=>Math.abs(o/expectedOrder-1)>orderTolerance))return stop('observed-order-disagrees-with-expected-order');
  result.evidence.stableOrders=true;result.evidence.tripletOrders=orders;
  const fine=values.at(-1),medium=values.at(-2),den=Math.expm1(p*Math.log(ratio)),correction=(fine-medium)/den;
  const richardson=fine+correction,absolute=safetyFactor*Math.abs(correction),relative=fine===0?null:absolute/Math.abs(fine);
  if(![den,correction,richardson,absolute].every(finite)||den<=0||relative!==null&&!finite(relative))return stop('extrapolation-overflow');
  return {...result,status:'estimated',reason:'monotonic-stable-order-evidence',observedOrder:p,richardson,
    gci:{absolute,relative,safetyFactor,relativeBasis:'absolute-fine-response',isConfidenceInterval:false}};
}

const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function csvFields(line){
  const fields=[];let field='',quoted=false,closed=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(quoted){if(c==='"'){if(line[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c===','){fields.push(field.trim());field='';closed=false;}
    else if(c==='"'){if(field.trim()||closed)throw Error('Malformed CSV quoting');field='';quoted=true;}
    else {if(closed&&!/\s/.test(c))throw Error('Malformed CSV quoting');field+=c;}
  }
  if(quoted)throw Error('Unterminated CSV field');fields.push(field.trim());return fields;
}
function numberField(text,line,label){if(!numeric.test(text)||!Number.isFinite(Number(text)))throw Error(`CSV row ${line}: ${label} must be a finite decimal number`);return Number(text);}

export function parseExperimentCSV(text,options={}){
  const meta=metadata(options),base={schema:'summer-experiment/1',kind:'experiment',...meta,timeUnit:'s',uncertaintyKind:null,provenance:'user-supplied-csv',points:[]};
  if(text===undefined||text===null||typeof text==='string'&&!text.trim())return {...base,status:'unavailable',reason:'no-data'};
  if(typeof text!=='string'||text.length>4*1024*1024)throw Error('Experiment CSV must be text of at most 4 MiB characters');
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r\n|\n|\r/),header=csvFields(lines.shift());
  if(![['time','value'],['time','value','uncertainty']].some(h=>h.length===header.length&&h.every((v,i)=>v===header[i])))throw Error('Experiment CSV header must be time,value or time,value,uncertainty');
  if(lines.length>LIMIT)throw Error('Too many experimental samples');
  const points=lines.map((line,i)=>{
    const row=i+2,cells=csvFields(line);if(cells.length!==header.length)throw Error(`CSV row ${row}: incorrect column count`);
    const result={time:numberField(cells[0],row,'time'),value:numberField(cells[1],row,'value')};
    if(header.length===3){result.uncertainty=numberField(cells[2],row,'uncertainty');if(result.uncertainty<0)throw Error(`CSV row ${row}: standard uncertainty must be nonnegative`);}
    return result;
  });
  validatePoints(points,'Experiment');
  return {...base,status:points.length?'available':'unavailable',...(points.length?{}:{reason:'no-data'}),uncertaintyKind:header.length===3?'standard':null,points};
}
function validatePoints(points,label){
  records(points,label);
  for(let i=0;i<points.length;i++){
    const p=points[i];if(!plain(p)||!finite(p.time)||!finite(p.value))throw Error(label+' requires finite time and value samples');
    if(i&&(p.time<=points[i-1].time||!finite(p.time-points[i-1].time)))throw Error(label+' times must be strictly increasing with representable intervals');
    if(p.uncertainty!==undefined&&(!finite(p.uncertainty)||p.uncertainty<0))throw Error(label+' standard uncertainties must be finite and nonnegative');
  }
}
function validateSeries(series,kind){
  if(!plain(series)||series.kind!==kind)throw Error('Simulation and experiment must be separate, explicitly identified datasets');
  const meta=metadata(series);if(series.timeUnit!=='s')throw Error('Time unit must explicitly be s');
  validatePoints(series.points,kind);
  if(series.points.some(p=>p.uncertainty!==undefined)&&series.uncertaintyKind!=='standard')throw Error(kind+' uncertainty must explicitly be a standard (1 sigma) uncertainty');
  return meta;
}

/** Linear interpolation of simulation values at measured times, never outside
 * the supplied support. Endpoint uncertainties use perfect positive temporal
 * correlation; simulation/experiment uncertainties are combined independently.
 */
export function compareExperiment(simulation,experiment,{coverageFactor=1}={}){
  bounded(coverageFactor,Number.EPSILON,10,'Coverage factor');
  const base={schema:'summer-experiment-comparison/1',status:'unavailable',reason:'no-data',quantity:null,unit:null,matchedCount:0,excludedCount:0,
    excluded:[],samples:[],metrics:null,coverage:{status:'unavailable',reason:'combined-standard-uncertainty-required',count:0,coveredCount:0,fraction:null,factor:coverageFactor},
    assumptions:['Simulation and experiment are separately supplied; their provenance and independence cannot be established from numeric values alone.',
      'When standard uncertainties are supplied, simulation and experiment uncertainties are assumed independent and combined by root sum of squares.',
      'Interpolated simulation standard uncertainties assume perfect positive correlation between neighboring simulation samples.',
      'Coverage is the observed fraction within factor × combined standard uncertainty; no Gaussian model, confidence level, or pass/fail conclusion is implied.',
      'Errors weight each matched measurement equally; they are not time-integrated error norms.',
      'Experimental times are treated as exact. Interpolation error, omitted uncertainty sources, and model discrepancy are not added automatically.',assurance]};
  if(simulation==null||experiment==null)return base;
  if(simulation===experiment||typeof simulation.sourceId==='string'&&simulation.sourceId.length>0&&simulation.sourceId===experiment.sourceId)throw Error('Simulation and experiment must have independent source records');
  const meta=validateSeries(simulation,'simulation'),experimentalMeta=validateSeries(experiment,'experiment');
  if(meta.quantity!==experimentalMeta.quantity||meta.unit!==experimentalMeta.unit)throw Error('Simulation and experiment must use the same explicit quantity and unit; conversions are not inferred');
  Object.assign(base,meta);
  if(!simulation.points.length||!experiment.points.length)return base;
  const points=simulation.points,start=points[0].time,end=points.at(-1).time;let index=0;
  for(const e of experiment.points){
    if(e.time<start||e.time>end){base.excluded.push({time:e.time,reason:'outside-simulation-time-support'});continue;}
    while(index+1<points.length&&points[index+1].time<e.time)index++;
    let value,uncertainty;
    if(points[index].time===e.time){value=points[index].value;uncertainty=points[index].uncertainty;}
    else if(points[index+1]?.time===e.time){value=points[index+1].value;uncertainty=points[index+1].uncertainty;}
    else{
      const a=points[index],b=points[index+1],weight=(e.time-a.time)/(b.time-a.time);
      value=(1-weight)*a.value+weight*b.value;
      if(a.uncertainty!==undefined&&b.uncertainty!==undefined)uncertainty=(1-weight)*a.uncertainty+weight*b.uncertainty;
    }
    const error=value-e.value;if(!finite(value)||!finite(error))throw Error('Experiment comparison overflow');
    const combined=uncertainty!==undefined&&e.uncertainty!==undefined?Math.hypot(uncertainty,e.uncertainty):null;
    if(combined!==null&&!finite(combined))throw Error('Combined uncertainty overflow');
    base.samples.push({time:e.time,simulation:value,experiment:e.value,error,simulationUncertainty:uncertainty??null,experimentalUncertainty:e.uncertainty??null,
      combinedUncertainty:combined,covered:combined===null?null:Math.abs(error)<=coverageFactor*combined});
  }
  base.matchedCount=base.samples.length;base.excludedCount=base.excluded.length;
  if(!base.matchedCount)return {...base,reason:'no-overlapping-time-support'};
  const errors=base.samples.map(p=>p.error),observed=base.samples.map(p=>p.experiment),errorRms=rms(errors),errorScale=maxAbs(errors),observationScale=maxAbs(observed);
  let relativeL2=null,relativeL2Reason=meta.unit==='degC'?'affine-unit-has-no-invariant-relative-norm':observationScale===0?'zero-experimental-norm':null;
  if(!relativeL2Reason){
    relativeL2=errorScale?Math.exp(Math.log(errorScale)-Math.log(observationScale)+.5*Math.log(errors.reduce((s,v)=>s+(v/errorScale)**2,0)/observed.reduce((s,v)=>s+(v/observationScale)**2,0))):0;
    if(!finite(relativeL2)){relativeL2=null;relativeL2Reason='relative-norm-overflow';}
  }
  base.metrics={rmse:errorRms,relativeL2,bias:average(errors),maxAbsoluteError:errorScale,relativeL2Reason,weighting:'equal-weight-measurement-samples'};
  const withUncertainty=base.samples.filter(p=>p.combinedUncertainty!==null);
  if(withUncertainty.length){const covered=withUncertainty.filter(p=>p.covered).length;base.coverage={status:withUncertainty.length===base.samples.length?'available':'partial',reason:null,count:withUncertainty.length,coveredCount:covered,fraction:covered/withUncertainty.length,factor:coverageFactor};}
  return {...base,status:base.excludedCount?'partial':'available',reason:base.excludedCount?'outside-support-samples-excluded':null};
}

function randomGenerator(seed){let state=seed>>>0;return ()=>{state=(state+0x6D2B79F5)>>>0;let v=state;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return ((v^(v>>>14))>>>0)/4294967296;};}
export function sampleInputs(specification,{seed=0,count=16}={}){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Seed must be an unsigned 32-bit integer');
  if(!Number.isInteger(count)||count<1||count>10000)throw Error('Sample count must be 1–10000');
  if(!Array.isArray(specification)||!specification.length||specification.length>32)throw Error('Specify 1–32 uncertain inputs');
  const seen=new Set(),inputs=specification.map(s=>{
    if(!plain(s)||typeof s.key!=='string'||!/^[-A-Za-z_][-\w]{0,39}$/.test(s.key)||['__proto__','constructor','prototype'].includes(s.key)||seen.has(s.key))throw Error('Input keys must be unique safe identifiers');seen.add(s.key);
    if(!VV_UNITS.includes(s.unit))throw Error('Each input needs an explicit supported SI unit');
    const fields=['key','quantity','unit','distribution',...(s.distribution==='uniform'?['min','max']:['mean','standardDeviation'])];
    if(Object.keys(s).some(k=>!fields.includes(k)))throw Error('Unsupported input distribution field');
    if(s.quantity!==undefined)metadata(s);
    if(s.distribution==='uniform'){if(!finite(s.min)||!finite(s.max)||s.min>s.max)throw Error('Uniform input requires finite min ≤ max');}
    else if(s.distribution==='normal'){if(!finite(s.mean)||!finite(s.standardDeviation)||s.standardDeviation<0)throw Error('Normal input requires finite mean and nonnegative standardDeviation');}
    else throw Error('Supported input distributions are uniform and normal');
    return {...s};
  });
  const random=randomGenerator(seed),samples=[];
  for(let i=0;i<count;i++){
    const values=inputs.map(s=>{
      let value;if(s.distribution==='uniform'){const u=random();value=(1-u)*s.min+u*s.max;}
      else {const normal=Math.sqrt(-2*Math.log(1-random()))*Math.cos(2*Math.PI*random());value=s.mean+s.standardDeviation*normal;}
      if(!finite(value))throw Error('Sampled input overflow');return [s.key,value];
    });samples.push({sampleId:'sample-'+(i+1),inputs:Object.fromEntries(values)});
  }
  return {schema:'summer-uq-samples/1',method:'independent-monte-carlo',algorithm:'mulberry32-box-muller/1',seed,count,inputs,samples,
    assumptions:['Inputs are sampled independently from the explicitly supplied distributions.',
      'Normal distributions are unbounded; invalid physical samples must be reported by the actual solver, never silently clipped.',
      'These are inputs for actual solver runs, not simulated output results.']};
}

function ranks(values){
  const sorted=values.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value),result=new Array(values.length);
  for(let i=0;i<sorted.length;){let end=i+1;while(end<sorted.length&&sorted[end].value===sorted[i].value)end++;const rank=(i+end-1)/2+1;for(let j=i;j<end;j++)result[sorted[j].index]=rank;i=end;}
  return result;
}
function correlation(a,b){
  if(a.length<3)return null;const as=maxAbs(a),bs=maxAbs(b);if(!as||!bs)return null;
  const x=a.map(v=>v/as),y=b.map(v=>v/bs),mx=average(x),my=average(y);let xx=0,yy=0,xy=0;
  for(let i=0;i<x.length;i++){const dx=x[i]-mx,dy=y[i]-my;xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;}
  return xx>0&&yy>0?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null;
}
export function summarizeEnsemble(rows,{valueKey='value',inputKey='inputs',quantity,unit,quantiles=[.05,.5,.95]}={}){
  records(rows,'Ensemble rows');const meta=metadata({quantity,unit});
  if(!Array.isArray(quantiles)||!quantiles.length||quantiles.length>101||quantiles.some(q=>!finite(q)||q<0||q>1)||new Set(quantiles).size!==quantiles.length)throw Error('Quantile probabilities must be unique values from 0 to 1');
  const valid=[],failedSamples=[],sampleIds=new Set();
  rows.forEach((row,index)=>{
    let reason;if(!plain(row))reason='invalid-row';else if(!successful(row.status))reason=String(row.reason??row.error??'solver-run-failed')||'solver-run-failed';else if(!finite(row[valueKey]))reason='missing-or-nonfinite-output';
    else if(row[inputKey]!==undefined&&(!plain(row[inputKey])||Object.values(row[inputKey]).some(v=>!finite(v))))reason='invalid-input-values';
    if(!reason&&row.sampleId!==undefined){if(typeof row.sampleId!=='string'||!row.sampleId||sampleIds.has(row.sampleId))reason='invalid-or-duplicate-sample-id';else sampleIds.add(row.sampleId);}
    if(reason)failedSamples.push({index,sampleId:row?.sampleId??null,status:row?.status??'invalid',reason:String(reason),inputs:plain(row?.[inputKey])?{...row[inputKey]}:null});
    else valid.push(row);
  });
  const base={schema:'summer-ensemble-summary/1',status:valid.length?(failedSamples.length?'partial':'available'):'unavailable',...meta,totalCount:rows.length,count:valid.length,failedCount:failedSamples.length,failedSamples,
    mean:null,standardDeviation:null,min:null,max:null,quantiles:[],sensitivity:[],intervalInterpretation:'empirical-output-quantiles-not-confidence-intervals',
    limitations:['Quantiles use linear interpolation of the empirical output distribution; they are not confidence intervals for a mean or a physical prediction.',
      'Pearson and Spearman coefficients describe sampled associations, not causal effects or a variance-based sensitivity decomposition.',
      'Sensitivity coefficients require at least three paired samples and variation in both variables.',
      ...(failedSamples.length?['Statistics are conditional on successful runs; failed or invalid samples remain reported and can bias the subset.']:[]),assurance]};
  if(!valid.length)return {...base,reason:rows.length?'no-successful-finite-results':'no-data'};
  const values=valid.map(r=>r[valueKey]),sorted=values.slice().sort((a,b)=>a-b),mean=average(values),scale=maxAbs(values);
  const sd=values.length<2?null:scale?Math.sqrt(values.reduce((sum,v)=>sum+(v/scale-mean/scale)**2,0)/(values.length-1))*scale:0;
  if(!finite(mean)||sd!==null&&!finite(sd))throw Error('Ensemble statistics overflow');
  base.quantiles=quantiles.slice().sort((a,b)=>a-b).map(probability=>{const position=probability*(sorted.length-1),i=Math.floor(position),w=position-i;return {probability,value:(1-w)*sorted[i]+w*sorted[Math.min(i+1,sorted.length-1)]};});
  const keys=[...new Set(valid.flatMap(r=>Object.keys(r[inputKey]??{})))].sort();
  for(const input of keys){
    const paired=valid.filter(r=>finite(r[inputKey]?.[input])),x=paired.map(r=>r[inputKey][input]),y=paired.map(r=>r[valueKey]);
    const pearson=correlation(x,y),spearman=correlation(ranks(x),ranks(y));
    base.sensitivity.push({input,count:paired.length,pearson,spearman,status:pearson===null?'indeterminate':paired.length<valid.length?'partial':'available',reason:pearson===null?'insufficient-pairs-or-variation':null});
  }
  return {...base,mean,standardDeviation:sd,min:sorted[0],max:sorted.at(-1)};
}
