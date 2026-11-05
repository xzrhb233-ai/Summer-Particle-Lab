"""Continue past the old CCD stall; allow bounded, recovering contact retries.

The independent MPM/PBF normal contact changes trajectories, so zero retries
is no longer a valid invariant. Collision safety assertions remain unchanged.
"""
import json,time
from pathlib import Path
from runtime import initialize
from four_solver import FourSolver

initialize('cuda');s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
rows=[];start=time.perf_counter();next_report=0.;minimum=s.dt;retries=0
while s.time<.6-1e-10:
    f,_=s.step(min(.01,16*s.next_dt,.6-s.time))
    minimum=min(minimum,s.min_dt);retries+=s.last_retries
    assert abs(f['thermal']['residual'])<1e-5
    assert s.last_motion_ratio<=1.001
    assert f['performance']['substepHostTransfers']==0
    if s.time>=next_report or s.last_retries:
        row=dict(time=s.time,nextDt=s.next_dt,retries=s.last_retries,trials=s.last_step_trials,solverMs=s.last_ms)
        rows.append(row);print(json.dumps(row),flush=True);next_report=s.time+.05
    if time.perf_counter()-start>240:raise AssertionError(('Continuation too slow',s.time,s.next_dt))
result=dict(time=s.time,wallSeconds=time.perf_counter()-start,minDt=minimum,finalDt=s.next_dt,retries=retries,heatResidual=f['thermal']['residual'],rows=rows)
Path('artifacts/v0585-continuation.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='rows'}),flush=True)
# This fixture permits at most a single halving at any point; the controller
# must recover the requested step by the end, rather than silently crawling.
assert minimum>=s.dt*.499,(minimum,s.dt)
assert s.next_dt>=s.dt*.99,(s.next_dt,s.dt)
assert retries<=3,retries
