"""Actual resident-kernel smoke / invariant run; CUDA is required by default."""
import argparse,json,time
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from four_solver import FourSolver

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--duration',type=float,default=.02);ap.add_argument('--compiled',default='artifacts/four-compiled.json');ap.add_argument('--output',default='artifacts/four-validation.json');args=ap.parse_args()
    backend=initialize('cuda');data=json.loads(Path(args.compiled).read_text(encoding='utf8'));start=time.perf_counter();solver=FourSolver(data);rows=[]
    initial,_=solver.snapshot()
    while solver.time<args.duration-1e-10:
        f,points=solver.step(min(.01,args.duration-solver.time));assert np.isfinite(points).all();assert len(f['clock']['domains'])==4;assert f['performance']['substepHostTransfers']==0
        assert abs(f['thermal']['residual'])<1e-5*max(1,abs(f['thermal']['energy']))
        row=dict(time=f['time'],heatResidual=f['thermal']['residual'],thermal=f['thermal'],clock=f['clock'],displacement=max(abs(x) for x in f['state']['u']),bodies=f['bodies'],parts=f['particleParts'],pairs=f['contactPairs'],performance=f['performance']);rows.append(row)
        print(json.dumps(dict(time=f['time'],residual=f['thermal']['residual'],ms=f['performance']['solverMs'])),flush=True)
    Path(args.output).write_text(json.dumps(dict(backend=backend,particles=solver.n,wallSeconds=time.perf_counter()-start,rows=rows),indent=2),encoding='utf8')
