"""Check completed, sequential runs; retain all raw time histories as evidence."""
import csv,json,math
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts'

def read(name):return json.loads((OUT/name).read_text(encoding='utf-8'))
def norm(x):return math.sqrt(sum(v*v for v in x)) if isinstance(x,list) else abs(x)
def difference(a,b):return norm([x-y for x,y in zip(a,b)]) if isinstance(a,list) else abs(a-b)
def compare(reference,candidate):
    a,b=reference['rows'],candidate['rows']
    assert len(a)==len(b) and all(abs(x['time']-y['time'])<1e-9 for x,y in zip(a,b)),'Output times differ'
    errors={}
    for k in ('displacement','impulse','heat'):
        peak=max(norm(x[k]) for x in a)
        errors[k]=dict(finalPercent=100*difference(a[-1][k],b[-1][k])/max(1e-12,norm(a[-1][k])),
            trajectoryPercent=100*max(difference(x[k],y[k]) for x,y in zip(a,b))/max(1e-12,peak))
    errors['plateTemperatureMaxDifferenceC']=max(abs(x['plateTemperature']-y['plateTemperature']) for x,y in zip(a,b))
    errors['maxHeatResidualJ']=max(abs(x['heatResidual']) for x in a+b)
    assert all(math.isfinite(v) for metric in errors.values() for v in (metric.values() if isinstance(metric,dict) else [metric]))
    return errors

if __name__=='__main__':
    comparisons=[];history=[]
    for count in (10000,50000):
        cpu=read(f'mixed-v047-{count}-cpu.json');gpu=read(f'mixed-v047-{count}-cuda.json')
        for r in (cpu,gpu):
            assert r['particles']==count and r['substeps']==1000 and r['performance']['substepHostTransfers']==0
            assert abs(r['simulated']-.2)<1e-9
            for row in r['rows']:history.append({'particles':count,'arch':r['backend']['arch'],**row})
        errors=compare(cpu,gpu)
        assert all(errors[k]['trajectoryPercent']<.1 for k in ('displacement','impulse','heat')),errors
        assert errors['maxHeatResidualJ']<1e-4,errors
        comparisons.append(dict(particles=count,cpuWallSeconds=cpu['wallSeconds'],gpuWallSeconds=gpu['wallSeconds'],
            speedup=cpu['wallSeconds']/gpu['wallSeconds'],cpuSolverSeconds=cpu['solverSeconds'],gpuSolverSeconds=gpu['solverSeconds'],
            cpuWarmupSeconds=cpu['warmupSeconds'],gpuWarmupSeconds=gpu['warmupSeconds'],errors=errors,
            cpuFinal=cpu['rows'][-1],gpuFinal=gpu['rows'][-1]))
    independent=compare(read('mixed-v047-browser-reference.json'),read('mixed-v047-cuda-reference.json'))
    refined=compare(read('mixed-v047-refined.json'),read('mixed-v047-10000-cuda.json'))
    # Discontinuous impact onset cannot be certified by matching final impulse.
    # Retain the raw transient mismatch and independently resolve its timing.
    onset={}
    for arch in ('browser','cuda'):
        onset[arch]=next(r['time'] for r in read(f'mixed-v047-{arch}-onset.json')['rows'] if norm(r['impulse'])>1e-8)
    onset['differenceSeconds']=abs(onset['browser']-onset['cuda'])
    assert onset['differenceSeconds']<=.0002+1e-9,onset
    assert all(independent[k]['finalPercent']<1 for k in ('displacement','impulse','heat')),independent
    assert all(independent[k]['trajectoryPercent']<1 for k in ('displacement','heat')),independent
    assert all(refined[k]['trajectoryPercent']<6 for k in ('displacement','impulse','heat')),refined
    report=dict(version='0.47.0',generatedAt=datetime.now(timezone.utc).isoformat(),passed=True,passScope='CUDA / Taichi CPU parity, heat conservation, independent endpoint and contact-onset bounds; not full browser transient equivalence or convergence',
        protocol='Sequential warmed runs, 0.2 s physical time, 0.0002 s step, 0.01 s output. Wall time includes frame extraction; excludes initial assembly/JIT, network, and rendering. CPU = Taichi, 8 threads, same kernels.',
        device=read('mixed-v047-10000-cuda.json')['backend'],comparisons=comparisons,
        independentBrowserCPU=independent,independentContactOnset=onset,timeStepRefinement10k=refined,
        warnings=['Independent browser CPU transient impulse difference peaks at about 15.75% of the reference peak. Impact starts one shared timestep later on CUDA; final agreement does not imply pointwise transient equivalence.',
            'Halving the timestep changes transferred heat by about 4.33%; spatial convergence and smaller-step convergence remain unverified.'],
        limitations=['One elastic MPM box and one linear Tet4 plate; no phases, PBF, damage, thermal expansion or heat boundary loads on this GPU path.',
            'MPM reference-neighbor finite-volume conduction and bounded parallel Jacobi contact differ from the browser CPU implementation; the independent 64-particle check is separate.',
            'Mechanical energy ledger not migrated. Heat balance is tracked independently; no friction-to-heat conversion.',
            'Step halving is a sensitivity check, not a spatial/temporal convergence proof. Plate deformation triggers the small-deformation warning.',
            'One warmed measurement per device/size on a shared workstation; this is not real-time performance or a hardware-isolated benchmark.'])
    (OUT/'mixed-v047-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    with (OUT/'mixed-v047-comparison.csv').open('w',encoding='utf-8',newline='') as f:
        fields=['particles','arch','time','displacement','impulse_x','impulse_y','impulse_z','heat','plateTemperature','plateMax','heatResidual','solverMs']
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');writer.writeheader()
        for row in history:writer.writerow({**row,**dict(zip(('impulse_x','impulse_y','impulse_z'),row['impulse']))})
    print(json.dumps(report,indent=2))
