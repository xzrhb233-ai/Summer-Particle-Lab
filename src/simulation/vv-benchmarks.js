import {cantileverProject,dynamicCantileverProject} from '../fem/model.js';
import {FEMSimulation,multiply} from '../fem/solver.js';
import {FEMDynamicSimulation} from '../fem/dynamic.js';
import {firstMode} from '../fem/dynamic-validation.js';
import {tipDisplacement,beamReference} from '../fem/validation.js';
import {configurationId} from './workspace-context.js';
import {analyzeRefinement,sampleInputs,summarizeEnsemble} from './vv-metrics.js';

export const VV_BENCHMARK_VERSION='0.71.0';
export const VV_CASE_IDS=['axial-patch','beam-mesh','modal-time','thermal-energy','material-ensemble','mpm-translation'];
const clone=x=>structuredClone(x),now=()=>performance.now(),norm=a=>Math.hypot(...a);
const nextTurn=()=>new Promise(resolve=>setTimeout(resolve,0));
const errorText=e=>String(e?.message??e).slice(0,500);
const backend={device:'cpu',solver:'Summer Tet4 linear FEM',version:VV_BENCHMARK_VERSION,precision:'Float64'};
const commonLimitations=['These bounded examples do not certify other models, meshes, loads, contacts, or backends.','No experimental data is used; analytic verification and empirical parameter sampling are reported separately.'];

function checkedKeys(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');
  const unknown=Object.keys(value).filter(k=>!keys.includes(k));if(unknown.length)throw Error(label+' has unsupported fields: '+unknown.join(', '));
}
function control(hooks={},budget=20000){
  const started=now(),timeBudgetMs=Math.min(budget,hooks.timeBudgetMs??budget),maxSteps=Math.min(20000,hooks.maxSteps??20000);
  if(!(timeBudgetMs>0)||!Number.isFinite(timeBudgetMs)||!Number.isInteger(maxSteps)||maxSteps<1)throw Error('Invalid V&V resource limits');
  const c={started,timeBudgetMs,maxSteps,steps:0,hooks};
  c.check=()=>{if(hooks.signal?.aborted)throw Object.assign(Error('Study cancelled'),{vvStatus:'cancelled'});if(now()-started>timeBudgetMs)throw Object.assign(Error('Study time budget exceeded'),{vvStatus:'limited'});};
  c.progress=async detail=>{c.check();hooks.onProgress?.({...detail,elapsedMs:now()-started,totalSteps:c.steps});await nextTurn();c.check();};
  return c;
}
function instrument(sim,c){
  const stats={minDt:Infinity,maxDt:0,steps:0},advance=sim.advanceShared.bind(sim);
  sim.advanceShared=tick=>{c.check();if(c.steps>=c.maxSteps)throw Object.assign(Error('Study step budget exceeded'),{vvStatus:'limited'});c.steps++;stats.steps++;stats.minDt=Math.min(stats.minDt,tick.dt);stats.maxDt=Math.max(stats.maxDt,tick.dt);advance(tick);};
  return stats;
}
function timing(stats,sim){return {requestedDt:sim.project.solver.dt,effectiveDt:sim.dt,minDt:stats.steps?stats.minDt:null,maxDt:stats.steps?stats.maxDt:null,steps:stats.steps,eventSplits:sim.eventSplits,outputSplits:sim.stopSplits,uniform:stats.steps>0&&stats.maxDt-stats.minDt<=stats.maxDt*1e-7};}
async function advanceTo(sim,end,c,detail,intervals=8){
  for(let i=1;i<=intervals;i++){c.check();const target=end*i/intervals;if(target>sim.time+1e-13)sim.step(target-sim.time,false);await c.progress({...detail,time:sim.time,duration:end,fraction:i/intervals});}
}
function aggregate(items){
  for(const status of ['failed','cancelled','limited','unsupported','inconclusive'])if(items.some(x=>x.status===status))return status;
  return items.length?'passed':'unsupported';
}
function checksStatus(checks){return checks.every(c=>c.passed)?'passed':'failed';}
function check(name,value,tolerance){return {name,value,tolerance,passed:Number.isFinite(value)&&Math.abs(value)<=tolerance};}
function report(c,cases,extra={}){return {schema:'summer-vv-benchmarks/1',version:VV_BENCHMARK_VERSION,backend:{...backend,solver:'Summer CPU verification suite'},status:aggregate(cases),cases,elapsedMs:now()-c.started,limits:{timeBudgetMs:c.timeBudgetMs,maxSteps:c.maxSteps,actualSteps:c.steps},limitations:commonLimitations.slice(),...extra};}
function dynamicProject(options={}){
  const p=dynamicCantileverProject({size:[1,.2,.2],divisions:[6,2,2],force:[0,0,0],damping:0,...options});
  p.curves=[];p.loadBindings=[];Object.assign(p.solver,{initialState:'rest',thermal:false,damping:0,dt:.02});return p;
}
function meshH(nodes,cells){let h=0;for(const cell of cells){const ids=cell.ids??cell;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)h=Math.max(h,norm(nodes[ids[i]].map((x,k)=>x-nodes[ids[j]][k])));}return h;}
function staticSolve(project,c){c.check();const sim=new FEMSimulation(project);try{const part=sim.step().fem.parts[0];c.check();return part;}finally{sim.free();}}
function refinement(rows,options={},extraReasons=[]){
  const analysis=analyzeRefinement(rows,options);
  if(extraReasons.length)return {...analysis,status:'indeterminate',reason:extraReasons.join(' '),observedOrder:null,richardson:null,gci:null,limitations:[...(analysis.limitations??[]),...extraReasons]};
  return analysis;
}

