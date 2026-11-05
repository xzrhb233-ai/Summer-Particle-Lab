"""Real compiled model: a larger request advances with larger accepted steps.

Compare short impact runs against the previous default, with contact and heat
checks. This is a regression, not a convergence or general stability claim.
"""
import copy,json,time
from pathlib import Path
import numpy as np
from benchmark_mixed import compile_project
from runtime import initialize
from four_solver import FourSolver,L

initialize('cuda')
source=json.loads(Path('artifacts/v0585-impact-compiled.json').read_text(encoding='utf8'))['fullProject']
rows=[]
for requested in [.0002,.002]:
    p=copy.deepcopy(source);p['solver']['dt']=requested
    s=FourSolver(compile_project(project=p));start=time.perf_counter();maximum=0.;overlap=0.;retries=0
    assert 'fourMethodPolicy' not in s.step_limits
    assert abs(s.dt-min(v for v in s.step_limits.values() if v is not None))<1e-14
    while s.time<.06-1e-10:
        frame,_=s.step(min(.01,16*s.next_dt,.06-s.time))
        maximum=max(maximum,s.max_dt);retries+=s.last_retries
        assert s.last_motion_ratio<=1.001
        assert abs(frame['thermal']['residual'])<1e-5
        assert frame['clock']['requestedDt']==requested
        assert frame['performance']['substepHostTransfers']==0
        x=s.s.x.to_numpy().astype(float)*L
        assert np.isfinite(x).all()
        overlap=max(overlap,s.particle_interface.reach-np.linalg.norm(x[:s.nm,None]-x[None,s.nm:],axis=2).min())
    impulse=frame['contactPairs'][s.fluid_pair]['totalImpulse']
    rows.append(dict(requested=requested,baseDt=s.dt,maxActualDt=maximum,steps=s.steps,retries=retries,overlap=overlap,impulse=impulse,heatResidual=frame['thermal']['residual'],wallSeconds=time.perf_counter()-start,limits=s.step_limits))
    print(json.dumps(rows[-1]),flush=True)
baseline,larger=rows
Path('artifacts/v0587-requested-step.json').write_text(json.dumps(rows,indent=2))
assert larger['maxActualDt']>.0002*1.5,larger
assert larger['steps']<baseline['steps']*.8,(baseline,larger)
assert larger['overlap']<.002,larger
assert np.linalg.norm(larger['impulse'])>.01
assert np.linalg.norm(np.array(larger['impulse'])-baseline['impulse'])<.15*np.linalg.norm(baseline['impulse'])
