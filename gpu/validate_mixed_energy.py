"""10k CUDA energy ledger and observer-on/off functional comparison.

This records integration residuals rather than requiring numerical energy
conservation. It is not a convergence or isolated GPU throughput study.
Run each mode in a separate process so allocations and kernel caches are fair.
"""
import argparse
import json
import math
import os
import subprocess
import time
import numpy as np
from runtime import initialize
from benchmark_mixed import compile_project, ROOT
from mixed_solver import MixedSolver


def compare(enabled_path, disabled_path):
    on=json.loads(enabled_path.read_text(encoding='utf-8'))
    off=json.loads(disabled_path.read_text(encoding='utf-8'))
    a=np.load(enabled_path.with_suffix('.npz'))
    b=np.load(disabled_path.with_suffix('.npz'))
    assert len(on['rows'])==len(off['rows'])
    difference={key:float(np.max(np.abs(a[key]-b[key]))) for key in a.files}
    # CUDA atomic summation order may differ between independent executions.
    assert difference['position']<2e-4, difference
    assert difference['velocity']<.02, difference
    assert difference['femU']<2e-5, difference
    assert difference['temperature']<2e-5, difference
    assert difference['femT']<2e-5, difference
    for run in [on,off]:
        project=run['project'];beta=project['parts'][1]['material']['thermomechanical']['plasticHeatFraction']
        eta=project['contactPairs'][0]['frictionHeatFraction'];split=project['contactPairs'][0]['frictionHeatToA']
        for row in run['rows']:
            t=row['thermal'];g=t['generated']
            assert abs(g['plastic']-beta*t['plasticWork'])<1e-5
            assert abs(g['friction']-eta*t['frictionLoss'])<1e-5
            assert abs(g['mpm']-g['plastic']-split*g['friction'])<1e-5
            assert abs(g['fem']-(1-split)*g['friction'])<1e-5
            assert abs(t['generatedHeat']-g['mpm']-g['fem'])<1e-5
            assert abs(t['residual'])<1e-4
    warm_on=sum(r['solverMs'] for r in on['rows'][3:])
    warm_off=sum(r['solverMs'] for r in off['rows'][3:])
    result=dict(passed=True,maxAbsoluteDifferences=difference,
        maxHeatResidualJ=max(abs(r['thermal']['residual']) for run in [on,off] for r in run['rows']),
        sourceConversionChecked=True,
        diagnosticSolverMs=warm_on,disabledSolverMs=warm_off,
        diagnosticCostRatio=warm_on/warm_off,
        measurement='Same 10k authored cycle; separate processes; excludes first two output intervals; other GPU services may be active')
    path=ROOT/'artifacts/mixed-v051-observer-comparison.json'
    path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps(result),flush=True)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--disabled',action='store_true')
    ap.add_argument('--compare',action='store_true')
    args=ap.parse_args()
    enabled=ROOT/'artifacts/mixed-v051-energy.json'
    disabled=ROOT/'artifacts/mixed-v051-disabled.json'
    if args.compare:
        compare(enabled,disabled)
        return
    source='import {mixedGPUEnergyProject as p} from "./src/mixed/gpu-model.js";console.log(JSON.stringify(p()));'
    project=json.loads(subprocess.check_output([os.environ.get('SUMMER_NODE','node'),'--input-type=module','-e',source],
        cwd=ROOT,text=True,encoding='utf-8',timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)))
    project['solver']['diagnostics']=not args.disabled
    compiled=compile_project(project=project)
    backend=initialize('cuda');started=time.perf_counter();solver=MixedSolver(compiled);rows=[]

    def record(frame, particles):
        thermal=frame['thermal'];energy=frame.get('energy')
        assert np.isfinite(particles).all()
        assert all(np.isfinite(frame['state'][key]).all() for key in ['u','v','temperature'])
        assert frame['part']['count']==10000
        assert frame['performance']['substepHostTransfers']==0
        assert abs(thermal['residual'])<1e-4
        if args.disabled:
            assert energy is None or not energy['enabled']
        else:
            assert energy and energy['enabled'] and energy['schema']=='coupled-energy/1'
            assert not energy['coverage']['totalThermodynamic']
            assert all(math.isfinite(v) for v in energy['storage'].values())
            mechanical=sum(energy['storage'].values())
            assert abs(energy['knownMechanical']-mechanical)<1e-7
            physical=sum(energy['physical'][k] for k in ['normal','friction','plastic','femDamping'])
            numerical=sum(energy['numerical'][k] for k in ['p2g','g2p','gridBoundary','positionCorrection','plasticReturn'])
            assert abs(energy['physical']['total']-physical)<1e-7
            assert abs(energy['numerical']['total']-numerical)<1e-7
            residual=mechanical-energy['initial']+physical-energy['externalWork']-energy['thermalWork']
            assert abs(energy['knownTermsResidual']-residual)<1e-7
            assert abs(energy['knownUnexplainedResidual']-(residual-numerical))<1e-7
            assert abs(energy['physical']['plastic']-thermal['plasticWork'])<1e-7
            assert abs(energy['physical']['friction']-thermal['frictionLoss'])<1e-7
        row=dict(time=frame['time'],energy=energy,thermal=thermal,
            solverMs=frame['performance']['solverMs'],substepHostTransfers=frame['performance']['substepHostTransfers'])
        rows.append(row)
        if len(rows)%10==1:
            print(json.dumps(dict(time=frame['time'],mechanical=energy.get('knownMechanical') if energy else None,
                residual=energy.get('knownUnexplainedResidual') if energy else None,
                heat=thermal['generatedHeat'],solverMs=row['solverMs'])),flush=True)

    frame,particles=solver.snapshot();record(frame,particles)
    duration=project['solver']['duration']
    while solver.time<duration-1e-9:
        frame,particles=solver.step(min(project['solver']['outputInterval'],duration-solver.time));record(frame,particles)
    assert frame['thermal']['generatedHeat']>0
    if not args.disabled:
        energy=frame['energy']
        assert energy['physical']['normal']>0
        assert energy['physical']['plastic']>0 and energy['physical']['friction']>0
        assert abs(energy['numerical']['p2g'])>0 and abs(energy['numerical']['plasticReturn'])>0
    result=dict(version='0.51.0',backend=backend,project=project,rows=rows,performance=frame['performance'],
        elapsedSeconds=time.perf_counter()-started,steps=frame['clock']['steps'],passed=True,
        scope='Recoverable mechanical storage and measured operator changes; integration residual retained; no full thermodynamic closure claim')
    path=disabled if args.disabled else enabled
    path.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    np.savez_compressed(path.with_suffix('.npz'),position=solver.s.x.to_numpy()[:solver.n]*.025,
        velocity=solver.s.v.to_numpy()[:solver.n]*.025,temperature=solver.s.enthalpy.to_numpy()[:solver.n]/solver.particle_cp,
        femU=np.asarray(frame['state']['u']),femT=np.asarray(frame['state']['temperature']))
    print('PASS complete 10k CUDA cycle, diagnostics '+('off' if args.disabled else 'on'),flush=True)


if __name__=='__main__':main()