async function axialPatch(c){
  const project=cantileverProject({size:[1,.2,.3],divisions:[4,2,2],young:2e7,poisson:0,force:[12,0,0]}),part=staticSolve(project,c),E=project.parts[0].material.young,A=.2*.3,sigma=12/A,tip=12/(E*A),xmin=Math.min(...part.nodes.map(p=>p[0]));
  let displacementError=0,stressError=0;
  part.nodes.forEach((p,n)=>{for(let k=0;k<3;k++)displacementError=Math.max(displacementError,Math.abs(part.displacement[3*n+k]-(k===0?sigma/E*(p[0]-xmin):0)));});
  for(const s of part.stress)for(let k=0;k<6;k++)stressError=Math.max(stressError,Math.abs(s[k]-(k===0?sigma:0)));
  const checks=[check('nodal displacement absolute error (m)',displacementError,1e-11),check('element stress absolute error (Pa)',stressError,1e-4),check('linear residual',part.relativeResidual,1.05e-8),check('force balance (N)',norm(part.summary.forceBalance),1e-6)];
  await c.progress({caseId:'axial-patch',fraction:1});
  return {id:'axial-patch',title:'Affine uniaxial Tet4 patch',status:checksStatus(checks),backend,configurationId:configurationId(project),reference:{kind:'analytic',formula:'u_x=F(x-x_min)/(EA); sigma_xx=F/A',tipDisplacement:tip,stress:sigma,source:'src/fem/solver.js: linear isotropic constitutive law; exact affine continuum solution'},assumptions:['Small strain, homogeneous isotropic elasticity, Poisson ratio zero.','Full x- restraint is compatible with zero transverse strain; uniform x+ traction; no body force.'],resolutions:[{divisions:[4,2,2],nodes:part.nodes.length,elements:part.cells.length,h:meshH(part.nodes,part.cells)}],checks,limitations:['Exact representability checks assembly, traction integration and solution; it does not establish bending or general-mesh accuracy.']};
}

