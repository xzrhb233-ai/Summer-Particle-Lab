"""Underdense contact, momentum/energy, disabled pair, support and multi-contact."""
import json
from pathlib import Path
import numpy as np
from runtime import initialize
from four_solver import FourSolver,L

initialize('cuda');s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
i=0;j=s.nm;ids=[i,j];pid=s.fluid_pair;params=s.params.to_numpy();params[:,:2]=0;params[pid,0]=1
reach=s.particle_interface.reach
def reset(enabled=True,pinned=False,multi=False):
    global ids
    ids=[i,j,j+1] if multi else [i,j]
    x=np.full((s.n,3),32,np.float32);v=np.zeros_like(x);m=np.ones(s.n,np.float32);w=np.zeros(s.n,np.float32);pin=np.ones(s.n,np.int32)
    x[i]=[0,.8/L,0];x[j]=[(reach-.003)/L,.8/L,0]
    v[i]=[.3/L,0,0];v[j]=[-.2/L,0,0];m[i]=2;m[j]=5;w[i]=.5;w[j]=.2;pin[ids]=0
    if multi:x[j+1]=[0,.8/L,(reach-.002)/L];v[j+1]=[0,0,-.1/L];m[j+1]=3;w[j+1]=1/3
    if pinned:w[i]=0;pin[i]=1;v[i]=0
    s.s.x.from_numpy(x);s.s.v.from_numpy(v);s.s.mass.from_numpy(m);s.s.inv_mass.from_numpy(w);s.s.pinned.from_numpy(pin)
    s.capture_motion();cfg=params.copy();cfg[pid,0]=int(enabled);s.params.from_numpy(cfg);s.s.pressure_cross[None]=int(enabled)
    s.totals.fill(0);s.support.fill(0)
    return x,v,m
def state():
    x=s.s.x.to_numpy().astype(float)*L;v=s.s.v.to_numpy().astype(float)*L;m=s.s.mass.to_numpy().astype(float)
    return (m[ids,None]*v[ids]).sum(0),.5*(m[ids,None]*v[ids]**2).sum(),x,v

x,v,m=reset();s.s.clear_neighbors();s.s.build_neighbors(s.n);s.s.density(s.n);s.s.corrections(s.n,1,.0002,3,0)
assert np.all(s.s.lam.to_numpy()[ids]==0) and np.all(s.s.delta.to_numpy()[ids]==0), 'Fixture must have zero PBF pressure'
before=state()
for _ in range(6):s.particle_interface.solve()
after=state();ledger=s.totals.to_numpy()[pid,:3]
assert np.linalg.norm(after[0]-before[0])<2e-7
assert after[1]<=before[1]+1e-8
assert np.linalg.norm(ledger-m[i]*(after[3][i]-before[3][i]))<2e-7
assert np.linalg.norm(ledger)>0
depth=reach-np.linalg.norm(after[2][i]-after[2][j]);assert depth<1e-6,depth
reset(False);before=state();s.particle_interface.solve();after=state()
assert np.array_equal(before[2],after[2]) and np.array_equal(before[3],after[3]);assert np.all(s.totals.to_numpy()[pid]==0)
reset(pinned=True);before=state()
for _ in range(6):s.particle_interface.solve()
after=state();assert np.array_equal(before[2][i],after[2][i]);assert abs(after[3][j,0])<1e-7
assert np.linalg.norm(after[0]-before[0]+s.support.to_numpy())<2e-7
reset(multi=True);before=state()
for _ in range(6):s.particle_interface.solve()
after=state();assert np.linalg.norm(after[0]-before[0])<3e-7;assert after[1]<=before[1]+1e-8
saved=s.totals.to_numpy().copy();s.checkpoint();s.totals.fill(123);s.checkpoint(True);assert np.array_equal(saved,s.totals.to_numpy())
result=dict(pressureOnlyImpulse=0,normalImpulse=ledger.tolist(),residualOverlap=depth,disabledUnchanged=True,supportBalanced=True,multipleContactsConservative=True,rollback=True)
Path('artifacts/v0585-particle-contact.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
