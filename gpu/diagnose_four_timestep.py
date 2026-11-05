"""Bounded reproduction of the first step collapse; no physics settings changed."""
import json,time
from pathlib import Path
from runtime import initialize
from four_solver import FourSolver

initialize('cuda')
s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
rows=[];start=time.perf_counter()
while s.time<.317-1e-10:
    before=s.time
    f,_=s.step(min(.01,16*s.next_dt,.317-s.time))
    if s.time>.30 or s.last_retries:
        row=dict(start=before,end=s.time,nextDt=s.next_dt,trials=s.last_step_trials,solverMs=s.last_ms,heatResidual=f['thermal']['residual'])
        rows.append(row);print(json.dumps(row),flush=True)
    assert abs(f['thermal']['residual'])<1e-5
    if time.perf_counter()-start>180:raise RuntimeError('Diagnostic time budget exceeded')
Path('artifacts/v0584-step-diagnosis.json').write_text(json.dumps(rows,indent=2),encoding='utf8')