async function beamMesh(c){
  const rows=[];
  for(const n of [1,2,4,8]){
    const divisions=[6*n,n,n],project=cantileverProject({size:[2,.2,.2],divisions,force:[0,-1,0]}),part=staticSolve(project,c),reference=beamReference(project).dy,value=tipDisplacement(part)[1];
    rows.push({divisions,nodes:part.nodes.length,elements:part.cells.length,h:meshH(part.nodes,part.cells),value,reference,relativeError:Math.abs(value/reference-1),residual:part.relativeResidual,forceBalance:norm(part.summary.forceBalance),configurationId:configurationId(project)});
    await c.progress({caseId:'beam-mesh',level:rows.length,totalLevels:4,fraction:rows.length/4});
  }
  const analysis=refinement(rows),checks=[check('maximum linear residual',Math.max(...rows.map(r=>r.residual)),1.05e-8),check('finest beam approximation relative error',rows.at(-1).relativeError,.1),{name:'error decreases at every mesh level',passed:rows.slice(1).every((r,i)=>r.relativeError<rows[i].relativeError)}];
  return {id:'beam-mesh',title:'Cantilever spatial refinement',status:checksStatus(checks)==='failed'?'failed':analysis.status==='estimated'?'passed':'inconclusive',backend,reference:{kind:'engineering-approximation',formula:'tipY=FL^3/(3EI), I=bh^3/12',value:rows[0].reference,unit:'m',source:'src/fem/validation.js: beamReference'},assumptions:['Linear, slender, rectangular cantilever; L/height=10; fixed full x- face and area-distributed x+ total force.','Euler–Bernoulli reference excludes shear and three-dimensional support effects.'],resolutions:rows,refinement:analysis,checks,limitations:['The 10% finest-level tolerance is an illustrative regression threshold, not a general accuracy guarantee.','Tet4 bending stiffness may remain pre-asymptotic at these bounded meshes; no GCI is reported without observed evidence.','Maximum tetrahedron edge length is measured from actual nodes; fixed-end stress is excluded.']};
}

async function modalTime(c){
  const project=dynamicProject({size:[2,.2,.4],divisions:[8,2,2]}),base=new FEMDynamicSimulation(project),mode=firstMode(base.states[0]),duration=.37*2*Math.PI/mode.omega,intervals=8;
  // Choose an integer count so output stops do not change the intended 2:1 ratios.
  const coarseSteps=Math.max(intervals,Math.ceil(duration/base.dt/intervals)*intervals),coarseDt=duration/coarseSteps,rows=[];base.free();
  for(const factor of [1,.5,.25,.125]){
    const p=clone(project);p.solver.dt=coarseDt*factor;
    const sim=new FEMDynamicSimulation(p),stats=instrument(sim,c),s=sim.states[0],amplitude=.001;
    try{
      s.u=mode.phi.map(x=>x*amplitude);s.v.fill(0);s.internal=multiply(s.A,s.u);s.initialEnergy=s.u.reduce((a,x,i)=>a+x*s.internal[i],0)/2;
      await advanceTo(sim,duration,c,{caseId:'modal-time',level:rows.length+1,totalLevels:4},intervals);
      const value=s.u.reduce((a,x,i)=>a+s.m[i]*mode.phi[i]*x,0)/amplitude,exact=Math.cos(mode.omega*duration),t=timing(stats,sim);
      rows.push({h:t.maxDt,requestedH:p.solver.dt,value,exact,absoluteError:Math.abs(value-exact),time:sim.time,...t,configurationId:configurationId(p)});
    }finally{sim.free();}
  }
  const analysis=refinement(rows,{},rows.some(r=>!r.uniform)?['Nonuniform actual substeps prevent a single-step-size Richardson estimate.']:[]),checks=[check('generalized eigen residual',mode.residual,1e-5),check('finest modal displacement absolute error',rows.at(-1).absoluteError,1e-3),{name:'actual temporal error decreases',passed:rows.slice(1).every((r,i)=>r.absoluteError<rows[i].absoluteError)}];
  return {id:'modal-time',title:'Undamped eigenmode time refinement',status:checksStatus(checks)==='failed'?'failed':analysis.status==='estimated'?'passed':'inconclusive',backend,reference:{kind:'semi-discrete-analytic',formula:'q(t)=cos(omega*t)',omega:mode.omega,eigenResidual:mode.residual,duration,source:'src/fem/dynamic-validation.js: firstMode (inverse iteration independent of integration)'},assumptions:['Fixed spatial mesh, lumped mass, zero external force and damping; initial displacement is an independently solved eigenvector.','This isolates time integration of the discrete system, not continuum spatial accuracy.'],resolutions:rows,refinement:analysis,checks,limitations:['Initial eigenvector has a finite reported eigensolver residual.','Reported dt values are observed advanceShared steps, including output and event splits.']};
}

