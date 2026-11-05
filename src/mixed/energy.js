import {particleMechanics} from '../simulation/mechanical-diagnostics.js';

const total=p=>p.kinetic+p.affine+p.potential+p.knownElastic;
// Read-only operator observer. It neither changes the solver state nor closes
// the balance by assigning its residual to a fictitious dissipation term.
export class ParticleEnergyObserver{
  constructor(s,gravity){this.s=s;this.gravity=gravity;this.values={p2g:0,g2p:0,gridBoundary:0,postprocess:0,regularization:0,phase:0,stressStrain:0};this.incomplete=false;}
  sample(){const p=particleMechanics(this.s,this.gravity);if(p.unsupported)this.incomplete=true;return p;}
  mark(){return total(this.sample());}
  record(key,before){this.values[key]+=this.mark()-before;}
  solidK(){const s=this.s,D=(s.mpm.H*.025)**2/4;let K=0;
    for(let i=0;i<s.count;i++)if(s.isSolid(i)){K+=.5*s.mass[i]*((s.vx[i]**2+s.vy[i]**2+s.vz[i]**2)*.025**2+D*s.mpm.C.subarray(i*9,i*9+9).reduce((a,x)=>a+x*x,0));}return K;}
  begin(grid){this.initialK=this.solidK();this.initialElastic=this.sample().knownElastic;
    for(const f of grid.fields??[grid]){f.energyMomentum??=new Float64Array(f.v.length);f.energyMomentum.fill(0);}}
  gridK(grid,momentum=false,unforced=false){let K=0;
    for(const f of grid.fields??[grid])for(let n=0;n<f.mass.length;n++)if(f.mass[n]>1e-12){const v=unforced?f.energyMomentum:f.v;K+=.5*(momentum?1/f.mass[n]:f.mass[n])*(v[n*3]**2+v[n*3+1]**2+v[n*3+2]**2)*.025**2;}return K;}
  p2g(grid){const free=this.gridK(grid,true,true);this.stressed=this.gridK(grid,true);this.values.p2g+=free-this.initialK;this.stressWork=this.stressed-free;}
  grid(grid){this.gridEnergy=this.gridK(grid);this.values.gridBoundary+=this.gridEnergy-this.stressed;}
  g2p(){this.values.g2p+=this.solidK()-this.gridEnergy;this.values.stressStrain+=this.stressWork+this.sample().knownElastic-this.initialElastic;}
  backup(){return {values:{...this.values},incomplete:this.incomplete};}
  restore(b){this.values={...b.values};this.incomplete=b.incomplete;}
}

