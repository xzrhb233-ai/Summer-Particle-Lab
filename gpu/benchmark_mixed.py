"""Same compiled MPM/FEM problem and kernels on CUDA vs Taichi CPU."""
import argparse,json,os,subprocess,time
from pathlib import Path
import numpy as np
import taichi as ti
from mixed_solver import MixedSolver
from runtime import initialize
ROOT=Path(__file__).resolve().parent.parent

def compile_project(project=None,count=10000):
    node=os.environ.get('SUMMER_NODE','node')
    args=[node,str(ROOT/'gpu/mixed_compile.mjs')]+([str(count)] if project is None else [])
    result=subprocess.run(args,input=None if project is None else json.dumps(project),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if result.returncode:raise ValueError(result.stderr[-3000:])
    return json.loads(result.stdout)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--arch',choices=['cuda','cpu'],default='cuda');ap.add_argument('--count',type=int,default=10000);ap.add_argument('--duration',type=float,default=.2);ap.add_argument('--dt',type=float);ap.add_argument('--output');ap.add_argument('--project');args=ap.parse_args()
    c=compile_project(project=json.loads(Path(args.project).read_text(encoding='utf-8')) if args.project else None,count=args.count)
    if args.dt:c['project']['solver']['dt']=args.dt
    if args.arch=='cpu':
        ti.init(arch=ti.cpu,default_fp=ti.f32,fast_math=False,cpu_max_num_threads=8,offline_cache_file_path=str(ROOT/'.taichi-cache'))
        backend=dict(name='Taichi',arch='cpu',threads=8)
    else:backend=initialize('cuda')
    started=time.perf_counter();s=MixedSolver(c);s.step(.002);warmup=time.perf_counter()-started
    s.checkpoint(True);s.time=0;s.steps=0;s.requests=0;s.stats.fill(0);s.previous_stats=np.zeros(18);s.total_ms=0;s.snapshot_bytes=0;s.max_dt=0
    s.thermal_loads.previous=s.thermal_loads.heat.to_numpy().copy()
    rows=[];started=time.perf_counter()
    while s.time<args.duration-1e-9:
        f,_=s.step(min(.01,args.duration-s.time));u=np.array(f['state']['u']).reshape(-1,3);T=np.array(f['state']['temperature']);C=np.array(c['fem']['capacity']);pair=f['contactPairs'][0]
        rows.append(dict(time=s.time,displacement=float(np.linalg.norm(u,axis=1).max()),tip=float(u[:,1].min()),impulse=pair['totalImpulse'],heat=-pair['accumulatedHeat'],plateTemperature=float(T@C/C.sum()),plateMax=float(T.max()),heatResidual=f['thermal']['residual'],penetration=pair['maxPenetration'],particleTemperature=f['part']['temperature'],solverMs=f['performance']['solverMs']))
        print(json.dumps(rows[-1]),flush=True)
    result=dict(backend=backend,particles=s.n,simulated=s.time,dt=s.dt,warmupSeconds=warmup,wallSeconds=time.perf_counter()-started,solverSeconds=s.total_ms/1000,substeps=s.steps,rows=rows,performance=f['performance'],nodes=s.nn,elements=len(c['fem']['cells']),method='same Taichi kernels; independent browser CPU comparison reported separately')
    path=ROOT/(args.output or f'artifacts/mixed-v047-{args.count}-{args.arch}.json');path.write_text(json.dumps(result,indent=2),encoding='utf-8');print('RESULT',str(path),flush=True)
