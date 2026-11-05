import {initialize} from '../multibody/engine.js';
import {CoupledSimulation} from '../multibody/coupled.js';
import {LENGTH as L} from '../multibody/coupling-model.js';
import {MechanicalDiagnostics} from './mechanical-diagnostics.js';
import {ParticleEnergyObserver} from '../mixed/energy.js';

export const MPM_TRANSLATION_LIMITS=Object.freeze({positionError:1e-8,velocityError:1e-8,normalizedStress:1e-8,FDeviation:1e-8,relativeEnergyDrift:1e-8});
const configuration=()=>({cellSize:.1,particlesPerAxis:2,size:[.2,.2,.2],density:1100,velocity:[2,0,0],duration:.06,requestedDt:1/480,phaseFractions:[0,.25,.5]});

function engineFor(spec,phase){
  const engine=new CoupledSimulation({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[],joints:[],dt:spec.requestedDt,
    coupling:{enabled:true,thermal:false,mechanical:false,stiffness:1,
      domain:{lower:[-.4,0,-.4],upper:[.8,1,.4],cellSize:spec.cellSize,particlesPerAxis:spec.particlesPerAxis},
      parts:[{id:'translation-block',model:0,center:[0,.5,0],size:spec.size,density:spec.density,velocity:spec.velocity,sampling:{enabled:false}}]}});
  // The production seeder uses a world-aligned lattice. Translate its entire
  // initial cloud, rather than resampling, to vary only the grid phase while
  // preserving particle count, mass, spacing, geometry and identity F.
  const s=engine.particles,shift=phase*spec.cellSize;
  for(let i=0;i<s.count;i++){s.x[i]+=shift/L;s.ax[i]+=shift/L;}
  engine.model.coupling.parts[0].center[0]+=shift;
  return engine;
}

