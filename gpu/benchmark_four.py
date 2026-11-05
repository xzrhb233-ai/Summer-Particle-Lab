"""Same-input, warmed CUDA benchmark; optional synchronized stage diagnosis."""
import argparse,json,time,statistics
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from four_solver import FourSolver

ap=argparse.ArgumentParser();ap.add_argument('--variant',choices=['reference','optimized'],default='optimized');ap.add_argument('--compiled',default='artifacts/four-compiled.json');ap.add_argument('--profile',action='store_true');ap.add_argument('--tag',default='small');ap.add_argument('--interval',type=float,default=.005);args=ap.parse_args()
backend=initialize('cuda');data=json.loads(Path(args.compiled).read_text(encoding='utf8'));data['optimize']=args.variant=='optimized'
started=time.perf_counter();s=FourSolver(data);s.step(args.interval);ti.sync();warm=time.perf_counter()-started
rows=[]
for _ in range(5):
    start=time.perf_counter();f,points=s.step(args.interval);ti.sync()
    assert np.isfinite(points).all() and abs(f['thermal']['residual'])<1e-5
    assert f['performance']['substepHostTransfers']==0
    rows.append(dict(ms=1000*(time.perf_counter()-start),solverMs=f['performance']['solverMs'],snapshotMs=f['performance']['snapshotMs'],heatResidual=f['thermal']['residual'],steps=f['clock']['steps'],retries=f['contactSafety']['retries']))
    print(json.dumps(rows[-1]),flush=True)
path=Path(f'artifacts/v058-{args.tag}-{args.variant}')
np.savez(str(path)+'.npz',x=s.s.x.to_numpy(),v=s.s.v.to_numpy(),F=s.s.F.to_numpy(),H=s.s.enthalpy.to_numpy(),u=s.c.u.to_numpy(),fv=s.c.v.to_numpy(),T=s.c.temperature.to_numpy(),rx=s.rx.to_numpy(),rv=s.rv.to_numpy(),rT=s.rigid_temperature.to_numpy(),totals=s.totals.to_numpy())
result=dict(backend=backend,variant=args.variant,particles=s.n,interval=args.interval,simulated=s.time,warmupSeconds=warm,medianMs=statistics.median(r['ms'] for r in rows),medianSolverMs=statistics.median(r['solverMs'] for r in rows),rows=rows)
if args.profile:
    stages={}
    def wrap(obj,name,label):
        original=getattr(obj,name)
        def measured(*a,**kw):
            ti.sync();t=time.perf_counter();out=original(*a,**kw);ti.sync();stages[label]=stages.get(label,0)+1000*(time.perf_counter()-t);return out
        setattr(obj,name,measured)
    for obj,names,label in [(s.s,['clear_neighbors','build_neighbors'],'neighbor_build'),(s.s,['clear_grid','p2g','grid_step','g2p','prepare'],'mpm'),(s.s,['density','corrections','apply_corrections'],'pbf'),(s,['record_fluid_pressure'],'pressure_ledger'),(s.c,['prepare_surface','find_contacts'],'fem_contact_search'),(s,['check_swept'],'swept'),(s,['find','contact_bound','contact'],'contact'),(s,['thermal_prepare','heat','heat_apply'],'thermal')]:
        for name in names:wrap(obj,name,label)
    s.step(.001);result['synchronizedStageMs']=stages
path.with_suffix('.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result),flush=True)
