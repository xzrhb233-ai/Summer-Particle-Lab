"""Free-slip, two-way MPM/PBF exclusion, independent of fluid density pressure.

Particle radii are discretization radii, not a reconstructed watertight surface.
All work and scratch stay on the GPU. Pair impulses are central and opposite;
mass-weighted position cleanup is separate from velocity (no overlap/h kick).
"""
import taichi as ti
from mixed_solver import L

@ti.data_oriented
class ParticleInterface:
    def __init__(self,owner,water_spacing):
        self.o=owner;self.s=owner.s;self.n=owner.n;self.nm=owner.nm
        self.reach=owner.c.radius+water_spacing*.5
        if self.reach>L*8:raise ValueError('MPM–PBF contact radius exceeds neighbor support')
        self.degree=ti.field(ti.i32,shape=self.n)
        self.dv=ti.Vector.field(3,ti.f64,shape=self.n)
        self.dx=ti.Vector.field(3,ti.f64,shape=self.n)

    @ti.func
    def geometry(self,i,j):
        d=ti.cast(self.s.x[i]-self.s.x[j],ti.f64)*L;r=d.norm()
        normal=ti.Vector([1.,0.,0.],dt=ti.f64)
        if r>1e-12:normal=d/r
        else:
            before=ti.cast(self.o.motion_x[i]-self.o.motion_x[j],ti.f64)*L
            if before.norm()>1e-12:normal=before.normalized()
            else:
                v=ti.cast(self.s.v[i]-self.s.v[j],ti.f64)
                if v.norm()>1e-12:normal=-v.normalized()
        return normal,ti.max(0.,self.reach-r)

    @ti.kernel
    def count(self):
        for i in range(self.n):
            self.degree[i]=0;self.dv[i]=ti.Vector.zero(ti.f64,3);self.dx[i]=ti.Vector.zero(ti.f64,3)
        for i in range(self.nm):
            if ti.static(self.o.fluid_pair>=0):
                if self.o.params[self.o.fluid_pair][0]>0:
                    cell=self.s.cell_index[i]
                    for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                        cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
                        for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                            j=self.s.sorted_ids[slot]
                            if j>=self.nm and self.s.inv_mass[i]+self.s.inv_mass[j]>0:
                                normal,depth=self.geometry(i,j)
                                if depth>0:self.degree[i]+=1;self.degree[j]+=1

    @ti.kernel
    def project(self):
        for i in range(self.nm):
            if ti.static(self.o.fluid_pair>=0):
                pid=self.o.fluid_pair
                if self.o.params[pid][0]>0:
                    cell=self.s.cell_index[i]
                    for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                        cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
                        for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                            j=self.s.sorted_ids[slot]
                            if j>=self.nm:
                                wi=ti.cast(self.s.inv_mass[i],ti.f64);wj=ti.cast(self.s.inv_mass[j],ti.f64)
                                normal,depth=self.geometry(i,j)
                                if depth>0 and wi+wj>0:
                                    # Absolute row-sum bound for the shared-DOF
                                    # contact operator; simultaneous neighbors
                                    # cannot each apply a full two-body impulse.
                                    bound=wi*self.degree[i]+wj*self.degree[j]
                                    v=ti.cast(self.s.v[i]-self.s.v[j],ti.f64)*L
                                    impulse=ti.max(0.,-v.dot(normal))/ti.max(bound,1e-30)
                                    J=normal*impulse
                                    correction=normal*(.8*ti.max(0.,depth-1e-7)/ti.max(bound,1e-30))
                                    self.dv[i]+=wi*J;self.dv[j]-=wj*J
                                    if wi==0:self.o.support[None]+=J
                                    if wj==0:self.o.support[None]-=J
                                    self.dx[i]+=wi*correction;self.dx[j]-=wj*correction
                                    signed=self.o.fluid_sign*J
                                    point=ti.cast(self.s.x[i],ti.f64)*L
                                    if ti.static(self.o.fluid_sign<0):point=ti.cast(self.s.x[j],ti.f64)*L
                                    torque=(point-ti.Vector(self.o.fluid_center)).cross(signed)
                                    for axis in ti.static(range(3)):
                                        self.o.totals[pid,axis]+=signed[axis];self.o.totals[pid,12+axis]+=torque[axis]
                                    self.o.totals[pid,7]+=impulse;self.o.totals[pid,4]+=1
                                    ti.atomic_max(self.o.totals[pid,5],depth)

    @ti.kernel
    def apply(self):
        for i in range(self.n):
            self.s.v[i]+=ti.cast(self.dv[i]/L,ti.f32)
            self.s.x[i]+=ti.cast(self.dx[i]/L,ti.f32)

    def solve(self):
        if self.o.fluid_pair<0:return
        self.s.clear_neighbors();self.s.build_neighbors(self.n)
        self.count();self.project();self.apply()
