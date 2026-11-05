"""Native coupled climb diagnostic; no animated or prescribed bicycle pose."""
import argparse
import json
import subprocess
import time
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver, ROOT

def project(options=None):
    code="import {bicycleWall} from './src/multibody/bicycle.js';import {fromLegacy} from './src/simulation/project.js';console.log(JSON.stringify(fromLegacy(bicycleWall(JSON.parse(process.argv[1])))));"
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',code,json.dumps(dict(climb=True,**(options or {})))],cwd=ROOT,text=True,encoding='utf-8'))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--duration',type=float,default=8);parser.add_argument('--options',default='{}');args=parser.parse_args()
    initialize('cuda');s=ProjectSolver();t=time.perf_counter();max_height=0.;max_pitch=0.;peak=0.
    try:
        p=project(json.loads(args.options));initial,_=s.initialize(p)
        while s.time<args.duration-1e-9:
            f,particles=s.step(min(1/60,args.duration-s.time));front=next(b for b in f['bodies'] if b['id']=='front-wheel');rear=next(b for b in f['bodies'] if b['id']=='rear-wheel');frame=next(b for b in f['bodies'] if b['id']=='bike-frame')
            max_height=max(max_height,front['position'][1]);max_pitch=max(max_pitch,abs(2*np.arctan2(frame['rotation'][2],frame['rotation'][3])));peak=max(peak,np.linalg.norm(front['contactForce']))
            if round(s.time*60)%30==0:
                print(json.dumps(dict(t=s.time,x=front['position'][0],y=front['position'][1],rear=rear['position'][:2],vx=front['velocity'][0],force=front['contactForce'],pitch=2*np.arctan2(frame['rotation'][2],frame['rotation'][3]),wall_top=float(particles[:,1].max()),error=f['maxError'],seconds=time.perf_counter()-t)),flush=True)
        print(json.dumps(dict(max_height=max_height,max_pitch=max_pitch,peak=peak,seconds=time.perf_counter()-t)),flush=True)
    finally:s.close()