async function thermalEnergy(c){
  const project=dynamicProject({size:[.2,.2,.2],divisions:[2,2,2],young:1e6}),power=800,duration=.04,T0=20;
  project.solver.thermal=true;project.loads.push({id:'uniform-heat',type:'thermal-power',target:'beam',region:{type:'whole'},power});
  const sim=new FEMDynamicSimulation(project),stats=instrument(sim,c);
  try{
    await advanceTo(sim,duration,c,{caseId:'thermal-energy'});
    const s=sim.states[0],mass=project.parts[0].material.density*.2**3,capacity=mass*project.parts[0].material.cp,expected=T0+power*duration/capacity,measured=s.thermal.temperature.reduce((sum,T,i)=>sum+T*s.thermal.capacity[i],0)/s.thermal.capacity.reduce((a,b)=>a+b,0),temperatureError=Math.max(...s.thermal.temperature.map(T=>Math.abs(T-expected))),actualHeat=s.thermal.temperature.reduce((sum,T,i)=>sum+(T-T0)*s.thermal.capacity[i],0),checks=[check('uniform nodal temperature absolute error (degC)',temperatureError,1e-9),check('stored energy minus supplied heat (J)',actualHeat-power*duration,1e-6)];
    return {id:'thermal-energy',title:'Adiabatic uniform heating energy balance',status:checksStatus(checks),backend,configurationId:configurationId(project),reference:{kind:'analytic-conservation',formula:'T=T0+Pt/(rho*V*cp); deltaU=Pt',temperature:expected,heat:power*duration,duration,source:'First law for constant heat capacity and uniform volumetric power'},assumptions:['Homogeneous constant density and heat capacity, adiabatic exterior, uniform initial temperature.','Whole-part power is distributed by lumped mass; thermal expansion is zero.'],resolutions:[{nodes:s.mesh.nodes.length,elements:s.mesh.cells.length,h:meshH(s.mesh.nodes,s.mesh.cells),...timing(stats,sim)}],measurements:{temperature:measured,storedHeat:actualHeat,suppliedHeat:sim.thermal.externalHeat},checks,limitations:['Uniform heating has no spatial gradient and an exactly integrable source; it does not establish diffusion spatial or temporal order.']};
  }finally{sim.free();}
}

async function materialEnsemble(c,plan){
  const {youngRelativeHalfWidth:e,densityRelativeHalfWidth:rho}=plan.materialUncertainty;
  const design=sampleInputs([{key:'young',unit:'Pa',distribution:'uniform',min:2e7*(1-e),max:2e7*(1+e)},{key:'density',unit:'kg/m^3',distribution:'uniform',min:1000*(1-rho),max:1000*(1+rho)}],{count:plan.ensembleCount,seed:plan.seed}),rows=[];
  for(const sample of design.samples){
    c.check();const p=cantileverProject({size:[.5,.2,.2],divisions:[8,2,2],force:[0,0,0],...sample.inputs});p.environment.gravity=[0,-9.81,0];
    try{const part=staticSolve(p,c),value=tipDisplacement(part)[1];if(!Number.isFinite(value)||part.relativeResidual>1.05e-8)throw Error('Static ensemble solve did not meet the residual tolerance');rows.push({...sample,status:'passed',value,residual:part.relativeResidual,maxStrain:part.summary.maxStrain,warnings:part.summary.warnings,configurationId:configurationId(p)});}
    catch(e){if(e.vvStatus)throw e;rows.push({...sample,status:'failed',value:null,error:errorText(e),configurationId:configurationId(p)});}
    await c.progress({caseId:'material-ensemble',sample:rows.length,totalSamples:design.samples.length,fraction:rows.length/design.samples.length});
  }
  const summary=summarizeEnsemble(rows,{quantity:'area-weighted x+ displacement Y',unit:'m'});
  return {id:'material-ensemble',title:'Young modulus and density self-weight ensemble',status:rows.some(r=>r.status==='failed')?'failed':'passed',backend,reference:{kind:'parameter-study',source:'Independent CPU FEM static solve for every sampled input; no external validation reference'},assumptions:['Independent declared uniform inputs around E=2e7 Pa and density=1000 kg/m^3; fixed geometry and mesh, small-strain self-weight loading.','Density changes gravity load and Young modulus changes stiffness; every output is a new solver result.'],sampling:{seed:design.seed,count:design.count,inputs:design.inputs,algorithm:design.algorithm,materialUncertainty:clone(plan.materialUncertainty)},resolutions:[{size:[.5,.2,.2],divisions:[8,2,2],gravity:[0,-9.81,0],poisson:.3}],samples:rows,summary,checks:[{name:'all sampled solves produce finite converged responses',passed:rows.every(r=>r.status==='passed')}],limitations:['These declared input ranges are assumptions, not calibrated material uncertainty.','A small empirical ensemble is not a confidence interval, a distribution convergence study, or experimental validation.','Sampling does not quantify mesh bias, model-form error, or unmodeled correlations.']};
}

