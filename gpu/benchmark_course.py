"""Full physical course diagnostic. Stores replay frames, never prescribes motion."""
import argparse,json,subprocess,time
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver,ROOT
parser=argparse.ArgumentParser();parser.add_argument('--duration',type=float,default=15);parser.add_argument('--preset',choices=['course','ramps'],default='course');parser.add_argument('--stop-after-exit',action='store_true');parser.add_argument('--options',default='{}');parser.add_argument('--output',default='artifacts/course-replay.json');args=parser.parse_args()
generator={'course':'bicycleCourse','ramps':'bicycleRamps'}[args.preset]
code=f"import {{{generator}}} from './src/multibody/bicycle.js';import {{fromLegacy}} from './src/simulation/project.js';console.log(JSON.stringify(fromLegacy({generator}(JSON.parse(process.argv[1])))));"
p=json.loads(subprocess.check_output(['node','--input-type=module','-e',code,args.options],cwd=ROOT,text=True,encoding='utf-8'))
backend=initialize('cuda');s=ProjectSolver();frames=[];start=time.perf_counter()
try:
    f,a=s.initialize(p);f['particles']=a.reshape(-1).tolist();frames.append(f)
    road=next((b for b in f['bodies'] if b['id']=='road-1'),None)
    exit_x=road['position'][0]-road['size'][0]/2 if road else float('inf')
    while s.time<args.duration-1e-9:
        f,a=s.step(min(1/30,args.duration-s.time));front=next(b for b in f['bodies'] if b['id']=='front-wheel')
        if round(s.time*30)%3==0:
            f['particles']=a.reshape(-1).tolist();frames.append(f)
        if round(s.time*30)%15==0:
            print(json.dumps(dict(t=s.time,x=front['position'][0],y=front['position'][1],vx=front['velocity'][0],force=front['contactForce'],parts=f['results']['parts'][-3:],error=f['maxError'],seconds=time.perf_counter()-start)),flush=True)
        rear=next(b for b in f['bodies'] if b['id']=='rear-wheel')
        if args.stop_after_exit and args.preset=='ramps' and rear['position'][0]>exit_x+.7 and abs(rear['position'][1]-.62)<.05 and abs(front['position'][1]-.62)<.05:
            if frames[-1]['time']!=f['time']:f['particles']=a.reshape(-1).tolist();frames.append(f)
            break
    (ROOT/args.output).write_text(json.dumps(dict(schema='summer-replay/1',project=p,backend=backend,frames=frames),separators=(',',':')),encoding='utf-8')
finally:s.close()
