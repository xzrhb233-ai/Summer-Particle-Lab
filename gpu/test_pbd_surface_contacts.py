"""Isolate each native surface/sphere contact under the PBD projector."""
import json
from pathlib import Path
import numpy as np
from runtime import initialize
from mpm_unified_solver import UnifiedMPMSolver,L

initialize('cuda');data=json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8'))
data['fullProject']['solver'].update(couplingMode='unified-pbd',pbdIterations=6)
s=UnifiedMPMSolver(data);p=s.framework.pbd;c=s.c;c.fixed.fill(0);h=.001
base=s.s.x.to_numpy().copy();original=s.params.to_numpy();rows=[]
for slot in range(5):
    pid=s.pair_index[slot];cfg=original.copy();cfg[:,:2]=0;cfg[pid,0]=1;cfg[:,2]=0;s.params.from_numpy(cfg)
    c.u.fill(0);c.v.fill(0);s.s.v.fill(0);s.rv.fill(0);s.rw.fill(0);s.totals.fill(0);s.support.fill(0)
    i=0 if slot in (0,2) else s.nm
    x=base.copy();rx=np.array([[0.,.7,0]],np.float64)
    if slot<2:x[i]=[0,(.375+c.radius-.0001)/L,0]
    elif slot<4:x[i]=[(s.rr+c.radius-.0001)/L,.7/L,0]
    else:rx[0]=[0,.375+s.rr-.0001,0]
    s.s.x.from_numpy(x);s.rx.from_numpy(rx);s.capture_motion()
    old=x.copy();oldrx=rx.copy()
    if slot<2:old[i,1]+=.0002/L;s.motion_x.from_numpy(old)
    elif slot<4:old[i,0]+=.0002/L;s.motion_x.from_numpy(old)
    else:oldrx[0,1]+=.0002;s.motion_r.from_numpy(oldrx)
    c.prepare_surface();c.find_contacts();s.find();s.contact_bound();p.project(h,1)
    mass=s.s.mass.to_numpy().astype(float);v=s.s.v.to_numpy().astype(float)*L;fv=c.v.to_numpy();rv=s.rv.to_numpy()[0]
    linear=(mass[:,None]*v).sum(0)+(c.mass.to_numpy()[:,None]*fv).sum(0)+s.rmass*rv
    assert np.linalg.norm(linear)<2e-6,(slot,linear)
    J=s.totals.to_numpy()[pid,:3];assert np.linalg.norm(J)>1e-8,(slot,J)
    if slot<2:assert np.linalg.norm(v[i])>0 and np.linalg.norm(fv)>0
    elif slot<4:assert np.linalg.norm(v[i])>0 and np.linalg.norm(rv)>0
    else:assert np.linalg.norm(fv)>0 and np.linalg.norm(rv)>0
    rows.append(dict(pair=s.pairs[pid]['id'],linearMomentumError=float(np.linalg.norm(linear)),impulse=J.tolist()))
    # Initial overlap at rest is removed without velocity or impulse generation.
    s.s.x.from_numpy(x);s.rx.from_numpy(rx);c.u.fill(0);c.v.fill(0);s.s.v.fill(0);s.rv.fill(0);s.rw.fill(0);s.totals.fill(0);s.capture_motion()
    c.prepare_surface();c.find_contacts();s.find();s.contact_bound();p.project(1e-7,1)
    assert np.max(np.abs(s.s.v.to_numpy()))<1e-8 and np.max(np.abs(c.v.to_numpy()))<1e-8 and np.max(np.abs(s.rv.to_numpy()))<1e-8
    assert np.max(np.abs(s.totals.to_numpy()[:,:3]))<1e-8
Path('artifacts/v0600-pbd-surfaces.json').write_text(json.dumps(rows,indent=2),encoding='utf8');print(json.dumps(rows),flush=True)
