"""Full 10k CUDA sliding impact: plastic/friction heat and domain energy balances.

This functional validation uses the authored demo without changing its physical
parameters. It is not a mesh-convergence or performance-comparison study.
"""
import argparse
import json
import math
import os
import subprocess
import time
import numpy as np
from runtime import initialize
from benchmark_mixed import compile_project,ROOT
from mixed_solver import MixedSolver


def check_result(result):
    rows=result['rows'];project=result['project'];last=rows[-1]
    block=next(p for p in project['parts'] if p['method']=='mpm')
    pair=project['contactPairs'][0]
    beta=block['material']['thermomechanical']['plasticHeatFraction']
    eta=pair['frictionHeatFraction'];split=pair['frictionHeatToA']
    assert result['backend']['arch']=='cuda','Validation must run on CUDA'
    assert all(r['count']==10000 for r in rows),'Demo must retain its 10,000 particles'
    assert abs(last['time']-project['solver']['duration'])<1e-8,'Incomplete cycle'
    assert all(r['finite'] for r in rows),'Nonfinite particle/FEM output'
    assert all(r['substepHostTransfers']==0 for r in rows),'Host transfers inside substeps'
    assert not any(l.get('enabled',True) and l['type'].startswith('thermal-') for l in project['loads']), 'Demo requires no external thermal loads'
    assert all(abs(r['externalHeat'])<1e-9 for r in rows),'Unexpected external thermal supply'
    assert last['plasticWork']>0 and last['plasticHeat']>0,'Plastic source not exercised'
    assert last['frictionLoss']>0 and last['frictionHeat']>0,'Friction source not exercised'
    assert last['maxPlasticStrain']>0,'No plastic constitutive response'
    assert max(r['normalForce'] for r in rows)>0,'No mechanical contact'
    tolerance=max(5e-5,abs(rows[0]['thermalEnergy'])*5e-11,last['generatedHeat']*5e-7)
    for r in rows:
        assert abs(r['plasticHeat']-beta*r['plasticWork'])<tolerance,'Plastic work-to-heat ratio'
        assert abs(r['frictionHeat']-eta*r['frictionLoss'])<tolerance,'Friction loss-to-heat ratio'
        assert abs(r['frictionHeatIntoMPM']-split*r['frictionHeat'])<tolerance,'MPM friction heat share'
        assert abs(r['frictionHeatIntoFEM']-(1-split)*r['frictionHeat'])<tolerance,'FEM friction heat share'
        assert abs(r['generatedHeat']-r['plasticHeat']-r['frictionHeat'])<tolerance,'Generated source sum'
        assert abs(r['generatedMPM']-r['plasticHeat']-r['frictionHeatIntoMPM'])<tolerance,'MPM source sum'
        assert abs(r['generatedFEM']-r['frictionHeatIntoFEM'])<tolerance,'FEM source sum'
        assert abs(r['heatResidual'])<tolerance,'Global thermal balance'
        assert abs(r['mpmHeatResidual'])<tolerance,'MPM thermal balance'
        assert abs(r['femHeatResidual'])<tolerance,'FEM thermal balance'
        for key in ['plasticWork','plasticHeat','frictionLoss','frictionHeat','generatedHeat']:
            assert r[key]>=-1e-12,f'Negative {key}'
    for a,b in zip(rows,rows[1:]):
        assert b['time']>a['time'],'Non-increasing time'
        for key in ['plasticWork','plasticHeat','frictionLoss','frictionHeat','generatedHeat']:
            assert b[key]>=a[key]-1e-10,f'Nonmonotone cumulative {key}'
    result['checks']=dict(heatToleranceJ=tolerance,maxHeatResidualJ=max(abs(r['heatResidual']) for r in rows),
        maxMPMHeatResidualJ=max(abs(r['mpmHeatResidual']) for r in rows),maxFEMHeatResidualJ=max(abs(r['femHeatResidual']) for r in rows),
        plasticHeatFraction=beta,frictionHeatFraction=eta,frictionHeatToMPM=split)
    result['passed']=True


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--check-existing',action='store_true')
    ap.add_argument('--output',default='artifacts/mixed-v050-dissipation.json')
    args=ap.parse_args();path=ROOT/args.output
    if args.check_existing:
        result=json.loads(path.read_text(encoding='utf-8'));check_result(result)
        path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
        print('PASS stored 10k CUDA plastic/friction heating cycle',flush=True)
        return
    source='import {mixedGPUDissipationProject as p} from "./src/mixed/gpu-model.js";console.log(JSON.stringify(p()));'
    project=json.loads(subprocess.check_output([os.environ.get('SUMMER_NODE','node'),'--input-type=module','-e',source],
        cwd=ROOT,text=True,encoding='utf-8',timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)))
    compiled=compile_project(project=project);project=compiled['project'];backend=initialize('cuda')
    started=time.perf_counter();solver=MixedSolver(compiled);rows=[]
    capacity=np.asarray(compiled['fem']['capacity'],dtype=float)
    initial_fem=None;initial_mpm=None;initial_temp=project['parts'][1]['initial']['temperature']

    def record(frame,particles):
        nonlocal initial_fem,initial_mpm
        part=frame['part'];thermal=frame['thermal'];g=thermal['generated'];pair=frame['contactPairs'][0]
        fem_temp=np.asarray(frame['state']['temperature'],dtype=float)
        fem_u=np.asarray(frame['state']['u'],dtype=float).reshape(-1,3)
        fem_v=np.asarray(frame['state']['v'],dtype=float).reshape(-1,3)
        mpm_energy=part['mass']*part['temperature']*solver.particle_cp
        fem_energy=float(capacity@fem_temp)
        if initial_mpm is None:initial_mpm=mpm_energy;initial_fem=fem_energy
        conduction=thermal['interfaceHeatIntoMPM']
        row=dict(time=frame['time'],count=part['count'],temperature=part['temperature'],minTemperature=part['minTemperature'],maxTemperature=part['maxTemperature'],
            meanTemperatureRise=part['temperature']-initial_temp,maxTemperatureRise=part['maxTemperature']-initial_temp,
            maxPlasticStrain=part['maxPlasticStrain'],meanPlasticStrain=part['meanPlasticStrain'],maxStress=part['maxStress'],
            mpmDisplacement=part['maxDisplacement'],femDisplacement=float(np.linalg.norm(fem_u,axis=1).max()),
            femMinTemperature=float(fem_temp.min()),femMaxTemperature=float(fem_temp.max()),
            normalForce=pair['normalForce'],slipSpeed=pair['slipSpeed'],impulse=pair['totalImpulse'],maxPenetration=pair['maxPenetration'],
            plasticWork=thermal['plasticWork'],plasticHeat=g['plastic'],frictionLoss=thermal['frictionLoss'],frictionHeat=g['friction'],
            frictionHeatIntoMPM=pair['accumulatedFrictionHeatIntoA'],frictionHeatIntoFEM=pair['accumulatedFrictionHeatIntoB'],
            generatedHeat=thermal['generatedHeat'],generatedMPM=g['mpm'],generatedFEM=g['fem'],
            interfaceHeatIntoMPM=conduction,externalHeat=thermal['externalHeat'],thermalEnergy=thermal['energy'],
            heatResidual=thermal['residual'],mpmHeatResidual=mpm_energy-initial_mpm-conduction-g['mpm'],femHeatResidual=fem_energy-initial_fem+conduction-g['fem'],
            solverMs=frame['performance']['solverMs'],snapshotMs=frame['performance']['snapshotMs'],substepHostTransfers=frame['performance']['substepHostTransfers'],
            finite=bool(np.isfinite(particles).all() and np.isfinite(fem_u).all() and np.isfinite(fem_v).all() and np.isfinite(fem_temp).all()))
        row['finite']=row['finite'] and all(math.isfinite(v) for v in row.values() if isinstance(v,(float,int)))
        rows.append(row)
        if len(rows)%10==1:print(json.dumps(row,allow_nan=False),flush=True)

    frame,particles=solver.snapshot();record(frame,particles)
    output_interval=project['solver'].get('outputInterval',.005)
    while solver.time<project['solver']['duration']-1e-9:
        frame,particles=solver.step(min(output_interval,project['solver']['duration']-solver.time));record(frame,particles)
    result=dict(version='0.50.0',backend=backend,project=project,rows=rows,performance=frame['performance'],
        elapsedSeconds=time.perf_counter()-started,steps=frame['clock']['steps'],passed=False,
        scope='10k fixed authored demo; physical source conversion and thermal accounting; no full mechanical energy or mesh convergence claim')
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    check_result(result)
    path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    print('PASS 10k CUDA sliding impact: plastic heat, friction heat, split and global/domain heat balances',flush=True)


if __name__=='__main__':main()
