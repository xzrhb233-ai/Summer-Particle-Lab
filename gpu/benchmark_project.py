"""Reproducible native GPU bicycle impact benchmark (includes warmup separately)."""
import argparse
import json
import subprocess
import time
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver,ROOT

def bicycle_project(large=False):
    code="import {bicycleWall} from './src/multibody/bicycle.js';import {fromLegacy} from './src/simulation/project.js';const p=fromLegacy(bicycleWall());p.solver.adapter='taichi-coupled';console.log(JSON.stringify(p));"
    project=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,text=True,encoding='utf-8'))
    if large:
        wall=next(p for p in project['parts'] if p['method']=='mpm');wall['geometry']['size']=[.6,3.,1.8];wall['geometry']['center']=[3.77,1.5,0]
    return project

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--duration',type=float,default=3.);parser.add_argument('--large',action='store_true');parser.add_argument('--profile',action='store_true');parser.add_argument('--arch',default='cuda',choices=['cuda','vulkan']);args=parser.parse_args()
    backend=initialize(args.arch);s=ProjectSolver()
    try:
        project=bicycle_project(args.large);start=time.perf_counter();s.initialize(project);s.step(1/480)
        print('warmup_seconds',time.perf_counter()-start,flush=True)
        initial,particles=s.initialize(project);
        if args.profile:
            import cProfile
            profile=cProfile.Profile();profile.enable()
        start=time.perf_counter();peak=0;first=None;max_error=0
        while s.time<args.duration-1e-9:
            frame,data=s.step(min(1/60,args.duration-s.time));wheel=next(b for b in frame['bodies'] if b['id']=='front-wheel');force=float(np.linalg.norm(wheel['contactForce']))
            max_error=max(max_error,frame['maxError']);peak=max(peak,force)
            if first is None and force>1:first=s.time
            if round(s.time*60)%60==0:print(json.dumps(dict(time=s.time,travel=wheel['displacement'][0],speed=wheel['velocity'][0],force=force,peak=peak,first=first,wall_seconds=time.perf_counter()-start)),flush=True)
        result=dict(backend=backend,seconds=time.perf_counter()-start,simulated=s.time,particles=len(data),travel=wheel['displacement'][0],speed=wheel['velocity'][0],first_contact=first,peak_sampled_force=peak,max_error=max_error,max_wall_dx=float(np.max(np.abs(data[:,0]-particles[:,0]))))
        print(json.dumps(result,ensure_ascii=False),flush=True)
        if args.profile:profile.disable();profile.dump_stats(str(ROOT/'artifacts/gpu-project-steady.prof'))
    finally:s.close()
