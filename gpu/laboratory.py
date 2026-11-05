"""Part identity, initial conditions and full-population diagnostics."""
import math
import numpy as np
import taichi as ti

MAX_PARTS=128
V3=ti.types.vector(3,ti.f32)

@ti.data_oriented
class Laboratory:
    def __init__(self,solver,capacity):
        self.s=solver
        self.part=ti.field(ti.i32,shape=capacity)
        self.reference=ti.Vector.field(3,ti.f32,shape=capacity)
        self.values=ti.field(ti.f64,shape=(MAX_PARTS,20))
        self.reset()

    def reset(self):
        self.names={0:'未分组'}
        self.definitions={}
        self.next_id=1

    @ti.kernel
    def assign(self,start:ti.i32,end:ti.i32,part:ti.i32):
        for i in range(start,end):
            self.part[i]=part

    def register(self,start,name=''):
        part=self.next_id;self.next_id+=1
        self.names[part]=str(name).strip()[:48] or f'部件 {part}'
        self.assign(start,self.s.count,part)
        return part

    @ti.kernel
    def measure(self,n:ti.i32):
        for p,k in self.values:
            self.values[p,k]=0
            if 14<=k<17:self.values[p,k]=1e30
            if 17<=k<20:self.values[p,k]=-1e30
        for i in range(n):
            p=self.part[i];m=self.s.mass[i];x=self.s.x[i];v=self.s.v[i]
            self.values[p,0]+=1;self.values[p,1]+=m
            for a in ti.static(range(3)):
                self.values[p,2+a]+=m*x[a]
                self.values[p,5+a]+=m*v[a]
                ti.atomic_min(self.values[p,14+a],x[a])
                ti.atomic_max(self.values[p,17+a],x[a])
            self.values[p,8]+=.5*m*v.norm_sqr()
            ti.atomic_max(self.values[p,9],v.norm())
            ti.atomic_max(self.values[p,10],(x-self.reference[i]).norm())
            self.values[p,11]+=self.s.pinned[i]
            ti.atomic_max(self.values[p,12],self.s.stress[i])
            ti.atomic_max(self.values[p,13],self.s.plastic[i])

    def snapshot(self):
        self.measure(self.s.count)
        rows=self.values.to_numpy();result=[]
        for p,r in enumerate(rows):
            if r[0]:
                result.append(dict(id=p,name=self.names.get(p,f'部件 {p}'),geometry=self.definitions.get(p),count=int(r[0]),mass=float(r[1]),
                    center=(r[2:5]/r[1]).tolist(),velocity=(r[5:8]/r[1]).tolist(),kinetic=float(r[8]),
                    maxSpeed=float(r[9]),displacement=float(r[10]),pinned=int(r[11]),stress=float(r[12]),plastic=float(r[13]),bounds=[r[14:17].tolist(),r[17:20].tolist()]))
        return result

    @ti.kernel
    def edit(self,n:ti.i32,part:ti.i32,kind:ti.i32,velocity:V3,omega:V3,center:V3):
        for i in range(n):
            if part<0 or self.part[i]==part:
                if kind==0 and not self.s.pinned[i]:
                    self.s.v[i]=ti.min(160.0,ti.max(-160.0,velocity+omega.cross(self.s.x[i]-center)))
                    self.s.C[i]=ti.Matrix([[0.0,-omega[2],omega[1]],[omega[2],0.0,-omega[0]],[-omega[1],omega[0],0.0]])
                elif kind==1 or kind==2:
                    pin=1 if kind==1 else 0
                    self.s.pinned[i]=pin;self.s.inv_mass[i]=(1-pin)/self.s.mass[i]
                    self.s.anchor[i]=self.s.x[i]
                    self.s.v[i]=ti.Vector.zero(ti.f32,3)
                    self.s.C[i]=ti.Matrix.zero(ti.f32,3,3)

    def command(self,d):
        part=d.get('id',-1);action=d.get('action')
        if not isinstance(part,int) or part < -1 or part not in self.names and part!=-1:return False
        if action=='rename':
            name=d.get('name')
            if part<0 or not isinstance(name,str) or not name.strip():return False
            self.names[part]=name.strip()[:48];return True
        if action not in ('velocity','pin','release'):return False
        v,w=d.get('velocity',[0,0,0]),d.get('angular',[0,0,0])
        if not all(isinstance(a,list) and len(a)==3 and all(isinstance(x,(int,float)) and math.isfinite(x) and abs(x)<=limit for x in a) for a,limit in [(v,80),(w,1)]):return False
        rows=[r for r in self.snapshot() if part<0 or r['id']==part]
        if not rows:return False
        mass=sum(r['mass'] for r in rows)
        center=sum((np.array(r['center'])*r['mass'] for r in rows),np.zeros(3))/mass
        self.edit(self.s.count,part,{'velocity':0,'pin':1,'release':2}[action],v,w,center)
        self.s.drag_point=None
        return True