async function mpmTranslation(c){
  c.check();if(c.steps>=c.maxSteps)throw Object.assign(Error('Study step budget exceeded'),{vvStatus:'limited'});
  const {runMPMTranslationCheck}=await import('./vv-mpm.js');
  const result=await runMPMTranslationCheck({signal:c.hooks.signal,timeBudgetMs:Math.max(1,c.timeBudgetMs-(now()-c.started)),maxSteps:c.maxSteps-c.steps,onProgress:detail=>c.hooks.onProgress?.({...detail,caseId:'mpm-translation',elapsedMs:now()-c.started,totalSteps:c.steps})});
  c.steps+=result.physicalSubsteps??0;
  return {...result,backend:{device:'cpu',solver:'Summer production MPM',version:VV_BENCHMARK_VERSION},status:result.stopReason==='aborted'?'cancelled':result.stopReason?'limited':result.status};
}

/** Independent, bounded verification problems; never mutate a workspace project. */
export async function runVVBenchmarks(input={},hooks={}){
  checkedKeys(input,['cases','backend','ensembleCount','seed','materialUncertainty'],'Benchmark plan');
  const plan={backend:'cpu',cases:VV_CASE_IDS.slice(),ensembleCount:8,seed:7101,...input};
  if(!Array.isArray(plan.cases)||!plan.cases.length||plan.cases.length>8||plan.cases.some(x=>typeof x!=='string')||new Set(plan.cases).size!==plan.cases.length)throw Error('Choose 1–8 distinct benchmark case IDs');
  if(!Number.isInteger(plan.ensembleCount)||plan.ensembleCount<4||plan.ensembleCount>16)throw Error('Ensemble count must be 4–16');
  if(!Number.isInteger(plan.seed)||plan.seed<0||plan.seed>0xffffffff)throw Error('Seed must be an unsigned 32-bit integer');
  checkedKeys(plan.materialUncertainty??{},['youngRelativeHalfWidth','densityRelativeHalfWidth'],'Material uncertainty');
  plan.materialUncertainty={youngRelativeHalfWidth:.1,densityRelativeHalfWidth:.1,...plan.materialUncertainty};
  if(Object.values(plan.materialUncertainty).some(x=>!Number.isFinite(x)||x<0||x>.5))throw Error('Material relative half-widths must be in [0, 0.5]');
  const c=control(hooks),cases=[],runners={'axial-patch':axialPatch,'beam-mesh':beamMesh,'modal-time':modalTime,'thermal-energy':thermalEnergy,'material-ensemble':materialEnsemble,'mpm-translation':mpmTranslation};
  for(const id of plan.cases){
    if(plan.backend!=='cpu'||!runners[id]){cases.push({id,status:'unsupported',reason:plan.backend!=='cpu'?'This runner executes CPU FEM only.':'Unknown benchmark case.',checks:[]});continue;}
    try{c.check();cases.push(await runners[id](c,plan));}
    catch(e){cases.push({id,status:e.vvStatus??'failed',reason:errorText(e),checks:[]});}
  }
  return report(c,cases,{kind:'benchmarks',plan});
}

