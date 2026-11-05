import {initialize} from '../multibody/engine.js';
import {CoupledSimulation} from '../multibody/coupled.js';
import {fromLegacy,toLegacy} from './project.js';
import {gripExample} from './grip-example.js';
import {MechanicalDiagnostics} from './mechanical-diagnostics.js';

export const VALIDATION_VERSION='cpu-baseline/1';
export const validationCases=[
  {id:'stretch',name:'夹具拉伸',reference:'self-refinement'},
  {id:'twist',name:'夹具扭转',reference:'self-refinement'},
  {id:'oscillator',name:'无阻尼弹簧振动',reference:'x = 1 + 0.1 cos(10t)'},
  {id:'impact',name:'双球正碰',reference:'v₁ = 0.25, v₂ = 1 m/s'},
];
export function validationProject(id,{dt=1/960,cellSize=.1}={}){
  let p;
  if(['stretch','twist'].includes(id)){
    p=gripExample(id==='twist');p.discretization.mpm.cellSize=cellSize;
    const part=p.parts.find(p=>p.id==='specimen');
    part.geometry.size=[1.2,.4,.4];part.discretization.sampling.enabled=false;
    for(const set of p.selectionSets){set.region.lower=[set.id==='left-end'?-.6:.4,-.2,-.2];set.region.upper=[set.id==='left-end'?-.4:.6,.2,.2];}
    for(const b of p.parts.filter(p=>p.id.endsWith('clamp')))b.geometry.size=[.2,.5,.5];
  }else if(id==='oscillator'){
    p=fromLegacy({schema:'summer-mbd/1',name:'数值基准 · 无阻尼弹簧振动',gravity:[0,0,0],bodies:[
      {id:'anchor',type:'fixed',shape:'sphere',size:[.1,.1,.1],position:[0,1,0]},
      {id:'mass',type:'dynamic',shape:'sphere',size:[.1,.1,.1],position:[1.1,1,0],mass:1,damping:0}],
    joints:[{id:'spring',type:'spring',a:'anchor',b:'mass',anchor:[0,1,0],anchorB:[1.1,1,0],restLength:1,stiffness:100,damping:0}]});
  }else if(id==='impact'){
    p=fromLegacy({schema:'summer-mbd/1',name:'数值基准 · 双球正碰',gravity:[0,0,0],bodies:[
      {id:'a',type:'dynamic',shape:'sphere',size:[.2,.2,.2],position:[-.3,1,0],velocity:[1,0,0],mass:2,restitution:.5,friction:0},
      {id:'b',type:'dynamic',shape:'sphere',size:[.2,.2,.2],position:[.3,1,0],velocity:[-.5,0,0],mass:1,restitution:.5,friction:0}],joints:[]});
  }else throw Error('未知数值基准');
  p.solver.dt=dt;p.solver.diagnostics=true;p.solver.adapter='cpu-coupled';return p;
}
export function validationPlan(){
  const rows=[];
  for(const c of validationCases){
    const steps=['stretch','twist'].includes(c.id)?[1/480,1/960,1/1920]:[1/120,1/240,1/480];
    for(const dt of steps)rows.push({case:c.id,sweep:'time',dt,cellSize:.1,duration:c.id==='oscillator'?1:c.id==='impact'?.5:.1});
    if(['stretch','twist'].includes(c.id))for(const cellSize of [.2,.4/3,.1])rows.push({case:c.id,sweep:'grid',dt:1/1920,cellSize,duration:.1});
  }
  return rows;
}
export async function runValidationRow(spec,{progress=()=>{},yieldControl=async()=>{}}={}){
  const project=validationProject(spec.case,spec),engine=new CoupledSimulation(toLegacy(project)),d=new MechanicalDiagnostics(engine),start=performance.now(),trace=[];
  let maxConstraint=0,maxAnalyticError=0,maxMomentumChange=0,frame=engine.snapshot();d.sample(frame);
  let last=0;
  try{
    const steps=Math.round(spec.duration/spec.dt);
    for(let n=0;n<steps;n++){
      frame=engine.step(spec.dt);
      const diagnostic=d.sample(frame);maxConstraint=Math.max(maxConstraint,frame.maxError);maxMomentumChange=Math.max(maxMomentumChange,diagnostic.momentumChange);
      if(spec.case==='oscillator')maxAnalyticError=Math.max(maxAnalyticError,Math.abs(frame.bodies.find(b=>b.id==='mass').position[0]-(1+.1*Math.cos(10*frame.time))));
      if(n%Math.max(1,Math.floor(steps/40))===0||n===steps-1)trace.push({time:frame.time,coordinate:frame.joints.find(j=>j.id==='actuator')?.coordinate??frame.bodies.find(b=>b.id==='mass')?.position[0]??null,energy:diagnostic.mechanicalEnergy,residual:diagnostic.residual});
      if(performance.now()-last>100){progress((n+1)/steps);await yieldControl();last=performance.now();}
    }
    const diagnostic=frame.diagnostics,grip=frame.joints.find(j=>j.id==='right-grip');
    const value=spec.case==='oscillator'?maxAnalyticError:spec.case==='impact'?Math.max(Math.abs(frame.bodies[0].velocity[0]-.25),Math.abs(frame.bodies[1].velocity[0]-1)):frame.joints.find(j=>j.id==='actuator').coordinate;
    return {...spec,count:engine.particles?.count??0,mass:frame.coupling?.mass??frame.bodies.reduce((m,b)=>m+b.mass,0),value,maxConstraint,maxMomentumChange,
      reaction:grip?Math.hypot(...(spec.case==='twist'?grip.torque:grip.force)):null,
      seconds:(performance.now()-start)/1000,diagnostics:diagnostic,trace,
      status:spec.case==='oscillator'?(value<.004?'pass':'check'):spec.case==='impact'?(value<.02&&maxMomentumChange<1e-5?'pass':'check'):(maxConstraint<.005?'stable':'check')};
  }finally{engine.free();}
}
export function summarizeRefinement(rows){
  const summaries=[];
  for(const c of validationCases)for(const sweep of ['time','grid']){
    const r=rows.filter(r=>r.case===c.id&&r.sweep===sweep);if(r.length!==3)continue;
    const coarseChange=Math.abs(r[1].value-r[0].value),fineChange=Math.abs(r[2].value-r[1].value),relativeChange=fineChange/Math.max(Math.abs(r[2].value),1e-12);
    const analytic=c.reference!=='self-refinement',decreasing=analytic?r[2].value<r[0].value:fineChange<coarseChange;
    // Three levels establish sensitivity only; no continuum-error claim.
    summaries.push({case:c.id,sweep,coarseChange,fineChange,relativeChange,finestError:analytic?r[2].value:null,decreasing,status:analytic?(r.every(x=>x.status==='pass')?'pass':'check'):(relativeChange<.05&&decreasing&&r.every(x=>x.status==='stable')?'consistent':'check')});
  }
  return summaries;
}
export async function runValidation(options={}){
  await initialize();const rows=[],plan=validationPlan();
  for(const [index,spec] of plan.entries()){
    const row=await runValidationRow(spec,{...options,progress:f=>options.progress?.({index,total:plan.length,case:spec.case,sweep:spec.sweep,fraction:f})});
    rows.push(row);options.onRow?.(row,index);
  }
  return {schema:'summer-validation/1',version:VALIDATION_VERSION,createdAt:new Date().toISOString(),backend:'CPU / Rapier 0.19.3 / APIC MPM',rows,refinement:summarizeRefinement(rows),
    criteria:{oscillatorMaximumPositionError_m:.004,impactVelocityError_m_s:.02,impactMomentumChange_kg_m_s:1e-5,gripMaximumConstraintError_m:.005,refinementLastRelativeChange:.05},
    observables:{stretch:'final actuator displacement (m)',twist:'final actuator angle (rad)',oscillator:'maximum position error over 1 s (m)',impact:'maximum post-impact body velocity error (m/s)'},
    notes:['Elastic mechanical baseline only; not a certification of plasticity, fracture, PBF, GPU or thermal accuracy.',
      'Time studies report actual integrator substeps. Grid studies keep geometry, density and 8 points per cell fixed; noise is disabled.',
      'Motor/damping work is estimated. Residual includes unmeasured Rapier contact/constraint work and transfer, integration and position-correction errors.',
      'An externally supported system need not conserve momentum. CHECK means the chosen resolution is not established as insensitive.']};
}
export function validationCSV(report){
  const fields=['case','sweep','dt','cellSize','count','mass','value','maxConstraint','maxMomentumChange','reaction','seconds','status'];
  return [fields.join(','),...report.rows.map(r=>fields.map(k=>r[k]??'').join(','))].join('\n');
}
