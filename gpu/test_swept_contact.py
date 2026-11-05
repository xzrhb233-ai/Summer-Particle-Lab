"""GPU continuous sphere/triangle queries and runtime detector isolation."""
import json
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from four_solver import FourSolver

backend=initialize('cuda')
s=FourSolver(json.loads(Path('artifacts/contact-safety-compiled.json').read_text(encoding='utf8')))
v3=ti.types.vector(3,ti.f64)

@ti.kernel
def query(p0:v3,p1:v3,shift:v3)->ti.i32:
    a=ti.Vector([0.,0.,0.],dt=ti.f64);b=ti.Vector([1.,0.,0.],dt=ti.f64);c=ti.Vector([0.,0.,1.],dt=ti.f64)
    return s.transient_sweep(p0,p1,a,b,c,a+shift,b+shift,c+shift,.1)

cases=[([.2,1,.2],[.2,-1,.2],[0,0,0],1),
       ([.5,1,-.06],[.5,-1,-.06],[0,0,0],1),
       ([-.06,1,-.06],[-.06,-1,-.06],[0,0,0],1),
       ([.2,1,.2],[.2,1,.2],[0,2,0],1),
       ([-.5,.05,-.08],[1.5,.05,-.08],[0,0,0],1),
       ([-.5,.09,-.08],[1.5,.09,-.08],[0,0,0],0),
       ([.2,1,.2],[.2,2,.2],[0,0,0],0),
       ([.2,.1,.2],[.2,1,.2],[0,0,0],0)]
for p0,p1,shift,expected in cases:assert query(p0,p1,shift)==expected,(p0,p1,shift)
s.capture_motion();s.rx.from_numpy(np.array([[-.5,.2,0]],dtype=np.float64))
before=[a.to_numpy().copy() for a in [s.rx,s.rv,s.s.v,s.c.v,s.c.temperature,s.s.enthalpy,s.totals]]
s.swept_hits[None]=0;s.check_swept();assert int(s.swept_hits[None])>0
for a,b in zip([s.rx,s.rv,s.s.v,s.c.v,s.c.temperature,s.s.enthalpy,s.totals],before):assert np.array_equal(a.to_numpy(),b)
params=s.params.to_numpy();params[:,0]=0;s.params.from_numpy(params)
s.swept_hits[None]=0;s.check_swept();assert int(s.swept_hits[None])==0
result=dict(backend=backend,analyticCases=len(cases),runtimeCrossingDetected=True,detectorDoesNotApplyImpulseOrHeat=True,disabledMechanicalPairsExcluded=True)
Path('artifacts/swept-contact-gpu.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
