"""Full CUDA platen-to-specimen contact heating; no specimen thermostat."""
import json,subprocess,sys
from pathlib import Path
import numpy as np
from runtime import initialize
from benchmark_mixed import compile_project,ROOT
from mixed_solver import MixedSolver

def check_result(result):
    rows=result['rows'];p=result['project']
    assert rows[-1]['count']==10000 and result['backend']['arch']=='cuda'
    assert abs(rows[-1]['time']-p['solver']['duration'])<1e-8
    assert all(l['target']==p['parts'][0]['id'] for l in p['loads'] if l['type'].startswith('thermal-'))
    assert max(r['maxTemperature']-r['minTemperature'] for r in rows)>1
    assert max(r['layers'][-1]-r['layers'][0] for r in rows)>1
    assert max(r['layers'][-2] for r in rows)>20.01
    assert max(abs(r['mpmEnergyResidual']) for r in rows)<.1
    assert max(abs(r['heatResidual']) for r in rows)<.1
    assert result['performance']['substepHostTransfers']==0
    result['passed']=True

if __name__=='__main__':
    path=ROOT/'artifacts/mixed-v0491-contact-heating.json'
    if '--check-existing' in sys.argv:
        result=json.loads(path.read_text(encoding='utf-8'));check_result(result)
        path.write_text(json.dumps(result,indent=2),encoding='utf-8')
        print('PASS stored full CUDA cycle: contact-local heating, interior diffusion and heat ledger');sys.exit(0)
    p=json.loads(subprocess.check_output(['node','--input-type=module','-e','import {mixedGPUThermomechanicalProject as p} from "./src/mixed/gpu-model.js";console.log(JSON.stringify(p()));'],cwd=ROOT,text=True,encoding='utf-8'))
    c=compile_project(project=p);backend=initialize('cuda');s=MixedSolver(c);rows=[]
    f,particles=s.snapshot();levels=np.unique(np.round(np.asarray(c['seed']['points'])[:,1],6));ref_y=np.round(np.asarray(c['seed']['points'])[:,1],6)
    initial_mpm=f['part']['mass']*f['part']['temperature']*s.particle_cp
    def record(f):
        row=dict(time=f['time'],**f['part'],heatResidual=f['thermal']['residual'],heat=f['thermal']['externalHeat'],interfaceHeat=f['thermal']['interfaceHeatIntoMPM'],mpmEnergyResidual=f['part']['mass']*f['part']['temperature']*s.particle_cp-initial_mpm-f['thermal']['interfaceHeatIntoMPM'],layers=[float(particles[ref_y==y,4].mean()) for y in levels],femDisplacement=float(np.max(np.linalg.norm(np.array(f['state']['u']).reshape(-1,3),axis=1))),contactForce=f['contactPairs'][0]['normalForce'])
        rows.append(row)
        if len(rows)%10==1:print(json.dumps(row),flush=True)
    record(f)
    while s.time<p['solver']['duration']-1e-9:
        f,particles=s.step(min(p['solver']['outputInterval'],p['solver']['duration']-s.time));record(f)
    result=dict(version='0.49.1',backend=backend,rows=rows,performance=f['performance'],project=p)
    path.write_text(json.dumps(result,indent=2),encoding='utf-8');check_result(result)
    path.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('PASS full CUDA contact-heating cycle',flush=True)
