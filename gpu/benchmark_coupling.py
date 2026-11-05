"""Reproducible native vs hybrid-PBD benchmark; no changes to live projects.

Each configuration runs in its own CUDA process, warms the complete measured
trajectory, restores all initial transaction fields and repeats it three times.
Frame extraction and quality diagnostics are measured separately from solve.
The persistent Taichi disk cache is retained: first-use time is NOT cold JIT.
"""
import argparse,copy,json,math,os,statistics,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
FLAGS=getattr(subprocess,'CREATE_NO_WINDOW',0)

def gpu_load():
    try:return subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used,temperature.gpu','--format=csv,noheader'],text=True,creationflags=FLAGS,timeout=5).strip()
    except Exception:return 'unavailable'

def worker(args):
    import numpy as np
    import taichi as ti
    from runtime import initialize
    from benchmark_mixed import compile_project
    from mpm_unified_solver import UnifiedMPMSolver,L
    project=json.loads(Path(args.project).read_text(encoding='utf8'))
    project['discretization']['mpm']['particlesPerAxis']=args.ppc
    project['solver'].update(couplingMode=args.mode,pbdIterations=args.iterations,dt=.002,duration=args.duration)
    t=time.perf_counter();data=compile_project(project=project);compile_seconds=time.perf_counter()-t
    backend=initialize('cuda');load_before=gpu_load()
    t=time.perf_counter();s=UnifiedMPMSolver(data);ti.sync();setup_seconds=time.perf_counter()-t
    # Preserve the same state as the solver's complete transaction. Individual
    # output batches overwrite its rollback buffers, so keep a separate initial
    # snapshot; these host transfers are outside every measured interval.
    c=s.c
    fields=[getattr(s.s,k) for k in c.backups]+[c.u,c.v,c.temperature,c.stats,c.friction_totals,s.s.plastic_work,s.s.plastic_heat,s.device_time]
    fields += [a for a,b in s.extra_backups]
    for loads in [c.thermal_loads,s.thermal_loads]:fields += [loads.heat,loads.requested]
    initial=[f.to_numpy().copy() for f in fields]
    advance=s.substep;trial_steps=0;trace=[];phase='warmup';deadline=time.perf_counter()+360
    Path(args.output+'.progress.json').write_text('[]',encoding='utf8')
    Path(args.output+'.runs.json').write_text('[]',encoding='utf8')
    def monitored_step(h):
        nonlocal trial_steps
        trial_steps+=1
        if trial_steps%200==0:
            if phase=='warmup':
                trace.append(dict(trialSubsteps=trial_steps,h=h,deviceTime=float(s.device_time[None]),motionRatio=float(s.motion_ratio[None]),status=int(s.c.status[None])))
                Path(args.output+'.progress.json').write_text(json.dumps(trace,indent=2),encoding='utf8')
            if time.perf_counter()>deadline:raise ValueError('Benchmark configuration exceeded 360 s budget')
        advance(h)
    s.substep=monitored_step
    def trajectory():
        retries=0;minimum=math.inf;maximum=0
        while s.time<args.duration-1e-10:
            s.step(min(args.batch,args.duration-s.time),emit=False)
            retries+=s.last_retries;minimum=min(minimum,s.min_dt);maximum=max(maximum,s.max_dt)
        return retries,minimum,maximum
    try:
        t=time.perf_counter();trajectory();ti.sync();first_seconds=time.perf_counter()-t
    except Exception as e:
        Path(args.output).write_text(json.dumps(dict(mode=args.mode,iterations=args.iterations,particles=s.n,ppc=args.ppc,error=str(e),completedTime=s.time,trialSubsteps=trial_steps,trace=trace,wallSeconds=time.perf_counter()-t),indent=2),encoding='utf8')
        return
    t=time.perf_counter();s.snapshot(args.duration);first_output=time.perf_counter()-t
    rows=[];quality=None
    for repeat in range(args.repeats):
        for f,v in zip(fields,initial):f.from_numpy(v)
        s.time=0.;s.steps=0;s.requests=0;s.total_ms=0.;s.last_ms=0.;s.frame_bytes=0
        s.next_dt=s.dt;s.stable_intervals=0;s.previous.fill(0);s.thermal_loads.previous.fill(0)
        phase='measured';ti.sync();t=time.perf_counter()
        try:retries,minimum,maximum=trajectory()
        except Exception as e:
            Path(args.output).write_text(json.dumps(dict(mode=args.mode,iterations=args.iterations,particles=s.n,ppc=args.ppc,error=str(e),completedTime=s.time,runs=rows,trace=trace),indent=2),encoding='utf8');return
        ti.sync();elapsed=time.perf_counter()-t
        t=time.perf_counter();frame,points=s.snapshot(args.duration);ti.sync();output_seconds=time.perf_counter()-t
        rows.append(dict(repeat=repeat+1,solveSeconds=elapsed,outputSeconds=output_seconds,steps=s.steps,retries=retries,minDt=minimum,maxDt=maximum,solverReportedSeconds=s.total_ms/1000))
        print(json.dumps(dict(ppc=args.ppc,mode=args.mode,iterations=args.iterations,**rows[-1])),flush=True)
        if quality is None:
            # Evaluate remaining geometric overlap, not the ledger's maximum
            # pre-correction penetration recorded over the entire trajectory.
            s.c.prepare_surface();s.c.find_contacts();s.find()
            depths=s.cd.to_numpy();active=s.active.to_numpy();residual={}
            for slot,pid in enumerate(s.pair_index):
                if pid<0 or not s.pairs[pid]['mechanical']:continue
                mask=np.array([int(k>=s.nm) if k<s.n else 2+int(k-s.n>=s.nm) if k<2*s.n else 4 for k in range(s.ncontacts)])==slot
                residual[s.pairs[pid]['id']]=float(np.maximum(0,depths[mask&(active>0)]).max(initial=0))
            x=s.s.x.to_numpy().astype(float)*L
            if s.fluid_pair>=0 and s.pairs[s.fluid_pair]['mechanical']:
                best=0.
                for start in range(0,s.nm,128):
                    distance=np.linalg.norm(x[start:min(start+128,s.nm),None,:]-x[None,s.nm:,:],axis=2)
                    best=max(best,float(np.maximum(0,s.particle_interface.reach-distance).max(initial=0)))
                residual[s.pairs[s.fluid_pair]['id']]=best
            u=s.c.u.to_numpy()
            quality=dict(maxResidualOverlap=max(residual.values(),default=0),residualOverlapByPair=residual,
                heatResidual=frame['thermal']['residual'],maxFemDisplacement=float(np.linalg.norm(u,axis=1).max()),
                spherePosition=frame['bodies'][0]['position'],sphereVelocity=frame['bodies'][0]['velocity'],
                particles=frame['particleParts'],impulses={p['id']:p['totalImpulse'] for p in frame['contactPairs']})
            assert np.isfinite(points).all() and np.isfinite(u).all()
            assert abs(quality['heatResidual'])<1e-5
        else:
            # CUDA reductions and adaptive contact branching may vary even
            # after restoring identical arrays. Report variation, don't hide it.
            rows[-1]['sphereYDifferenceFromFirst']=abs(frame['bodies'][0]['position'][1]-quality['spherePosition'][1])
        Path(args.output+'.runs.json').write_text(json.dumps(rows,indent=2),encoding='utf8')
    med=statistics.median(r['solveSeconds'] for r in rows)
    result=dict(backend=backend,mode=args.mode,iterations=args.iterations if args.mode!='native' else None,
        particles=s.n,mpm=s.nm,pbf=s.n-s.nm,femNodes=s.nn,ppc=args.ppc,duration=args.duration,batch=args.batch,
        requestedDt=.002,baseDt=s.dt,compileProjectSeconds=compile_seconds,setupSeconds=setup_seconds,
        firstAdvanceSeconds=first_seconds,firstOutputSeconds=first_output,cache='existing disk cache; full trajectory warmup excluded',
        runs=rows,medianSolveSeconds=med,minSolveSeconds=min(r['solveSeconds'] for r in rows),maxSolveSeconds=max(r['solveSeconds'] for r in rows),
        medianOutputSeconds=statistics.median(r['outputSeconds'] for r in rows),simSecondsPerWallSecond=args.duration/med,
        medianMillisecondsPerStep=statistics.median(r['solveSeconds']*1000/r['steps'] for r in rows),quality=quality,
        gpuLoadBefore=load_before,gpuLoadAfter=gpu_load())
    Path(args.output).write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')

