"""All new metal branches in the resident four-domain CUDA stepping pipeline."""
import json,subprocess
import numpy as np
import taichi as ti
from runtime import initialize
from benchmark_mixed import compile_project,ROOT
from mpm_unified_solver import UnifiedMPMSolver

@ti.kernel
def impose(s:ti.template(),n:ti.i32,model:ti.i32):
    for i in range(n):
        s.model[i]=model
        s.F[i]=ti.Matrix([[1.15,0.,0.],[0.,.9,0.],[0.,0.,1/1.035]])

source=json.loads(subprocess.check_output(['node','--input-type=module','-e',
    'import {fourGPUExample} from "./src/mixed/four-gpu-model.js";console.log(JSON.stringify(fourGPUExample()));'],cwd=ROOT,text=True,encoding='utf8'))
material=source['parts'][1]['material'];material['model']=6
material['thermomechanical']=dict(expansion=.0001,referenceTemperature=20,hotStiffnessRatio=.6,plasticHeatFraction=.5)
data=compile_project(project=source)
backend=initialize('cuda');s=UnifiedMPMSolver(data)
rows=[]
for model in [4,5,6,7]:
    before=float(s.s.plastic_heat[None]);impose(s.s,s.nm,model)
    frame,particles=s.step(.0002)
    assert np.isfinite(particles).all()
    assert np.all(particles[:s.nm,3]==11+model)
    assert np.max(particles[:s.nm,7])>0
    assert float(s.s.plastic_heat[None])>before
    assert abs(frame['thermal']['residual'])<1e-5,frame['thermal']
    assert np.isfinite(frame['state']['u']).all()
    rows.append(dict(model=model,time=s.time,maxPlastic=float(np.max(particles[:s.nm,7])),
        generatedHeat=frame['thermal']['generatedHeat'],heatResidual=frame['thermal']['residual']))
    print(json.dumps(rows[-1]),flush=True)
# Rejected trial restores irreversible history and its heat/work ledgers.
s.checkpoint(False);ep=s.s.plastic.to_numpy().copy();heat=float(s.s.plastic_heat[None]);work=float(s.s.plastic_work[None])
impose(s.s,s.nm,6);s.s.g2p(s.n,1e-6);s.checkpoint(True)
np.testing.assert_array_equal(s.s.plastic.to_numpy(),ep)
assert float(s.s.plastic_heat[None])==heat and float(s.s.plastic_work[None])==work
(ROOT/'artifacts/mixed-metals-cuda.json').write_text(json.dumps(dict(backend=backend,rows=rows,rollback=True),indent=2),encoding='utf8')
print('four-domain metal integration and rollback passed',flush=True)
