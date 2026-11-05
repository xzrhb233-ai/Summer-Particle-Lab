"""Temperature-dependent J2 strength and implicit Norton–Arrhenius creep."""
import math
import taichi as ti
DEFAULTS=dict(Tref=20.,Thot=180.,hotRatio=.08,A=.04,H=.04,rate=.0005,Q=35000.,n=3.,stress=.04)
LIMITS=dict(Tref=(-100,1500),Thot=(-99,2500),hotRatio=(.001,1),A=(.0001,.5),H=(0,2),rate=(0,10),Q=(0,200000),n=(1,8),stress=(.001,.5))
def parameters(value=None):
    if value is None:value={}
    if not isinstance(value,dict) or any(k not in DEFAULTS for k in value):return None
    p=DEFAULTS|value
    for k,(lo,hi) in LIMITS.items():
        if isinstance(p[k],bool) or not isinstance(p[k],(int,float)) or not math.isfinite(p[k]) or not lo<=p[k]<=hi:return None
    return list(p.values()) if p['Thot']>p['Tref'] else None

@ti.func
def thermal_return(sigma,model,ep,dt,T,p):
    e=ti.log(ti.max(sigma,1e-6));tr=e.sum();dev=e-tr/3
    length=dev.norm();J=ti.max(1e-6,ti.exp(tr));q=ti.sqrt(6.0)*.4*length/J;slope=1.2/J
    increment=0.0
    if model==10:
        theta=ti.min(1.0,ti.max(0.0,(T-p[0])/(p[1]-p[0])))
        factor=1-(1-p[2])*theta
        increment=ti.max(0.0,(q-(p[3]+p[4]*ep)*factor)/(slope+p[4]*factor))
    elif dt>0 and p[5]>0 and q>1e-20:
        activation=ti.min(60.0,ti.max(-60.0,p[6]/8.314462618*(1/(p[0]+273.15)-1/ti.max(1.0,T+273.15))))
        lo,hi=0.0,q/slope
        for k in range(32):
            mid=(lo+hi)/2;qn=ti.max(1e-30,q-slope*mid)
            log_rate=ti.log(p[5])+activation+p[7]*ti.log(qn/p[8])
            if ti.log(ti.max(1e-30,mid/dt))<log_rate:lo=mid
            else:hi=mid
        increment=(lo+hi)/2
    scale=ti.max(0.0,1-ti.sqrt(1.5)*increment/ti.max(length,1e-20))
    return ti.exp(tr/3+scale*dev),increment
