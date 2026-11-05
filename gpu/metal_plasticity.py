"""J2 and Johnson–Cook strength laws.

Finite-strain Hencky/J2 adaptation. A and B are normalized by Young's modulus.
Parameters are shared by part, avoiding eight extra floats per fluid particle.
"""
import math
import taichi as ti

DEFAULTS=dict(A=.025,B=.08,n=.35,C=.025,rate0=1.0,Tref=20.0,Tm=1000.0,m=1.0)
LIMITS=dict(A=(.0001,.5),B=(0,2),n=(.05,2),C=(0,.2),rate0=(.001,1000),Tref=(-100,1500),Tm=(0,3000),m=(.1,5))
MODEL_COUNT=12

def parameters(value=None):
    if value is None:value={}
    if not isinstance(value,dict) or any(k not in DEFAULTS for k in value):return None
    p=DEFAULTS|value
    for k,(lo,hi) in LIMITS.items():
        if isinstance(p[k],bool) or not isinstance(p[k],(int,float)) or not math.isfinite(p[k]) or not lo<=p[k]<=hi:return None
    return list(p.values()) if p['Tm']>p['Tref'] else None

@ti.func
def flow_stress(model,ep,rate,temperature,p):
    strength=p[0]
    if model==5:
        strength+=p[1]*ep
    elif model>=6:
        rate_factor=1+p[3]*ti.log(ti.max(1.0,rate/p[4]))
        theta=ti.min(1.0,ti.max(0.0,(temperature-p[5])/(p[6]-p[5])))
        strength=(p[0]+p[1]*ep**p[2])*rate_factor
        if model==6:strength*=1-theta**p[7]
    return strength

@ti.func
def metal_return(sigma,model,ep,dt,temperature,p):
    e=ti.log(ti.max(sigma,1e-6));trace=e.sum();dev=e-trace/3
    length=dev.norm();J=ti.max(1e-6,ti.exp(trace));q=ti.sqrt(6.0)*.4*length/J
    increment=0.0
    strength=flow_stress(model,ep,0.0,temperature,p)
    if q>strength:
        slope=1.2/J
        if model<=5:
            H=0.0
            if model==5:H=p[1]
            increment=(q-strength)/(slope+H)
        else:
            lo,hi=0.0,q/slope
            for iteration in range(24):
                mid=(lo+hi)/2
                if q-slope*mid>flow_stress(model,ep+mid,mid/ti.max(dt,1e-12),temperature,p):lo=mid
                else:hi=mid
            increment=(lo+hi)/2
    scale=ti.max(0.0,1-ti.sqrt(1.5)*increment/ti.max(length,1e-20))
    return ti.exp(trace/3+scale*dev),increment
