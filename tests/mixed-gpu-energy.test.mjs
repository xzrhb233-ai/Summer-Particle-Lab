import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedImpactProject,editMixedParticles,projectDomains} from '../src/mixed/model.js';
import {validateMixedGPU,mixedGPUDissipationProject,mixedGPUEnergyProject} from '../src/mixed/gpu-model.js';
import {FEMDynamicSimulation,FEMHistory} from '../src/fem/dynamic.js';
import {convertMixedGPUFrame} from '../src/mixed/gpu-adapter.js';
import {mixedEnergyCSV,mixedEnergyAlerts} from '../src/mixed/energy.js';

const ledger=()=>({
  schema:'coupled-energy/1',scope:'recoverable-mpm-fem-mechanics',enabled:true,complete:true,reasons:[],
  storage:{mpmKinetic:11,mpmAffine:2,mpmPotential:-3,mpmElastic:4,femKinetic:5,femElastic:6},
  initial:24,mechanical:25,knownMechanical:25,externalWork:7,thermalWork:2,
  physical:{normal:1,friction:2,plastic:3,femDamping:4,total:10},
  numerical:{p2g:-.4,g2p:-.3,gridBoundary:-.2,positionCorrection:.6,plasticReturn:-.1,total:-.4},
  rawResidual:2,knownTermsResidual:2,unexplainedResidual:2.4,knownUnexplainedResidual:2.4,relativeResidual:.096,
  mpmStressStrainError:1.1,gravityIntegrationResidual:.2,femIntegrationResidual:1.1,thermalResidual:1e-9,
  heatConversion:true,coverage:{recoverableMechanical:true,totalThermodynamic:false,reasons:['weak-thermoelastic-feedback','untracked-cold-work']}
});
function withDisplayFrame(fn){
  const project=validateMixedGPU(mixedImpactProject()),local=new FEMDynamicSimulation(projectDomains(project).fem),s=local.states[0];
  const raw={time:.1,state:{u:Array.from(s.u),v:Array.from(s.v),temperature:Array.from(s.thermal.temperature)},
    particles:new Float32Array(64*8),part:{id:'hot-block',count:64,temperature:20,minTemperature:20,maxTemperature:20.001},
    backend:{arch:'cuda',device:'synthetic result'},clock:{steps:1000,minDt:.0001,maxDt:.0001,baseDt:.0001,maxDrift:0},
    performance:{solverMs:40,snapshotMs:2,frameBytes:2048,substepHostTransfers:0},
    thermal:{externalHeat:19,residual:1e-9,plasticWork:3,frictionLoss:2,generatedHeat:4.7,generated:{plastic:2.7,friction:2,mpm:3.7,fem:1}},thermalLoads:[],
    contactPairs:[{id:'block-beam',totalImpulse:[1,2,3],accumulatedHeat:-8}],energy:ledger()};
  try{return fn(project,local,raw);}finally{local.free();}
}
const csvValues=frame=>{
  const [header,row]=mixedEnergyCSV([frame]).split('\n').map(x=>x.split(','));
  assert.equal(header.length,row.length);return Object.fromEntries(header.map((key,i)=>[key,row[i]]));
};

test('GPU energy diagnostics are opt-in and survive authored project roundtrips',()=>{
  const legacy=validateMixedGPU(mixedImpactProject());assert.notEqual(legacy.solver.diagnostics,true);
  const demo=mixedGPUEnergyProject(),plain=mixedGPUDissipationProject();
  assert.equal(demo.solver.diagnostics,true);
  const a=structuredClone(demo),b=structuredClone(plain);delete a.name;delete b.name;delete a.solver.diagnostics;delete b.solver.diagnostics;
  assert.deepEqual(a,b,'diagnostic demo must preserve the physical initial state');
  for(const enabled of [true,false]){
    demo.solver.diagnostics=enabled;
    const decoded=validateMixedGPU(JSON.parse(JSON.stringify(demo))),edited=editMixedParticles(decoded,x=>x);
    assert.equal(decoded.solver.diagnostics,enabled);assert.equal(edited.solver.diagnostics,enabled);
  }
  demo.solver.diagnostics='false';assert.throws(()=>validateMixedGPU(demo),/布尔/);
});

test('GPU global ledger reaches results/history without inventing a FEM-only work ledger',()=>withDisplayFrame((p,local,raw)=>{
  const f=convertMixedGPUFrame(p,local,raw),b=f.results.balance;
  assert.deepEqual(f.mixed.energy,raw.energy);
  assert.equal(b.energyScope,'recoverable-mpm-fem-mechanics');assert.equal(b.energyResidual,2.4);assert.equal(b.rawEnergyResidual,2);
  assert.equal(b.mechanicalEnergy,25);assert.equal(b.kinetic,18);assert.equal(b.energy,10);assert.equal(b.potential,-3);
  assert.equal(b.dissipated,10);assert.equal(b.numericalWork,-.4);assert.equal(b.thermalWork,2);assert.equal(b.externalHeat,19);assert.equal(b.generatedHeat,4.7);
  for(const key of ['energyResidual','externalWork','thermalWork','dissipated','contactWork']){
    assert.equal(f.fem.dynamics[key],null);assert.equal(f.fem.parts[0].summary[key],null);
  }
  assert.equal(f.fem.dynamics.interfaceWork,null);assert.equal(f.fem.dynamics.energyScope,'gpu-fem-subdomain-ledger-unavailable');
  const h=new FEMHistory();h.record(f,true);assert.deepEqual(h.samples[0].mixed.energy,raw.energy);
}));

