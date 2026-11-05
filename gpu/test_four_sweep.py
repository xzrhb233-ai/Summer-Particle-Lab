"""CCD regression: grazing, shared translation, thin-wall and edge/vertex crossing."""
import json
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from four_solver import FourSolver

@ti.kernel
def query(s:ti.template(), points:ti.types.ndarray(dtype=ti.f64,ndim=3), result:ti.types.ndarray(dtype=ti.i32,ndim=1)):
    for i in range(points.shape[0]):
        v=ti.Matrix.zero(ti.f64,8,3)
        for j,k in ti.static(ti.ndrange(8,3)):v[j,k]=points[i,j,k]
        result[i]=s.transient_sweep(v[0,:],v[1,:],v[2,:],v[3,:],v[4,:],v[5,:],v[6,:],v[7,:],.05)

def distances(points):
    t=np.linspace(0,1,4097)[:,None]
    p=points[0]+t*(points[1]-points[0])
    a,b,c=[points[j]+t*(points[j+3]-points[j]) for j in [2,3,4]]
    u=b-a;v=c-a;n=np.cross(u,v);nn=(n*n).sum(1)
    projection=p-n*((p-a)*n).sum(1)[:,None]/nn[:,None]
    w=projection-a;uu=(u*u).sum(1);uv=(u*v).sum(1);vv=(v*v).sum(1);wu=(w*u).sum(1);wv=(w*v).sum(1)
    beta=(vv*wu-uv*wv)/(uu*vv-uv*uv);gamma=(uu*wv-uv*wu)/(uu*vv-uv*uv)
    d=np.where((beta>=0)&(gamma>=0)&(beta+gamma<=1),np.linalg.norm(p-projection,axis=1),np.inf)
    for x,y in [(a,b),(b,c),(c,a)]:
        e=y-x;q=np.clip(((p-x)*e).sum(1)/(e*e).sum(1),0,1)
        d=np.minimum(d,np.linalg.norm(p-x-q[:,None]*e,axis=1))
    return d

if __name__=='__main__':
    initialize('cuda');s=FourSolver(json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8')))
    tri=np.array([[-1,0,0],[1,0,0],[0,2,0]],float)
    cases=[];names=[];expected=[]
    def add(name,p0,p1,a,b,want):
        names.append(name);cases.append(np.array([p0,p1,*a,*b],np.float64));expected.append(want)
    add('parallel face grazing',[-.4,.5,.05000001],[.4,.5,.05000001],tri,tri,0)
    shift=np.array([.8,-.3,.7])
    add('shared translation grazing',[-.4,.5,.05000001],np.array([.4,.5,.05000001])+shift,tri,tri+shift,0)
    add('through thin face',[0,.5,-.5],[0,.5,.5],tri,tri,1)
    add('through edge',[-2,-.03,0],[2,-.03,0],tri,tri,1)
    vertex=np.array([[0,0,0],[-1,1,0],[1,1,0]],float)
    add('through vertex',[-.5,-.04,0],[.5,-.04,0],vertex,vertex,1)
    add('vertex near miss',[-.5,-.050001,0],[.5,-.050001,0],vertex,vertex,0)
    add('moving face',[0,.5,0],[0,.5,0],tri+[0,0,-.5],tri+[0,0,.5],1)
    rng=np.random.default_rng(584)
    for i in range(40):
        p0=rng.uniform([-1.5,-.5,-.7],[1.5,1.8,.7]);p1=rng.uniform([-1.5,-.5,-.7],[1.5,1.8,.7])
        end=tri+rng.uniform(-.08,.08,(3,3));sample=np.array([p0,p1,*tri,*end]);d=distances(sample)
        if min(d[0],d[-1])>.06 and abs(d.min()-.05)>.001:add('moving triangle '+str(i),p0,p1,tri,end,int(d.min()<.05))
    points=np.array(cases);out=np.zeros(len(points),np.int32);query(s,points,out)
    assert out.tolist()==expected,[(n,int(a),b) for n,a,b in zip(names,out,expected) if a!=b]
    assert int(s.swept_unresolved[None])==0
    result=dict(cases=len(cases),passed=True,unresolved=0,names=names)
    Path('artifacts/v0584-sweep.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
