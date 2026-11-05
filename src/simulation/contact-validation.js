import {initialize} from '../multibody/engine.js';
import {CoupledSimulation} from '../multibody/coupled.js';
import {fromLegacy,toLegacy} from './project.js';
import {MechanicalDiagnostics,particleMechanics} from './mechanical-diagnostics.js';
export const CONTACT_VALIDATION_VERSION='contact-clock/1';
export function contactValidationPlan(){
  const base={case:'impact',dt:1/480,cellSize:.1,duration:.125,batchTicks:[8]};
  return [
    {...base,id:'impact-60'}, {...base,id:'impact-120',batchTicks:[4]},
    {...base,id:'impact-irregular',batchTicks:[1,7,3,5]}, {...base,id:'impact-repeat'},
    {...base,id:'time-960',dt:1/960,batchTicks:[16]}, {...base,id:'time-1920',dt:1/1920,batchTicks:[32]},
    {...base,id:'grid-coarse',cellSize:.2}, {...base,id:'grid-medium',cellSize:.4/3},
    {...base,id:'press',case:'press',duration:.25}, {...base,id:'slide',case:'slide',duration:.25},
    {...base,id:'separate',case:'separate'},
  ];
}
export function contactValidationProject(spec){
  const fixed=['press','slide'].includes(spec.case),separate=spec.case==='separate';
  const project=fromLegacy({schema:'summer-mbd/1',name:'接触验证 · '+spec.id,dt:spec.dt,gravity:fixed?[4,0,0]:[0,0,0],bodies:[],joints:[],
    coupling:{enabled:true,mechanical:false,thermal:false,thermalScale:1000,stiffness:1,
      domain:{lower:[-.8,0,-.4],upper:[.8,1.2,.4],cellSize:spec.cellSize,particlesPerAxis:2},
      parts:[
        {id:'a',name:'热块',method:'mpm',center:[-.1,.5,0],size:[.2,.2,.2],density:1100,temperature:100,model:0,
          velocity:separate?[-.3,0,0]:fixed?[.4,0,spec.case==='slide'?.6:0]:[1.5,0,0],sampling:{enabled:false},phaseChange:{enabled:false}},
        {id:'b',name:'冷块',method:'mpm',center:[.1,.5,0],size:[.2,.2,.2],density:2200,temperature:20,model:0,
          velocity:separate?[.15,0,0]:fixed?[0,0,0]:[-.75,0,0],sampling:{enabled:false},phaseChange:{enabled:false},
          }
      ]},contactPairs:[{id:'ab',a:'a',b:'b',mechanical:true,thermal:true,friction:spec.case==='slide'?.4:0,contactConductance:20000}]});
  if(fixed){
    project.selectionSets.push({id:'support',name:'固定冷块',part:'b',region:{type:'whole'}});
    project.loads.push({id:'support-load',type:'fixed-selection',target:'b',selection:'support'});
  }
  return project;
}
const norm=v=>Math.hypot(...v),diff=(a,b)=>Math.max(...a.map((x,k)=>Math.abs(x-b[k])));
export function contactObservation(s){
  const p=s.particles,m=particleMechanics(p,s.model.gravity),position=[],velocity=[],centers=[],speeds=[],masses=[];
  for(let part=1;part<=2;part++){
    let mass=0;const x=[0,0,0],v=[0,0,0];
    for(let i=0;i<p.count;i++)if(p.lab.part[i]===part){
      mass+=p.mass[i];
      for(let k=0;k<3;k++){x[k]+=p.mass[i]*p[['x','y','z'][k]][i]*.025;v[k]+=p.mass[i]*p[['vx','vy','vz'][k]][i]*.025;}
    }
    centers.push(...x.map(x=>x/mass));speeds.push(...v.map(x=>x/mass));masses.push(mass);
  }
  for(let i=0;i<p.count;i++){position.push(p.x[i]*.025,p.y[i]*.025,p.z[i]*.025);velocity.push(p.vx[i]*.025,p.vy[i]*.025,p.vz[i]*.025);}
  return {position,velocity,centers,speeds,masses,momentum:m.momentum,angular:m.angular,energy:m.kinetic+m.affine+m.potential+m.elastic};
}
export function classifyContactRow(row){
  if(row.error)return 'error';
  const closed=['impact','separate'].includes(row.case);
  return row.maxOverlap/row.cellSize<=.15&&row.maxThermalResidual<1e-4&&row.positiveContactWork<1e-6
    &&(!closed||(row.maxMomentumError<1e-4&&row.maxAngularError<1e-4&&row.maxEnergyGain<.03))
    &&(row.case!=='separate'||row.normalImpulse<1e-6)?'pass':'check';
}
export async function runContactRow(spec,{progress=()=>{},yieldControl=async()=>{}}={}){
  const s=new CoupledSimulation(toLegacy(contactValidationProject(spec))),d=new MechanicalDiagnostics(s);
  const initial=contactObservation(s),start=performance.now(),trace=[];
  let impulse=0,overlap=0,thermal=0,momentum=0,angular=0,maxEnergy=initial.energy,k=0,last=0;
  try{
    d.sample(s.snapshot());
    while(s.time<spec.duration-1e-10){
      const dt=Math.min(spec.duration-s.time,spec.batchTicks[k++%spec.batchTicks.length]*Math.min(spec.dt,1/480));
      const f=s.step(dt),p=f.contactPairs[0],obs=contactObservation(s);
      impulse+=p.normalForce*dt;overlap=Math.max(overlap,p.maxPenetration);thermal=Math.max(thermal,Math.abs(f.coupling.thermalResidual));
      momentum=Math.max(momentum,norm(obs.momentum.map((x,k)=>x-initial.momentum[k])));
      angular=Math.max(angular,norm(obs.angular.map((x,k)=>x-initial.angular[k])));
      maxEnergy=Math.max(maxEnergy,obs.energy);
      if(trace.length<41)trace.push({time:f.time,normalForce:p.normalForce,heat:p.accumulatedHeat,energy:obs.energy});
      if(performance.now()-last>150){progress(s.time/spec.duration);await yieldControl();last=performance.now();}
    }
    const f=s.snapshot(),final=contactObservation(s),row={...spec,backend:'CPU',count:s.particles.count,initial,final,clock:f.clock,
      normalImpulse:impulse,heat:f.contactPairs[0].accumulatedHeat,maxOverlap:overlap,maxThermalResidual:thermal,
      maxMomentumError:momentum,maxAngularError:angular,maxEnergyGain:(maxEnergy-initial.energy)/Math.max(Math.abs(initial.energy),1e-9),
      normalWork:d.ledger.contactNormalWork,frictionWork:d.ledger.contactFrictionWork,positiveContactWork:d.ledger.positiveContactWork,
      seconds:(performance.now()-start)/1000,trace};
    row.status=classifyContactRow(row);return row;
  }finally{s.free();}
}
export function summarizeContact(rows){
  const checks=[];
  const compare=(a,b,kind)=>{
    if(!a||!b||a.error||b.error){checks.push({kind,a:a?.id,b:b?.id,status:'missing'});return;}
    const position=diff(a.final.position,b.final.position),velocity=diff(a.final.velocity,b.final.velocity),
      heat=Math.abs(a.heat-b.heat),impulse=Math.abs(a.normalImpulse-b.normalImpulse);
    const gpu=kind==='backend',posTol=gpu?5e-4:1e-5,velTol=gpu?.01:1e-4;
    const pass=position<posTol&&velocity<velTol&&heat<Math.max(.05,Math.abs(a.heat)*(gpu?.01:1e-4))
      &&impulse<Math.max(1e-4,Math.abs(a.normalImpulse)*(gpu?.01:1e-4))&&a.clock.requestCuts===0&&b.clock.requestCuts===0;
    checks.push({kind,backend:a.backend,a:a.id,b:b.id,position,velocity,heat,impulse,steps:[a.clock.steps,b.clock.steps],
      status:pass?'pass':'check'});
  };
  for(const backend of ['CPU','GPU']){
    const group=rows.filter(r=>r.backend===backend),base=group.find(r=>r.id==='impact-60');if(!base)continue;
    for(const id of ['impact-120','impact-irregular','impact-repeat'])compare(base,group.find(r=>r.id===id),'batch');
    for(const [kind,ids] of [['time',['impact-60','time-960','time-1920']],['grid',['grid-coarse','grid-medium','impact-60']]]){
      const series=ids.map(id=>group.find(r=>r.id===id));
      if(series.some(x=>!x||x.error)){checks.push({kind,backend,status:'missing'});continue;}
      for(const observable of ['displacement','impulse','heat']){
        const values=series.map(r=>observable==='displacement'?r.final.centers[0]-r.initial.centers[0]:observable==='impulse'?r.normalImpulse:r.heat);
        const coarse=Math.abs(values[1]-values[0]),fine=Math.abs(values[2]-values[1]),floor=observable==='displacement'?1e-5:observable==='impulse'?1e-4:.05;
        const relative=fine/Math.max(Math.abs(values[2]),floor);
        const equalMass=series.every(r=>diff(r.final.masses,series[0].final.masses)<1e-4);
        checks.push({kind,backend,observable,values,coarse,fine,relative,equalMass,
          actualSteps:series.map(r=>[r.clock.minDt,r.clock.maxDt]),
          status:equalMass&&(fine<=floor||(relative<.05&&fine<=coarse))?'consistent':'check'});
      }
    }
  }
  if(rows.some(r=>r.backend==='GPU'))for(const a of rows.filter(r=>r.backend==='CPU'))compare(a,rows.find(r=>r.backend==='GPU'&&r.id===a.id),'backend');
  return checks;
}
export function contactReport(rows){
  return {schema:'summer-contact-validation/1',version:CONTACT_VALIDATION_VERSION,createdAt:new Date().toISOString(),rows,checks:summarizeContact(rows),
    criteria:{maxOverlapFraction:.15,thermalResidual_J:1e-4,closedMomentumError:1e-4,closedAngularError:1e-4,maxSampledEnergyGain:.03,refinementRelativeChange:.05},
    notes:['Benchmarks use elastic MPM, disabled sampling and no phase change; these checks do not certify other constitutive laws, PBF or FEM.',
      'Compare contact impulse, not peaks averaged over different output intervals. Energy maxima are sampled at request boundaries.',
      'Prescribed off-grid stop times and load-curve events can cut a step and are counted separately; communication batches use integer clock ticks.',
      'Grid refinements retain geometry, density and 8 particles per cell. CHECK is retained; three levels do not establish continuum convergence.',
      'GPU uses float32 particles and float64 nodal accumulation. Reproducibility is measured with tolerances, not promised bitwise.']};
}
export async function runContactValidation(options={}){
  await initialize();const rows=[],plan=contactValidationPlan();
  for(const [index,spec] of plan.entries()){
    let row;
    try{row=await runContactRow(spec,{...options,progress:f=>options.progress?.({index,total:plan.length,case:spec.id,fraction:f})});}
    catch(error){row={...spec,backend:'CPU',status:'error',error:error.message};}
    rows.push(row);options.onRow?.(row,index);
  }
  return contactReport(rows);
}
export function contactValidationCSV(report){
  const keys=['backend','id','case','dt','cellSize','count','steps','minDt','maxDt','requestCuts','eventCuts','normalImpulse','heat','maxOverlap','maxThermalResidual','maxMomentumError','maxAngularError','maxEnergyGain','normalWork','frictionWork','positiveContactWork','seconds','status','error'];
  const cell=value=>`"${String(value??'').replaceAll('"','""')}"`;
  return [keys.join(','),...report.rows.map(r=>{const values={...r,...r.clock};return keys.map(k=>cell(values[k])).join(',');})].join('\n');
}