test('old, disabled and incomplete GPU frames retain heat but never fabricate a full mechanical residual',()=>withDisplayFrame((p,local,raw)=>{
  delete raw.energy;let f=convertMixedGPUFrame(p,local,raw);
  assert.equal(f.mixed.energy,null);assert.equal(f.results.balance.energyResidual,null);assert.equal(f.results.balance.mechanicalEnergy,null);
  assert.equal(f.results.balance.generatedHeat,4.7);
  raw.energy={enabled:false,complete:false,reasons:['diagnostics-disabled']};f=convertMixedGPUFrame(p,local,raw);
  assert.equal(f.results.balance.kinetic,null);assert.equal(f.results.balance.externalWork,null);assert.equal(f.results.balance.thermalResidual,1e-9);
  raw.energy={...ledger(),complete:false,mechanical:null,rawResidual:null,unexplainedResidual:null,relativeResidual:null,reasons:['unsupported-recoverable-material-energy']};
  f=convertMixedGPUFrame(p,local,raw);
  assert.equal(f.results.balance.energyResidual,null);assert.equal(f.results.balance.rawEnergyResidual,null);assert.equal(f.results.balance.knownMechanicalResidual,2.4);
}));

test('GPU energy CSV keeps signed work, physical loss and generated heat in distinct columns',()=>withDisplayFrame((p,local,raw)=>{
  const v=csvValues(convertMixedGPUFrame(p,local,raw));
  for(const [key,value] of Object.entries({energy_diagnostics_enabled:'1',mechanical_complete:'1',thermodynamic_complete:'0',
    mechanical_residual_J:'2.4',raw_mechanical_residual_J:'2',relative_mechanical_residual:'0.096',
    external_work_J:'7',temperature_parameter_work_J:'2',external_heat_J:'19',heat_into_mpm_J:'-8',
    physical_loss_J:'10',normal_loss_J:'1',plastic_work_J:'3',plastic_heat_J:'2.7',friction_loss_J:'2',friction_heat_J:'2',generated_heat_J:'4.7',
    p2g_work_J:'-0.4',g2p_work_J:'-0.3',grid_boundary_work_J:'-0.2',position_correction_work_J:'0.6',plastic_return_work_J:'-0.1',numerical_work_J:'-0.4',
    mpm_stress_strain_error_J:'1.1',gravity_integration_residual_J:'0.2',fem_integration_residual_J:'1.1'}))assert.equal(v[key],value,key);
  assert.equal(v.coverage_reasons,'weak-thermoelastic-feedback;untracked-cold-work');
}));

test('old and incomplete energy exports use blank unmeasured fields while preserving known terms',()=>withDisplayFrame((p,local,raw)=>{
  delete raw.energy;let v=csvValues(convertMixedGPUFrame(p,local,raw));
  for(const key of ['energy_diagnostics_enabled','mechanical_complete','mechanical_residual_J','p2g_work_J','temperature_parameter_work_J','thermodynamic_complete'])assert.equal(v[key],'',key);
  assert.equal(v.generated_heat_J,'4.7');assert.equal(v.friction_loss_J,'2');
  raw.energy={enabled:false,complete:false,reasons:['diagnostics-disabled']};v=csvValues(convertMixedGPUFrame(p,local,raw));
  assert.equal(v.energy_diagnostics_enabled,'0');assert.equal(v.mechanical_complete,'0');assert.equal(v.p2g_work_J,'');
  raw.energy={...ledger(),complete:false,mechanical:null,rawResidual:null,unexplainedResidual:null,relativeResidual:null,reasons:['unsupported-recoverable-material-energy']};
  v=csvValues(convertMixedGPUFrame(p,local,raw));
  for(const key of ['mechanical_residual_J','mechanical_J','raw_mechanical_residual_J','relative_mechanical_residual'])assert.equal(v[key],'',key);
  assert.equal(v.known_mechanical_J,'25');assert.equal(v.known_remaining_residual_J,'2.4');
}));

test('energy warnings require meaningful absolute and relative residuals and retain operator anomalies',()=>{
  assert.deepEqual(mixedEnergyAlerts(null),[]);assert.deepEqual(mixedEnergyAlerts({enabled:false}),[]);
  assert.deepEqual(mixedEnergyAlerts({...ledger(),relativeResidual:.5,unexplainedResidual:1e-12}),[]);
  assert.deepEqual(mixedEnergyAlerts({...ledger(),relativeResidual:.001,unexplainedResidual:100}),[]);
  assert.deepEqual(mixedEnergyAlerts({...ledger(),relativeResidual:-.1,unexplainedResidual:-.01}),['substantial-mechanical-residual']);
  const e={...ledger(),complete:false,relativeResidual:null,unexplainedResidual:null,reasons:['unsupported-recoverable-material-energy','normal-contact-injected-energy','constitutive-energy-clamp-active','non-finite-energy-observation']};
  assert.deepEqual(mixedEnergyAlerts(e),['incomplete-mechanical-coverage','normal-contact-injected-energy','constitutive-energy-clamp-active','non-finite-energy-observation']);
  assert.ok(mixedEnergyAlerts({...ledger(),relativeResidual:0,unexplainedResidual:NaN}).includes('non-finite-energy-observation'));
});
