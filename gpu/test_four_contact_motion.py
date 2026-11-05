"""High-speed sphere versus a thin fixed FEM plate, with transactional retries."""
import argparse,json
from pathlib import Path
import numpy as np
from runtime import initialize
from four_solver import FourSolver
from benchmark_mixed import compile_project

parser=argparse.ArgumentParser();parser.add_argument('--requested-dt',type=float);parser.add_argument('--output',default='artifacts/contact-safety-gpu.json');args=parser.parse_args()
backend=initialize('cuda')
data=json.loads(Path('artifacts/contact-safety-compiled.json').read_text(encoding='utf8'))
if args.requested_dt:
    # This legacy fixture pins every node after compilation. Preserve that
    # support mask when recompiling for a different requested time step.
    fixed=data['fem']['fixed']
    project=data['fullProject'];project['solver']['dt']=args.requested_dt;data=compile_project(project=project)
    data['fem']['fixed']=fixed
s=FourSolver(data)
print(json.dumps(dict(baseDt=s.dt,minimumTrialDt=s.minimum_trial_dt,maxRetries=s.max_contact_retries)),flush=True)
s.step(.002,emit=False)
f,_=s.snapshot(.002)
y=float(s.rx[0][1]);vy=float(s.rv[0][1])
assert y>=.45-1e-5,(y,vy)
assert vy>=-1e-3,(y,vy)
assert s.last_retries>0,s.last_retries
assert s.last_motion_ratio<=1.001
assert s.time==.002 and abs(float(s.device_time[None])-.002)<1e-12
assert f['performance']['substepHostTransfers']==0
pair=next(p for p in f['contactPairs'] if set([p['a'],p['b']])=={'sphere','plate'})
assert pair['totalImpulse'][1]>0
assert abs(f['thermal']['residual'])<1e-6
assert abs(f['thermal']['externalHeat']-.8)<1e-7, f['thermal']
result=dict(backend=backend,sphereY=y,sphereVelocityY=vy,plateTop=.375,sphereRadius=.075,initialSpeed=40,plateThickness=.005,
            steps=s.steps,minDt=s.min_dt,retries=s.last_retries,maxTravelRatio=s.last_motion_ratio,heatResidual=f['thermal']['residual'],externalHeat=f['thermal']['externalHeat'],impulse=pair['totalImpulse'])
accepted=s.next_dt
s.step(16*accepted)
assert s.last_retries==0 and abs(s.max_dt-accepted)<1e-12
result.update(nextIntervalReusesAcceptedDt=True,nextIntervalRetries=s.last_retries)
result.update(requestedDt=s.project['solver']['dt'],baseDt=s.dt)
Path(args.output).write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