export async function runMPMTranslationCheck({progress=()=>{},onProgress=()=>{},onRow=()=>{},yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0)),signal,timeBudgetMs=10000,maxSteps=10000}={}){
  if(!Number.isFinite(timeBudgetMs)||timeBudgetMs<=0||!Number.isInteger(maxSteps)||maxSteps<1)throw Error('MPM validation budget must be positive');
  const spec=configuration(),rows=[],started=performance.now();let usedSteps=0,stopped=null;
  const budgetReason=()=>signal?.aborted?'aborted':performance.now()-started>=timeBudgetMs?'time-budget-exhausted':usedSteps>=maxSteps?'step-budget-exhausted':null;
  const notify=fraction=>{progress(fraction);onProgress({id:'mpm-translation',fraction});};
  if(!budgetReason())await initialize();
  for(const [index,phase] of spec.phaseFractions.entries()){
    stopped=budgetReason();if(stopped)break;
    const engine=engineFor(spec,phase),s=engine.particles,d=new MechanicalDiagnostics(engine),observer=new ParticleEnergyObserver(s,[0,0,0]);
    s.energyObserver=observer;
    try{
      const initial=Array.from({length:s.count},(_,i)=>[s.x[i]*L,s.y[i]*L,s.z[i]*L]);
      const first=d.sample(engine.snapshot());let diagnostic=first,positionError=0,velocityError=0,maxNormalizedStress=0,maxFDeviation=0,maxEnergyDrift=0;
      const measure=()=>{
        for(let i=0;i<s.count;i++){
          positionError=Math.max(positionError,Math.hypot(...['x','y','z'].map((k,a)=>s[k][i]*L-initial[i][a]-spec.velocity[a]*engine.time)));
          velocityError=Math.max(velocityError,Math.hypot(...['vx','vy','vz'].map((k,a)=>s[k][i]*L-spec.velocity[a])));
          maxNormalizedStress=Math.max(maxNormalizedStress,Math.abs(s.mpm.stress[i]));
          for(let k=0;k<9;k++)maxFDeviation=Math.max(maxFDeviation,Math.abs(s.mpm.F[9*i+k]-(k%4===0?1:0)));
        }
        maxEnergyDrift=Math.max(maxEnergyDrift,Math.abs(diagnostic.energyChange));
      };
      measure();let intervals=0;
      while(engine.time<spec.duration-1e-12){
        stopped=budgetReason();if(stopped)break;
        const before=engine.steps,frame=engine.step(Math.min(spec.requestedDt,spec.duration-engine.time));usedSteps+=engine.steps-before;diagnostic=d.sample(frame);measure();intervals++;
        if(intervals%12===0){notify((index+engine.time/spec.duration)/spec.phaseFractions.length);await yieldControl();}
      }
      const relativeEnergyDrift=maxEnergyDrift/Math.max(1e-30,Math.abs(first.mechanicalEnergy)),health=diagnostic.particleHealth;
      const row={phaseFraction:phase,phaseOffset:phase*spec.cellSize,particleCount:s.count,mass:engine.snapshot().coupling.mass,
        duration:engine.time,travelDistance:spec.velocity[0]*engine.time,travelCells:spec.velocity[0]*engine.time/spec.cellSize,
        positionError,velocityError,maxNormalizedStress,maxFDeviation,maxEnergyDrift,relativeEnergyDrift,
        transferWork:{...observer.values},physicalSubsteps:diagnostic.physicalSubsteps,minSubstep:diagnostic.minSubstep,maxSubstep:diagnostic.maxSubstep,
        regularization:{solidAntiClump:s.settings.solidAntiClump,source:'production-default',initialRandomSampling:false},particleHealth:health};
      const finite=[positionError,velocityError,maxNormalizedStress,maxFDeviation,relativeEnergyDrift].every(Number.isFinite);
      row.status=stopped?'inconclusive':finite&&!health.nonfiniteParticles&&!health.invalidJCount&&positionError<=MPM_TRANSLATION_LIMITS.positionError&&velocityError<=MPM_TRANSLATION_LIMITS.velocityError&&maxNormalizedStress<=MPM_TRANSLATION_LIMITS.normalizedStress&&maxFDeviation<=MPM_TRANSLATION_LIMITS.FDeviation&&relativeEnergyDrift<=MPM_TRANSLATION_LIMITS.relativeEnergyDrift?'pass':'check';
      rows.push(row);onRow(row,index);if(stopped)break;notify((index+1)/spec.phaseFractions.length);
    }finally{engine.free();}
  }
  const spread=key=>rows.length?Math.max(...rows.map(r=>r[key]))-Math.min(...rows.map(r=>r[key])):null;
  const checks=rows.flatMap(r=>[['positionError',MPM_TRANSLATION_LIMITS.positionError],['velocityError',MPM_TRANSLATION_LIMITS.velocityError],['maxNormalizedStress',MPM_TRANSLATION_LIMITS.normalizedStress],['maxFDeviation',MPM_TRANSLATION_LIMITS.FDeviation],['relativeEnergyDrift',MPM_TRANSLATION_LIMITS.relativeEnergyDrift]].map(([key,tolerance])=>({name:`phase ${r.phaseFraction} h: ${key}`,value:r[key],tolerance,passed:Number.isFinite(r[key])&&r[key]<=tolerance})));
  return {schema:'summer-vv-mpm-translation/1',id:'mpm-translation',title:'MPM uniform translation / grid phase',backend:'cpu',reference:'x(t) = x(0) + v t; v = constant; F = I; stress = 0; mechanical energy = constant',
    assumptions:['Zero gravity, contact, external force and thermal forcing.','Same elastic block, density, particle spacing and particle identities in every phase.','Initial cloud shifted relative to fixed background grid; no phase-dependent reseeding.'],
    resolutions:rows.map(r=>({phaseFraction:r.phaseFraction,cellSize:spec.cellSize,particlesPerAxis:spec.particlesPerAxis,particleCount:r.particleCount,physicalSubsteps:r.physicalSubsteps,minSubstep:r.minSubstep,maxSubstep:r.maxSubstep})),checks,
    configuration:spec,thresholds:{...MPM_TRANSLATION_LIMITS},rows,status:stopped||rows.length!==3?'inconclusive':rows.every(r=>r.status==='pass')?'passed':'failed',stopReason:stopped,physicalSubsteps:usedSteps,seconds:(performance.now()-started)/1000,
    phaseSensitivity:{positionErrorSpread:spread('positionError'),normalizedStressSpread:spread('maxNormalizedStress'),FDeviationSpread:spread('maxFDeviation'),energyDriftSpread:spread('relativeEnergyDrift')},
    limitations:['This checks zero-stress uniform translation across more than one grid cell at three initial grid phases.',
      'It does not establish the absence of cell-crossing noise under nonuniform stress, contact or plastic deformation.',
      'Production solid position regularization remains enabled and is reported; this is not a regularization-off comparison.',
      'No GPU solver is measured by this CPU benchmark.']};
}
