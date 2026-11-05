"""Full four-method on/off comparison, same initial MPM block and PBF water."""
import copy,json,time
from pathlib import Path
import numpy as np
from runtime import initialize
from four_solver import FourSolver,L

initialize('cuda');data=json.loads(Path('artifacts/v0585-impact-compiled.json').read_text(encoding='utf8'))
results=[]
for enabled in [False,True]:
    d=copy.deepcopy(data)
    pair=next(p for p in d['fullProject']['contactPairs'] if {p['a'],p['b']}=={'solid','water'});pair['mechanical']=enabled
    s=FourSolver(d);start=time.perf_counter();worst=0.
    while s.time<.06-1e-10:
        f,_=s.step(min(16*s.next_dt,.06-s.time))
        assert abs(f['thermal']['residual'])<1e-5
        x=s.s.x.to_numpy().astype(float)*L
        distance=np.linalg.norm(x[:s.nm,None]-x[None,s.nm:],axis=2).min()
        worst=max(worst,s.particle_interface.reach-distance)
    pair=f['contactPairs'][s.fluid_pair]
    results.append(dict(enabled=enabled,time=s.time,maxOverlap=worst,impulse=pair['totalImpulse'],heatResidual=f['thermal']['residual'],seconds=time.perf_counter()-start))
    print(json.dumps(results[-1]),flush=True)
    s.c=None;s=None
off,on=results
assert np.linalg.norm(off['impulse'])==0
assert np.linalg.norm(on['impulse'])>.01
assert on['maxOverlap']<.002 and on['maxOverlap']<off['maxOverlap']*.2,(off,on)
Path('artifacts/v0585-impact.json').write_text(json.dumps(results,indent=2))