def main(args):
    out=ROOT/'artifacts'/'coupling-benchmark-batched';out.mkdir(exist_ok=True)
    node="import {unifiedPBDExample} from './src/mixed/four-gpu-model.js'; console.log(JSON.stringify(unifiedPBDExample()));"
    project=subprocess.check_output(['node','--input-type=module','-e',node],cwd=ROOT,text=True,encoding='utf8',creationflags=FLAGS)
    path=out/'project.json';path.write_text(project,encoding='utf8');results=[]
    for ppc in args.scales:
        configs=[('native',6),('unified-pbd',6),('unified-pbd',8)]
        if ppc==4:configs.reverse()
        for mode,iterations in configs:
            dest=out/f'ppc{ppc}-{mode}-{iterations}.json'
            cmd=[sys.executable,__file__,'--worker','--project',str(path),'--ppc',str(ppc),'--mode',mode,'--iterations',str(iterations),'--duration',str(args.duration),'--batch',str(args.batch),'--repeats',str(args.repeats),'--output',str(dest)]
            print('START '+dest.name,flush=True)
            with dest.with_suffix('.log').open('w',encoding='utf8') as log:
                run=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=FLAGS)
            if run.returncode:
                print(dest.with_suffix('.log').read_text(encoding='utf8')[-3000:],flush=True)
                dest.write_text(json.dumps(dict(mode=mode,iterations=iterations,ppc=ppc,error='Worker failed; see log')),encoding='utf8')
            results.append(json.loads(dest.read_text(encoding='utf8')))
            (out/'results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False),encoding='utf8')
    print('RESULT '+str(out/'results.json'),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--worker',action='store_true');p.add_argument('--project');p.add_argument('--output')
    p.add_argument('--ppc',type=int,default=2);p.add_argument('--mode',default='native');p.add_argument('--iterations',type=int,default=6)
    p.add_argument('--duration',type=float,default=.08);p.add_argument('--batch',type=float,default=.004);p.add_argument('--scales',type=int,nargs='+',default=[2,4]);p.add_argument('--repeats',type=int,default=3);args=p.parse_args()
    worker(args) if args.worker else main(args)
