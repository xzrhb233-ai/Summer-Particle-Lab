"""Seeded bounded creation noise, identical hash and geometry rules to JS."""
import math
import numpy as np

def sampling_options(value):
    if not isinstance(value,dict) or any(k not in ('enabled','strength','seed') for k in value):return None
    p=dict(enabled=False,strength=.2,seed=42)|value
    if not isinstance(p['enabled'],bool):return None
    strength,seed=p['strength'],p['seed']
    if isinstance(strength,bool) or not isinstance(strength,(int,float)) or not math.isfinite(strength) or not 0<=strength<=.35:return None
    if isinstance(seed,bool) or not isinstance(seed,(int,float)) or not math.isfinite(seed) or int(seed)!=seed or not 0<=seed<=2147483647:return None
    return p

def jitter_points(points,lo,hi,shape,fixed,options,spacing=4):
    if not options['enabled'] or options['strength']==0:return points
    original=points.astype(np.float64);result=original.copy()
    pending=np.arange(len(points));amplitude=spacing*options['strength']
    for attempt in range(8):
        if not len(pending):break
        h=(np.uint32(options['seed'])+(pending.astype(np.uint32)[:,None]+np.uint32(1))*np.uint32(0x9e3779b9)
           +(np.arange(3,dtype=np.uint32)[None,:]+np.uint32(attempt*3+1))*np.uint32(0x85ebca6b))
        h=(h^(h>>16))*np.uint32(0x7feb352d);h=(h^(h>>15))*np.uint32(0x846ca68b)
        d=(h^(h>>16)).astype(np.float64)/4294967296*2-1
        d[fixed[pending],0]=0
        d*=amplitude/np.maximum(1,np.linalg.norm(d,axis=1))[:,None]
        candidate=original[pending]+d
        candidate=np.where(candidate<lo,2*lo-candidate,candidate)
        candidate=np.where(candidate>hi,2*hi-candidate,candidate)
        q=(candidate-(lo+hi)*.5)/((hi-lo)*.5)
        keep=np.ones(len(pending),dtype=bool) if shape=='box' else (np.sum(q*q,axis=1) if shape=='ellipsoid' else q[:,0]**2+q[:,2]**2)<=1+1e-12
        result[pending[keep]]=candidate[keep];pending=pending[~keep]
    return result
