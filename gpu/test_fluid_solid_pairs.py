"""Independent pressure/heat switch and ledger checks for the resident GPU pair."""
import json
from pathlib import Path
import numpy as np
from runtime import initialize
from four_solver import FourSolver,L

backend=initialize('cuda')
s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
pid=s.fluid_pair
assert pid>=0
x=s.s.x.to_numpy();x[:s.n,0]*=.5;x[:s.n,1]=22+(x[:s.n,1]-22)*.5;x[:s.n,2]*=.5
params=s.params.to_numpy();params[:,:2]=0;params[pid,:2]=1;s.params.from_numpy(params)
def neighbors():
    s.s.clear_neighbors();s.s.build_neighbors(s.n)
def pressure(enabled):
    s.s.x.from_numpy(x);s.totals.fill(0);s.s.pressure_cross[None]=int(enabled)
    cfg=params.copy();cfg[pid,0]=int(enabled);s.params.from_numpy(cfg)
    neighbors();s.s.density(s.n);s.s.corrections(s.n,1,.001,3,0);s.record_fluid_pressure(.001)
    s.s.apply_corrections(s.n,1,0,0.,0)
    m=s.s.mass.to_numpy()[:s.nm];dx=s.s.x.to_numpy()[:s.nm].astype(float)-x[:s.nm].astype(float)
    impulse=(m[:,None]*dx).sum(0)*L/.001
    ledger=s.totals.to_numpy()[pid]
    assert np.linalg.norm(impulse-ledger[:3])<.002,(impulse,ledger[:3])
    if enabled:assert ledger[7]>0
    else:assert np.all(ledger[:3]==0) and ledger[7]==0
    return ledger[:3].tolist()
on=pressure(True);off=pressure(False)

s.s.x.from_numpy(x);neighbors()
heat=[]
for enabled in [False,True]:
    s.totals.fill(0);cfg=params.copy();cfg[pid,0]=0;cfg[pid,1]=int(enabled);s.params.from_numpy(cfg)
    s.thermal_prepare();s.heat(0,.001);s.heat(1,.001)
    q=s.c.qp.to_numpy();ledger=s.totals.to_numpy()[pid,3]
    assert abs(q.sum())<1e-9
    assert abs(q[:s.nm].sum()-ledger)<1e-9
    if enabled:assert ledger<0
    else:assert ledger==0
    heat.append(float(ledger))
# The existing interval checkpoint must include the new pair's accumulators.
s.checkpoint();before=s.totals.to_numpy().copy();s.totals.fill(123);s.checkpoint(True)
assert np.array_equal(s.totals.to_numpy(),before)
f,_=s.snapshot(.001);r=f['contactPairs'][pid]
assert r['scheme']=='mpm-pbf-contact/2' and r['maxPenetration']==0
result=dict(backend=backend,pressureImpulseOn=on,pressureImpulseOff=off,heatOffOn=heat,rollback=True,substepHostTransfers=f['performance']['substepHostTransfers'])
Path('artifacts/v057-fluid-pair-gpu.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result),flush=True)
