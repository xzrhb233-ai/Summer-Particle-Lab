"""Reproduce continuation through the former 0.33 s interactive stall."""
import json,time
from pathlib import Path
from runtime import initialize
from four_solver import FourSolver

backend=initialize('cuda');s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
rows=[];started=time.perf_counter();mark=0.
target=.34
while s.time<target-1e-10:
    interval=min(.01,16*s.next_dt,target-s.time)
    f,_=s.step(interval)
    assert abs(f['thermal']['residual'])<1e-5
    assert f['performance']['substepHostTransfers']==0
    if s.last_retries or s.time>=mark or s.time>=target-1e-10:
        row=dict(time=s.time,nextDt=s.next_dt,retries=s.last_retries,solverMs=s.last_ms,heatResidual=f['thermal']['residual']);rows.append(row);print(json.dumps(row),flush=True);mark=s.time+.025
    if time.perf_counter()-started>180:raise AssertionError(('Continuation stalled',s.time,s.next_dt))
Path('artifacts/v0581-resume.json').write_text(json.dumps(dict(backend=backend,wallSeconds=time.perf_counter()-started,rows=rows),indent=2),encoding='utf8')
