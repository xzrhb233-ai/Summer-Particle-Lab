"""CUDA PBD contacts, opt-out, rollback, and an integrated four-domain run."""
import json,copy,time
from pathlib import Path
import numpy as np
from runtime import initialize
from mpm_unified_solver import UnifiedMPMSolver,L
from benchmark_mixed import compile_project

initialize('cuda')
source=json.loads(Path('artifacts/v0585-impact-compiled.json').read_text(encoding='utf8'))['fullProject']
source['solver'].update(couplingMode='unified-pbd',pbdIterations=6,dt=.002)
data=compile_project(project=source);s=UnifiedMPMSolver(data);pbd=s.framework.pbd
assert pbd is not None and s.framework.describe()['couplingMode']=='unified-pbd'
# Isolated unequal-mass particle constraint, no density or native forces.
i=0;j=s.nm;reach=pbd.particles.reach;h=.001
cfg=s.params.to_numpy();cfg[:,:2]=0;cfg[s.fluid_pair,0]=1;s.params.from_numpy(cfg)
x=np.full((s.n,3),32,np.float32);v=np.zeros_like(x);mass=np.ones(s.n,np.float32);inv=np.zeros(s.n,np.float32);pin=np.ones(s.n,np.int32)
x[i]=[0,.8/L,0];x[j]=[(reach-.0003)/L,.8/L,0]
mass[i]=2;mass[j]=5;inv[i]=.5;inv[j]=.2;pin[[i,j]]=0
v[i]=[.3/L,0,0];v[j]=[-.2/L,0,0]
s.s.x.from_numpy(x);s.s.v.from_numpy(v);s.s.mass.from_numpy(mass);s.s.inv_mass.from_numpy(inv);s.s.pinned.from_numpy(pin)
s.capture_motion()
old=x.copy();old[j,0]+=.00031/L;s.motion_x.from_numpy(old)
before=x.astype(float)*L;vb=v.astype(float)*L
for _ in range(6):pbd.particles.solve_pbd(h,True)
after=s.s.x.to_numpy().astype(float)*L;va=s.s.v.to_numpy().astype(float)*L
recovery=float(np.max(np.abs(va-vb-(after-before)/h)))
momentum=float(np.linalg.norm(np.sum(mass[:,None]*(va-vb),axis=0)))
assert recovery<2e-5,recovery
assert momentum<2e-6,momentum
assert reach-np.linalg.norm(after[i]-after[j])<2e-7
np.testing.assert_allclose(s.totals.to_numpy()[s.fluid_pair,:3],mass[i]*(va[i]-vb[i]),atol=2e-6)
# Stabilization has no velocity or ledger side effect; disabled pairs do nothing.
s.s.x.from_numpy(x);s.s.v.from_numpy(v);ledger=s.totals.to_numpy().copy()
pbd.particles.solve_pbd(h,False)
assert np.array_equal(s.s.v.to_numpy(),v) and np.array_equal(s.totals.to_numpy(),ledger)
# Even residual initial penetration at rest must not launch particles as h -> 0.
s.s.x.from_numpy(x);s.s.v.fill(0);s.capture_motion();ledger=s.totals.to_numpy().copy()
pbd.particles.solve_pbd(1e-7,True)
assert np.array_equal(s.s.v.to_numpy(),np.zeros_like(v)) and np.array_equal(s.totals.to_numpy()[:,:3],ledger[:,:3])
cfg[s.fluid_pair,0]=0;s.params.from_numpy(cfg);before=s.s.x.to_numpy().copy()
pbd.particles.solve_pbd(h,True);assert np.array_equal(before,s.s.x.to_numpy())
print('particle projection/velocity recovery, stabilization and disabled pairs passed',flush=True)
# Fresh, authored four-domain problem; this compiles and exercises all kernels.
s=UnifiedMPMSolver(data);started=time.perf_counter()
for _ in range(10):
    frame,_=s.step(.002)
    print(json.dumps(dict(time=s.time,steps=s.steps,retries=s.last_retries,heatResidual=frame['thermal']['residual'])),flush=True)
assert abs(frame['thermal']['residual'])<1e-5
assert np.linalg.norm(s.totals.to_numpy()[s.fluid_pair,:3])>0
assert all(np.isfinite(a.to_numpy()).all() for a in [s.s.x,s.s.v,s.c.u,s.c.v,s.rv])
arrays=[s.s.x,s.s.v,s.s.F,s.s.C,s.s.enthalpy,s.c.u,s.c.v,s.temperature,s.rx,s.rv,s.rw,s.rq,s.totals,s.support,s.device_time,s.thermal_loads.heat]
saved=[a.to_numpy().copy() for a in arrays];clock=(s.time,s.steps,s.next_dt,s.stable_intervals);advance=s.substep
def fail(h):advance(h);raise ValueError('injected PBD rollback')
s.substep=fail
try:s.step(.0002);raise AssertionError('failure swallowed')
except ValueError as e:assert 'injected' in str(e)
assert clock==(s.time,s.steps,s.next_dt,s.stable_intervals)
for a,b in zip(arrays,saved):assert np.array_equal(a.to_numpy(),b)
result=dict(time=s.time,steps=s.steps,wallSeconds=time.perf_counter()-started,heatResidual=frame['thermal']['residual'],particleMomentumError=momentum,velocityRecoveryError=recovery,rollback=True,framework=frame['framework'])
Path('artifacts/v0600-unified-pbd.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result),flush=True)