export class MixedEnergy{
  constructor(sim){this.sim=sim;this.observer=new ParticleEnergyObserver(sim.mpm.particles,sim.project.environment.gravity);sim.mpm.particles.energyObserver=this.observer;
    const p=this.observer.sample(),f=sim.fem.snapshot().fem.dynamics;this.initial=total(p)+f.initialEnergy+sim.mpm.snapshot().energy;}
  snapshot(f,particles,pairs,thermal,exchanges,rigid={energy:0,kinetic:0,potential:0,springEnergy:0,bodies:[]}){
    const o=this.observer,reasons=[];if(o.incomplete||particles.unsupported)reasons.push('unsupported-material-or-phase-energy');if(rigid.bodies.length)reasons.push('rigid-constraint-work-not-audited');
    const complete=!reasons.length,E=total(particles)+f.mechanicalEnergy+rigid.energy;
    const physical={femDamping:f.dissipated-(f.contactDissipated??0),femContact:f.contactDissipated??0,normal:pairs.reduce((a,p)=>a+p.normalLoss,0),friction:pairs.reduce((a,p)=>a+p.frictionLoss,0)};
    physical.total=physical.femDamping+physical.femContact+physical.normal+physical.friction;
    const v=o.values,numerical={p2g:v.p2g,g2p:v.g2p,gridBoundary:v.gridBoundary,postprocess:v.postprocess,regularization:v.regularization,phase:v.phase,
      positionCorrection:pairs.reduce((a,p)=>a+p.correctionWork+p.particleCorrectionWork,0)};
    numerical.total=Object.values(numerical).reduce((a,x)=>a+x,0);
    const partial=E+physical.total-this.initial-f.externalWork-f.thermalWork,raw=complete?partial:null;
    return {schema:'coupled-energy/1',scope:rigid.bodies.length?'rigid-particle-fem-system':'mpm-fem-system',complete,reasons,
      initial:this.initial,mechanical:complete?E:null,knownMechanical:E,unsupportedParticles:particles.unsupported,particleHealth:particles.particleHealth??null,
      storage:{mpmKinetic:particles.kinetic,mpmAffine:particles.affine,mpmPotential:particles.potential,mpmElastic:particles.elastic,femKinetic:f.kinetic,femElastic:f.energy,femContact:f.contactEnergy??0,rigidKinetic:rigid.kinetic,rigidPotential:rigid.potential,rigidSpring:rigid.springEnergy},
      externalWork:f.externalWork,thermalWork:f.thermalWork,physical,numerical,rawResidual:raw,knownTermsResidual:partial,
      unexplainedResidual:complete?raw-numerical.total:null,mpmStressStrainError:complete?v.stressStrain:null,
      relativeResidual:complete?(raw-numerical.total)/Math.max(1e-12,Math.abs(this.initial),Math.abs(E),Math.abs(f.externalWork),Math.abs(f.thermalWork)):null,
      interfaceWorkResidual:exchanges.pairs.reduce((a,p)=>a+p.workResidual,0),thermalResidual:thermal.residual,
      heatConversion:false};
  }
}

// These thresholds flag an observation to inspect, not a convergence failure.
// Both tests are required so a nearly zero reference energy cannot turn a tiny
// absolute roundoff imbalance into a large relative warning.
export function mixedEnergyAlerts(energy){
  if(energy?.enabled!==true)return [];
  const alerts=new Set(),reasons=[...(energy.reasons??[]),...(energy.coverage?.reasons??[])];
  if(!energy.complete)alerts.add('incomplete-mechanical-coverage');
  for(const reason of ['normal-contact-injected-energy','constitutive-energy-clamp-active','non-finite-energy-observation'])if(reasons.includes(reason))alerts.add(reason);
  const values=[energy.initial,energy.mechanical,energy.knownMechanical,energy.externalWork,energy.thermalWork,energy.rawResidual,energy.unexplainedResidual,energy.relativeResidual,...Object.values(energy.storage??{}),...Object.values(energy.physical??{}),...Object.values(energy.numerical??{})];
  if(values.some(x=>typeof x==='number'&&!Number.isFinite(x)))alerts.add('non-finite-energy-observation');
  if(energy.complete&&Number.isFinite(energy.relativeResidual)&&Number.isFinite(energy.unexplainedResidual)&&Math.abs(energy.relativeResidual)>.05&&Math.abs(energy.unexplainedResidual)>1e-6)alerts.add('substantial-mechanical-residual');
  return [...alerts];
}

