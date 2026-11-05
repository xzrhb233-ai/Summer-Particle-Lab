"""Pressure-sensitive Hencky plasticity.
Strengths are Cauchy stress / E; total J = det(Fe) Jp is preserved by return.
"""
import math
import taichi as ti
DEFAULTS=dict(cohesion=.025,slope=.6,dilatancy=.15,tension=.01,alpha=1.5,plateau=.015,gamma=.01,densify=.02,beta=2.0,epsD=.7)
LIMITS=dict(cohesion=(0,.5),slope=(0,2),dilatancy=(0,2),tension=(0,.5),alpha=(.05,math.sqrt(4.5)),plateau=(.0001,.5),gamma=(0,1),densify=(.0001,1),beta=(1,5),epsD=(.05,3))
def parameters(value=None):
    if value is None:value={}
    if not isinstance(value,dict) or any(k not in DEFAULTS for k in value):return None
    p=DEFAULTS|value
    for k,(lo,hi) in LIMITS.items():
        if isinstance(p[k],bool) or not isinstance(p[k],(int,float)) or not math.isfinite(p[k]) or not lo<=p[k]<=hi:return None
    return list(p.values()) if p['dilatancy']<=p['slope'] and p['slope']*p['tension']<=p['cohesion']+1e-12 else None

@ti.func
def foam_strength(ep,p):
    r=ep/p[9];value=1e20
    if r<1:value=p[5]+p[6]*r-p[7]*ti.log(ti.max(1e-30,1-r**p[8]))
    return value

@ti.func
def foam_state(eta,q,mean,G,K,p):
    a2=p[4]**2;B=1+a2/9
    qn=q/(1+3*G*eta);mn=mean/(1+K*a2*eta)
    hat=ti.sqrt((qn*qn+a2*mn*mn)/B)
    return qn,mn,eta*B*hat,hat

@ti.func
def pressure_return(sigma,model,jp,ep,p):
    e=ti.log(ti.max(sigma,1e-6));trace=e.sum();dev=e-trace/3
    J=ti.max(1e-6,ti.exp(trace)*jp);G=.4/J;K=(2/3)/J
    mean=K*trace;q=ti.sqrt(6.0)*G*dev.norm()
    mean_new,q_new,increment=mean,q,0.0
    if model==8:
        t=q/ti.sqrt(3.0);c,a,b,T=p[0],p[1],p[2],p[3]
        if mean>T and t+a*T<=c:mean_new=T
        elif t+a*mean>c:
            dl=(t+a*mean-c)/(G+a*K*b)
            mean_new=mean-K*b*dl;q_new=ti.sqrt(3.0)*ti.max(0.0,t-G*dl)
            if mean_new>T:mean_new=T;q_new=ti.sqrt(3.0)*ti.max(0.0,c-a*T)
    else:
        trial=ti.sqrt((q*q+p[4]**2*mean*mean)/(1+p[4]**2/9))
        if trial>foam_strength(ep,p):
            lo,hi=0.0,1/G
            for k in range(32):
                qn,mn,dl,hat=foam_state(hi,q,mean,G,K,p)
                if hat>foam_strength(ep+dl,p):hi*=2
            for k in range(28):
                mid=(lo+hi)/2
                qn,mn,dl,hat=foam_state(mid,q,mean,G,K,p)
                if hat>foam_strength(ep+dl,p):lo=mid
                else:hi=mid
            q_new,mean_new,increment,hat=foam_state((lo+hi)/2,q,mean,G,K,p)
    trace_new=mean_new/K;scale=1.0
    if q>1e-20:scale=q_new/q
    new_e=trace_new/3+scale*dev
    if model==8:increment=ti.sqrt(2/3)*(e-new_e).norm()
    return ti.exp(new_e),jp*ti.exp(trace-trace_new),increment
