"""Independent CPU/CUDA contact comparisons; never mutates an open project."""
import argparse
import json
import subprocess
import time
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver

ROOT=Path(__file__).resolve().parent.parent
def node(*args,input=None):
    return json.loads(subprocess.check_output(['node','tests/run-contact-validation.mjs',*args],
        cwd=ROOT,input=input,text=True,encoding='utf-8'))
def emit(value):
    print('CONTACT_VALIDATION '+json.dumps(value,allow_nan=False),flush=True)

@ti.kernel
def gather(s:ti.template(),n:ti.i32,out:ti.types.ndarray(dtype=ti.f64,ndim=2)):
    for p in range(n):
        for a in ti.static(range(3)):
            out[p,a]=s.x[p][a]*.025;out[p,a+3]=s.v[p][a]*.025
        out[p,6]=s.mass[p];out[p,7]=s.lab.part[p]
        for a,b in ti.static(ti.ndrange(3,3)):
            out[p,8+a*3+b]=s.F[p][a,b];out[p,17+a*3+b]=s.C[p][a,b]

def observe(solver):
    s=solver.s;n=s.count
    data=np.empty((n,26),np.float64);gather(s,n,data)
    x,v,m=data[:,:3],data[:,3:6],data[:,6]
    F,C=data[:,8:17].reshape(-1,3,3),data[:,17:26].reshape(-1,3,3)
    U,_,V=np.linalg.svd(F);R=U@V;J=np.linalg.det(F)
    W=np.sum((F-R)**2,axis=(1,2))+.5*(J-1)**2
    D=(float(s.mpm_h[None])*.025)**2/4
    kinetic=.5*np.sum(m*(np.sum(v*v,axis=1)+D*np.sum(C*C,axis=(1,2))))
    potential=-np.sum(m*(x@np.array(solver.model['gravity'])))
    elastic=np.sum(m*6400*solver.model['coupling']['stiffness']*.025**2*W)
    spin=np.stack([C[:,2,1]-C[:,1,2],C[:,0,2]-C[:,2,0],C[:,1,0]-C[:,0,1]],axis=1)
    centers=[];speeds=[];masses=[]
    for part in [1,2]:
        mask=data[:,7]==part;mass=np.sum(m[mask]);masses.append(float(mass))
        centers.extend((np.sum(m[mask,None]*x[mask],axis=0)/mass).tolist())
        speeds.extend((np.sum(m[mask,None]*v[mask],axis=0)/mass).tolist())
    return dict(position=x.ravel().tolist(),velocity=v.ravel().tolist(),centers=centers,speeds=speeds,masses=masses,
        momentum=np.sum(m[:,None]*v,axis=0).tolist(),angular=np.sum(m[:,None]*(np.cross(x,v)+D*spin),axis=0).tolist(),
        energy=float(kinetic+potential+elastic))

def run_row(solver,item,index,total):
    spec,project=item['spec'],item['project']
    solver.initialize(project);initial=observe(solver);start=time.perf_counter()
    impulse=overlap=thermal=momentum=angular=0.;max_energy=initial['energy'];trace=[];k=0;last=0.
    while solver.time<spec['duration']-1e-10:
        dt=min(spec['duration']-solver.time,spec['batchTicks'][k%len(spec['batchTicks'])]*min(spec['dt'],1/480));k+=1
        f,data=solver.step(dt);p=f['contactPairs'][0];obs=observe(solver)
        impulse+=p['normalForce']*dt;overlap=max(overlap,p['maxPenetration']);thermal=max(thermal,abs(f['coupling']['thermalResidual']))
        momentum=max(momentum,float(np.linalg.norm(np.array(obs['momentum'])-initial['momentum'])))
        angular=max(angular,float(np.linalg.norm(np.array(obs['angular'])-initial['angular'])))
        max_energy=max(max_energy,obs['energy'])
        if len(trace)<41:trace.append(dict(time=f['time'],normalForce=p['normalForce'],heat=p['accumulatedHeat'],energy=obs['energy']))
        if time.perf_counter()-last>1:
            emit(dict(type='progress',value=dict(index=index,total=total,case=spec['id'],fraction=solver.time/spec['duration'],backend='GPU')))
            last=time.perf_counter()
    row=dict(**spec,backend='GPU',count=solver.s.count,initial=initial,final=obs,clock=f['clock'],
        normalImpulse=impulse,heat=p['accumulatedHeat'],maxOverlap=overlap,maxThermalResidual=thermal,
        maxMomentumError=momentum,maxAngularError=angular,maxEnergyGain=(max_energy-initial['energy'])/max(abs(initial['energy']),1e-9),
        normalWork=f['materialContactWork']['normal'],frictionWork=f['materialContactWork']['friction'],positiveContactWork=f['materialContactWork']['positive'],
        seconds=time.perf_counter()-start,trace=trace)
    closed=spec['case'] in ['impact','separate']
    valid=overlap/spec['cellSize']<=.15 and thermal<1e-4 and row['positiveContactWork']<1e-6
    valid=valid and (not closed or (momentum<1e-4 and angular<1e-4 and row['maxEnergyGain']<.03))
    valid=valid and (spec['case']!='separate' or impulse<1e-6)
    row['status']='pass' if valid else 'check'
    return row

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--arch',choices=['cuda','vulkan'],default='cuda')
    parser.add_argument('--cpu-report')
    args=parser.parse_args()
    cpu=json.loads(Path(args.cpu_report).read_text(encoding='utf-8')) if args.cpu_report else node('--json')
    jobs=node('--projects');rows=cpu['rows']
    emit(dict(type='progress',value=dict(index=0,total=len(jobs),case='initializing',fraction=0,backend='GPU')))
    backend=initialize(args.arch);solver=ProjectSolver()
    try:
        for index,item in enumerate(jobs):
            try:row=run_row(solver,item,index,len(jobs))
            except Exception as error:row=dict(**item['spec'],backend='GPU',status='error',error=str(error))
            rows.append(row)
    finally:solver.close()
    report=node('--summarize',input=json.dumps(rows,allow_nan=False))
    report['device']=backend
    path=ROOT/'artifacts/contact-validation.json';temporary=path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8');temporary.replace(path)
    emit(dict(type='complete',report=report))
if __name__=='__main__':main()