/** Time refinement of an exact clone of the supplied CPU FEM dynamic model. */
export async function runVVProjectStudy(project,input={},hooks={}){
  checkedKeys(input,['duration','partId','field','mode'],'Project study plan');
  const plan={duration:.02,partId:project?.parts?.find(p=>p.method==='fem')?.id,field:'maxDisplacement',mode:'time',...input};
  if(!Number.isFinite(plan.duration)||plan.duration<1e-6||plan.duration>.1)throw Error('Study duration must be in [0.000001, 0.1] s');
  if(!['tipY','maxDisplacement','temperature'].includes(plan.field)||plan.mode!=='time')throw Error('Only time refinement of tipY, maxDisplacement, or temperature is supported');
  const c=control(hooks,45000),base=clone(project),baseConfigurationId=configurationId(base),id='project-time',unavailable=reason=>report(c,[{id,status:'unsupported',reason,checks:[]}],{kind:'project-study',baseConfigurationId,plan,studies:[]});
  if(base?.solver?.adapter!=='cpu-fem-dynamic'||base.solver.analysis!=='linear-dynamic'||base.solver.computeBackend==='gpu')return unavailable('Current-project studies require the standalone CPU FEM dynamic adapter.');
  if(!base.parts.some(p=>p.id===plan.partId&&p.method==='fem'))return unavailable('The requested FEM part does not exist.');
  if(plan.field==='temperature'&&base.solver.thermal!==true)return unavailable('Temperature refinement requires an enabled thermal solve.');
  const rows=[],failures=[];
  for(const factor of [1,.5,.25,.125]){
    const p=clone(base);p.solver.dt=base.solver.dt*factor;
    let sim;
    try{
      c.check();if(p.solver.dt<1e-7){failures.push({factor,requestedDt:p.solver.dt,status:'unsupported',reason:'Refined requested dt is below the solver minimum of 1e-7 s.'});continue;}
      sim=new FEMDynamicSimulation(p);const stats=instrument(sim,c);
      await advanceTo(sim,plan.duration,c,{caseId:id,level:rows.length+failures.length+1,totalLevels:4},8);
      const part=sim.snapshot().fem.parts.find(p=>p.id===plan.partId),value=plan.field==='tipY'?part.summary.tip?.[1]:plan.field==='temperature'?part.summary.temperature:part.summary.maxDisplacement,t=timing(stats,sim);
      if(!Number.isFinite(value)){failures.push({factor,requestedDt:p.solver.dt,status:'unsupported',reason:'The selected response is unavailable (tipY requires a loaded response surface).'});continue;}
      rows.push({factor,requestedH:p.solver.dt,h:t.maxDt,value,time:sim.time,...t,configurationId:configurationId(p)});
    }catch(e){failures.push({factor,requestedDt:p.solver.dt,status:e.vvStatus??'failed',reason:errorText(e)});}
    finally{sim?.free();}
  }
  const reasons=[];
  if(rows.some(r=>!r.uniform))reasons.push('Nonuniform actual substeps (events, contact travel, or output stops) invalidate a single-dt Richardson estimate.');
  if(rows.length>1&&rows.every(r=>Math.abs(r.maxDt-rows[0].maxDt)<=rows[0].maxDt*1e-7))reasons.push('Actual step sizes are identical: stability or event limits prevented the requested refinement.');
  if(base.contactPairs?.some(p=>p.mechanical!==false))reasons.push('Contact activation is not a smooth fixed-operator problem; automatic Richardson/GCI claims are withheld.');
  if(failures.length)reasons.push('Not all requested levels completed successfully.');
  const analysis=refinement(rows,{},reasons),checks=[{name:'all four actual solves reached the same final time with finite output',passed:rows.length===4&&rows.every(r=>Math.abs(r.time-plan.duration)<1e-12)}],study={id,title:'Current project time refinement',status:failures.length?aggregate(failures):analysis.status==='estimated'?'passed':'inconclusive',backend,baseConfigurationId,partId:plan.partId,field:plan.field,unit:plan.field==='temperature'?'degC':'m',reference:{kind:'self-convergence',value:null,source:'No analytic or experimental reference is available for the supplied project.'},assumptions:['Each level starts from the same cloned configuration and initial state; only requested solver.dt changes.','Response is measured at one identical elapsed time, not at nearest recorded frames.'],resolutions:rows,failures,refinement:analysis,checks,limitations:['Self-convergence cannot establish model validity or spatial accuracy.','The selected response may cancel error or cross zero; unavailable/oscillating/constant differences do not establish convergence.','Maximum actual dt is used only when each run has uniform actual steps.']};
  return report(c,[study],{kind:'project-study',baseConfigurationId,plan,studies:[study]});
}
