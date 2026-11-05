"""Domain and cell-centred geometry sampling; same rules as the browser module."""
import math
import numpy as np

DEFAULT_DOMAIN=dict(lower=[-64,-48,-64],upper=[64,72,64],cellSize=8,particlesPerAxis=2)
def vector(v):
    return isinstance(v,(list,tuple)) and len(v)==3 and all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in v)

def domain_parameters(d):
    if not isinstance(d,dict) or not vector(d.get('lower')) or not vector(d.get('upper')):raise ValueError('计算域坐标必须为三个有限数值')
    lo,hi=d['lower'],d['upper'];h,n=d.get('cellSize'),d.get('particlesPerAxis')
    if not isinstance(h,(int,float)) or isinstance(h,bool) or not math.isfinite(h) or not 4<=h<=16 or not isinstance(n,(int,float)) or isinstance(n,bool) or n not in (1,2,3,4) or not 1<=h/n<=4:raise ValueError('网格尺寸需为 4–16，每轴粒子数为 1–4，粒子间距需为 1–4')
    n=int(n);size=[b-a for a,b in zip(lo,hi)];cells=[math.ceil(hi[a]/h-1e-10)-math.floor(lo[a]/h+1e-10) for a in range(3)]
    if any(lo[a]<-2400 or hi[a]>2400 or size[a]<h or cells[a]>60 for a in range(3)):raise ValueError('计算域须位于 −2400 至 2400 内，每轴最多 60 个网格且至少一个网格')
    origin=[math.floor(x/h)*h-2*h for x in lo];nodes=[math.ceil((hi[a]-origin[a])/h)+3 for a in range(3)]
    return dict(lower=list(lo),upper=list(hi),cellSize=h,particlesPerAxis=n,spacing=h/n,size=size,cells=cells,nodes=nodes,origin=origin,particlesPerCell=n**3)

def geometry_parameters(d,domain):
    shape=d.get('shape','box');rot=d.get('rotation',[0,0,0]);center=d.get('center');size=d.get('size')
    if center is None or size is None:
        a,b=d.get('a'),d.get('b')
        if not vector(a) or not vector(b):raise ValueError('几何中心与尺寸无效')
        center=[(x+y)/2 for x,y in zip(a,b)];size=[abs(y-x) for x,y in zip(a,b)]
    if shape not in ('box','ellipsoid','cylinder') or not vector(center) or not vector(size) or any(x<=0 or x>480 for x in size):raise ValueError('几何中心与尺寸无效')
    if not vector(rot) or any(abs(x)>360 for x in rot):raise ValueError('旋转角度需在 −360° 至 360° 之间')
    x,y,z=[v*math.pi/180 for v in rot];cx,sx,cy,sy,cz,sz=math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
    R=np.array([[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]])
    half=np.array(size)*.5;extent=np.abs(R)@half if shape=='box' else np.linalg.norm(R*half,axis=1) if shape=='ellipsoid' else np.hypot(R[:,0]*half[0],R[:,2]*half[2])+np.abs(R[:,1])*half[1]
    lo=np.array(center)-extent;hi=np.array(center)+extent
    if np.any(lo<np.array(domain['lower'])-1e-8) or np.any(hi>np.array(domain['upper'])+1e-8):raise ValueError('旋转后的几何超出计算域，请调整位置、尺寸或计算域')
    volume=math.prod(size)*({'box':1,'ellipsoid':math.pi/6,'cylinder':math.pi/4}[shape]);spacing=domain['spacing']
    first=np.ceil(lo/spacing-.5-1e-10).astype(int);last=np.ceil(hi/spacing-.5-1e-10).astype(int)-1
    candidates=math.prod(np.maximum(0,last-first+1).tolist())
    if candidates>4_000_000:raise ValueError('几何候选采样超过 400 万，请增大粒子间距或减小尺寸')
    return dict(shape=shape,center=center,size=size,rotation=rot,R=R,lower=lo,upper=hi,volume=volume,spacing=spacing,first=first,last=last,candidates=candidates)

def geometry_points(g,capacity):
    # Generate a z-slab at a time; a thin rotated body must not allocate its full AABB.
    xs,ys=[np.arange(g['first'][a],g['last'][a]+1) for a in (0,1)];y,x=np.meshgrid(ys,xs,indexing='ij');xy=np.column_stack((x.ravel(),y.ravel()));chunks=[];count=0
    for z in range(g['first'][2],g['last'][2]+1):
        p=(np.column_stack((xy,np.full(len(xy),z)))+.5)*g['spacing'];q=((p-g['center'])@g['R'])*2/g['size']
        keep=np.all(np.abs(q)<=1+1e-10,axis=1)
        if g['shape']!='box':keep&=(np.sum(q*q,axis=1) if g['shape']=='ellipsoid' else q[:,0]**2+q[:,2]**2)<=1+1e-10
        p=p[keep];chunks.append(p);count+=len(p)
        if count>capacity:raise ValueError('粒子容量不足，请增大粒子间距或减小几何')
    if not count:raise ValueError('几何内没有采样点，请减小粒子间距或增大尺寸')
    return np.concatenate(chunks)
