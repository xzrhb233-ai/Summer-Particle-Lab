"""Functional CUDA heating/cooling exercise; deliberately no refinement runs."""
import argparse,csv,json,subprocess
from pathlib import Path
import numpy as np
from benchmark_mixed import ROOT,compile_project
from mixed_solver import MixedSolver
from runtime import initialize

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--count',type=int,choices=[10000,50000],default=10000);parser.add_argument('--duration',type=float,default=.5);args=parser.parse_args()
    code=f'import {{mixedGPUThermalProject}} from "./src/mixed/gpu-model.js";console.log(JSON.stringify(mixedGPUThermalProject({args.count})));'
    p=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)))
    compiled=compile_project(project=p);backend=initialize('cuda');s=MixedSolver(compiled);rows=[]
    f,_=s.snapshot()
    def record(f):
        T=np.array(f['state']['temperature']);C=np.array(compiled['fem']['capacity'])
        rows.append(dict(time=f['time'],mpmMean=f['part']['temperature'],femMean=float(T@C/C.sum()),femMin=float(T.min()),femMax=float(T.max()),externalHeat=f['thermal']['externalHeat'],heatResidual=f['thermal']['residual'],interfaceHeatIntoMPM=f['thermal']['interfaceHeatIntoMPM'],loads=f['thermalLoads']))
    record(f)
    while s.time<args.duration-1e-9:f,_=s.step(min(.01,args.duration-s.time));record(f)
    final=rows[-1];loads={l['id']:l for l in final['loads']};expected=2e6*args.duration
    assert s.n==args.count and backend['arch']=='cuda'
    assert abs(loads['mpm-power']['heat']-expected)<1e-3
    assert loads['plate-convection']['heat']<0 and loads['plate-thermostat']['heat']>0
    assert final['mpmMean']>rows[0]['mpmMean']
    assert max(abs(r['heatResidual']) for r in rows)<1e-3
    assert f['performance']['substepHostTransfers']==0
    result=dict(version='0.48.0',scope='Functional boundary, energy and scale checks; no convergence study',backend=backend,particles=s.n,passed=True,substeps=s.steps,initial=rows[0],final=final,maxHeatResidual=max(abs(r['heatResidual']) for r in rows),rows=rows,performance=f['performance'])
    prefix=ROOT/f'artifacts/mixed-v048-thermal-{args.count}'
    prefix.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    prefix.with_suffix('.project.json').write_text(json.dumps(p,indent=2),encoding='utf-8')
    with prefix.with_suffix('.csv').open('w',encoding='utf-8',newline='') as out:
        fields=[k for k in final if k!='loads'];writer=csv.DictWriter(out,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(rows)
    print(json.dumps({k:v for k,v in result.items() if k!='rows'},indent=2),flush=True)
