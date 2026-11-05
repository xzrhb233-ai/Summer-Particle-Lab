import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalHistoryCSV} from '../src/simulation/thermal-history.js';
import {mixedEnergyCSV} from '../src/mixed/energy.js';
import {mixedGPUDissipationProject,mixedParticleSeed} from '../src/mixed/gpu-model.js';

test('dissipation demo starts at equal temperatures without external heaters',()=>{
  const p=mixedGPUDissipationProject();assert.equal(mixedParticleSeed(p).points.length,10000);
  assert.ok(p.parts.every(b=>b.initial.temperature===20));
  assert.ok(!p.loads.some(l=>l.enabled&&l.type.startsWith('thermal-')));
  assert.equal(p.parts[1].material.thermomechanical.plasticHeatFraction,.9);
  assert.equal(p.contactPairs[0].frictionHeatFraction,1);
});
test('thermal exports separate generated heat from signed conductive exchange and external heat',()=>{
  const f={time:.1,results:{parts:[{id:'mpm',method:'mpm',values:{temperature:20.0003,minTemperature:20,maxTemperature:20.001}}]},
    thermal:{externalHeat:-2,residual:1e-8,plasticWork:10,frictionLoss:5,generatedHeat:14,generated:{plastic:9,friction:5,mpm:11.5,fem:2.5}},
    contactPairs:[{id:'pair',totalImpulse:[1,2,3],accumulatedHeat:-7,heatRate:-70}],coupling:{count:10000},fem:{parts:[{summary:{maxDisplacement:.01}}]},
    mixed:{backend:{arch:'cuda'},clock:{steps:100,minDt:.0001,maxDt:.0001},performance:{solverMs:100,snapshotMs:1,frameBytes:320000,substepHostTransfers:0}}};
  for(const csv of [thermalHistoryCSV([f],'mpm','pair'),mixedEnergyCSV([f])]){
    const [head,row]=csv.split('\n').map(s=>s.split(','));assert.equal(head.length,row.length);
    const v=Object.fromEntries(head.map((k,i)=>[k,row[i]]));
    for(const [k,value] of Object.entries({external_heat_J:'-2',plastic_work_J:'10',plastic_heat_J:'9',friction_loss_J:'5',friction_heat_J:'5',generated_heat_J:'14',generated_into_MPM_J:'11.5',generated_into_FEM_J:'2.5'}))assert.equal(v[k],value);
    if('mechanical_residual_J' in v)assert.equal(v.mechanical_residual_J,'');
    if('interface_into_B_J' in v)assert.equal(v.interface_into_B_J,'7');
    if('heat_into_mpm_J' in v)assert.equal(v.heat_into_mpm_J,'-7');
  }
  delete f.thermal.generatedHeat;delete f.thermal.generated;delete f.thermal.plasticWork;delete f.thermal.frictionLoss;
  const [head,row]=thermalHistoryCSV([f],'mpm','pair').split('\n').map(s=>s.split(','));
  assert.equal(row[head.indexOf('generated_heat_J')],'');
});