export function mixedEnergyCSV(frames){
  if(frames.some(f=>f.mixed?.backend)){
    const rows=['time_s,backend,particles,fem_displacement_m,impulse_x_Ns,impulse_y_Ns,impulse_z_Ns,heat_into_mpm_J,external_heat_J,heat_residual_J,mechanical_residual_J,shared_steps,min_dt_s,max_dt_s,solver_ms,output_ms,frame_bytes,substep_host_transfers,plastic_work_J,plastic_heat_J,friction_loss_J,friction_heat_J,generated_heat_J,generated_into_MPM_J,generated_into_FEM_J,energy_diagnostics_enabled,mechanical_scope,mechanical_complete,initial_mechanical_J,mechanical_J,known_mechanical_J,mpm_kinetic_J,mpm_affine_J,mpm_potential_J,mpm_elastic_J,fem_kinetic_J,fem_elastic_J,external_work_J,temperature_parameter_work_J,normal_loss_J,fem_damping_J,physical_loss_J,p2g_work_J,g2p_work_J,grid_boundary_work_J,position_correction_work_J,plastic_return_work_J,numerical_work_J,known_raw_residual_J,raw_mechanical_residual_J,known_remaining_residual_J,relative_mechanical_residual,mpm_stress_strain_error_J,gravity_integration_residual_J,fem_integration_residual_J,coverage_reasons,thermodynamic_complete'];
    const cell=x=>x==null?'':typeof x==='number'?(Number.isFinite(x)?x:''):typeof x==='boolean'?(x?1:0):/[",\r\n]/.test(x)?'"'+String(x).replaceAll('"','""')+'"':x;
    for(const f of frames){if(!f.mixed?.backend)continue;const m=f.mixed,p=m.performance,c=m.clock,pair=f.contactPairs[0];
      const t=f.thermal,e=m.energy,active=e?.enabled===true,complete=active&&e.complete===true,s=active?e.storage:{},loss=active?e.physical:{},n=active?e.numerical:{};
      rows.push([f.time,m.backend.arch,f.coupling.count,Math.max(...f.fem.parts.map(p=>p.summary.maxDisplacement)),...pair.totalImpulse,pair.accumulatedHeat,t.externalHeat,t.residual,complete?e.unexplainedResidual:null,c.steps,c.minDt,c.maxDt,p.solverMs,p.snapshotMs,p.frameBytes,p.substepHostTransfers,loss?.plastic??t.plasticWork,t.generated?.plastic,loss?.friction??t.frictionLoss,t.generated?.friction,t.generatedHeat,t.generated?.mpm,t.generated?.fem,
        e?.enabled,e?.scope,e?complete:null,active?e.initial:null,active?e.mechanical:null,active?e.knownMechanical:null,s?.mpmKinetic,s?.mpmAffine,s?.mpmPotential,s?.mpmElastic,s?.femKinetic,s?.femElastic,
        active?e.externalWork:null,active?e.thermalWork:null,loss?.normal,loss?.femDamping,loss?.total,n?.p2g,n?.g2p,n?.gridBoundary,n?.positionCorrection,n?.plasticReturn,n?.total,
        active?e.knownTermsResidual:null,complete?e.rawResidual:null,active?e.knownUnexplainedResidual:null,complete?e.relativeResidual:null,active?e.mpmStressStrainError:null,active?e.gravityIntegrationResidual:null,active?e.femIntegrationResidual:null,
        e?[...new Set([...(e.reasons??[]),...(e.coverage?.reasons??[])])].join(';'):null,e?.coverage?.totalThermodynamic].map(cell).join(','));}
    return rows.join('\n');
  }
  const keys=['time_s','complete','initial_J','mechanical_J','mpm_kinetic_J','mpm_affine_J','mpm_elastic_J','fem_kinetic_J','fem_elastic_J','external_work_J','thermal_work_J','fem_damping_J','normal_loss_J','friction_loss_J','p2g_work_J','g2p_work_J','grid_boundary_work_J','postprocess_work_J','regularization_work_J','phase_work_J','position_correction_work_J','raw_residual_J','unexplained_residual_J','stress_strain_error_J','interface_work_residual_J','heat_residual_J','shared_steps','min_dt_s','max_dt_s','domain_drift_s','coverage_reasons','fem_contact_storage_J','fem_contact_loss_J'];
  const rows=[keys.join(',')];for(const f of frames){const e=f.mixed?.energy,c=f.mixed?.clock;if(!e)continue;const s=e.storage,n=e.numerical,p=e.physical;
    rows.push([f.time,e.complete,e.initial,e.mechanical,s.mpmKinetic,s.mpmAffine,s.mpmElastic,s.femKinetic,s.femElastic,e.externalWork,e.thermalWork,p.femDamping,p.normal,p.friction,n.p2g,n.g2p,n.gridBoundary,n.postprocess,n.regularization,n.phase,n.positionCorrection,e.rawResidual,e.unexplainedResidual,e.mpmStressStrainError,e.interfaceWorkResidual,e.thermalResidual,c.steps,c.minDt,c.maxDt,c.maxDrift,e.reasons.join(';'),s.femContact??0,p.femContact??0].map(x=>x??'').join(','));}
  return rows.join('\n');
}
