"""Opt-in PBD coupling, not a replacement for MPM/FEM constitutive laws.

Density and unilateral distance constraints are solved in alternating groups.
Corrections are mass weighted, with a symmetric row bound for shared DOFs.
Two position-only pre-stabilization passes precede prediction (Macklin 2014,
section 4.4). The main projection adds delta-x / h to native velocities.
Coulomb friction remains a velocity-level pass with the PBD normal impulse
as its budget. Heat uses the existing conservative thermal operator.
"""
import taichi as ti
from mixed_solver import L
from particle_interface import ParticleInterface

@ti.data_oriented
class PBDParticleInterface(ParticleInterface):
    @ti.kernel
    def project_pbd(self,h:ti.f64,feedback:ti.i32):
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
                                if depth>1e-7 and wi+wj>0:
                                    bound=wi*self.degree[i]+wj*self.degree[j]
                                    correction=normal*(.8*(depth-1e-7)/ti.max(bound,1e-30))
                                    self.dx[i]+=wi*correction;self.dx[j]-=wj*correction
                                    if feedback:
                                        old_depth=ti.max(0.,self.reach-ti.cast(self.o.motion_x[i]-self.o.motion_x[j],ti.f64).norm()*L)
                                        # Residual overlap already present at t_n
                                        # is stabilization, not a velocity kick.
                                        fraction=ti.min(1.,ti.max(0.,depth-old_depth)/ti.max(depth-1e-7,1e-30))
                                        J=correction*(fraction/h)
                                        self.dv[i]+=wi*J;self.dv[j]-=wj*J
                                        # support is the reaction opposite the impulse
                                        # that an unconstrained endpoint would receive.
                                        if wi==0:self.o.support[None]-=J
                                        if wj==0:self.o.support[None]+=J
                                        signed=self.o.fluid_sign*J
                                        point=ti.cast(self.s.x[i],ti.f64)*L
                                        if ti.static(self.o.fluid_sign<0):point=ti.cast(self.s.x[j],ti.f64)*L
                                        torque=(point-ti.Vector(self.o.fluid_center)).cross(signed)
                                        for axis in ti.static(range(3)):
                                            self.o.totals[pid,axis]+=signed[axis];self.o.totals[pid,12+axis]+=torque[axis]
                                        self.o.totals[pid,7]+=J.norm();self.o.totals[pid,4]+=1
                                        ti.atomic_max(self.o.totals[pid,5],depth)

    def solve_pbd(self,h,feedback):
        if self.o.fluid_pair<0:return
        self.s.clear_neighbors();self.s.build_neighbors(self.n)
        self.count();self.project_pbd(h,int(feedback));self.apply()

@ti.data_oriented
class UnifiedPBD:
    def __init__(self,owner,iterations):
        self.o=owner;self.iterations=iterations
        self.particles=PBDParticleInterface(owner,owner.particle_interface.reach*2-owner.c.radius*2)
        # Existing scatter accumulates velocity-sized increments; save support
        # during position-only stabilization, which is not an impulse.
        self.support_before=ti.Vector.field(3,ti.f64,shape=())
        self.dx=ti.Vector.field(3,ti.f64,shape=owner.n)
        self.du=ti.Vector.field(3,ti.f64,shape=owner.nn)
        self.dr=ti.Vector.field(3,ti.f64,shape=1)

    @ti.func
    def initial_depth(self,k):
        o=self.o;depth=ti.cast(0.,ti.f64)
        if k>=o.n and k<2*o.n:
            depth=o.rr+o.c.radius-(ti.cast(o.motion_x[k-o.n],ti.f64)*L-o.motion_r[0]).norm()
        elif o.triangle[k]>=0:
            ids=o.c.tris[o.triangle[k]]
            a=o.c.nodes[ids[0]]+o.motion_u[ids[0]];b=o.c.nodes[ids[1]]+o.motion_u[ids[1]];c=o.c.nodes[ids[2]]+o.motion_u[ids[2]]
            point=o.motion_r[0];radius=o.rr
            if k<o.n:point=ti.cast(o.motion_x[k],ti.f64)*L;radius=o.c.radius
            depth=-o.sphere_gap(point,a,b,c,radius)
        return ti.max(0.,depth)

    @ti.kernel
    def project(self,h:ti.f64,feedback:ti.i32):
        o=self.o
        self.support_before[None]=o.support[None]
        for i in range(max(o.n,o.nn)):
            if i<o.n:o.pdv[i]=ti.Vector.zero(ti.f64,3);self.dx[i]=ti.Vector.zero(ti.f64,3)
            if i<o.nn:o.c.dv[i]=ti.Vector.zero(ti.f64,3);self.du[i]=ti.Vector.zero(ti.f64,3)
            if i==0:o.rdv[0]=ti.Vector.zero(ti.f64,3);o.rdw[0]=ti.Vector.zero(ti.f64,3);self.dr[0]=ti.Vector.zero(ti.f64,3)
        for k in range(o.ncontacts):
            pid=o.pids[o.slot(k)]
            if pid>=0 and o.active[k] and o.params[pid][0]>0 and o.cd[k]>1e-7:
                # For closest-triangle normal contact, map * normal equals
                # barycentric-weight * normal: the distance gradient. Sphere
                # normal impulses have zero angular gradient.
                correction=o.cn[k]*(.8*(o.cd[k]-1e-7)/o.bound[k])
                if k<2*o.n:self.dx[k%o.n]+=correction*ti.cast(o.s.inv_mass[k%o.n],ti.f64)
                if k>=o.n:
                    sign=1.
                    if k<2*o.n:sign=-1.
                    self.dr[0]+=sign*o.rinv*correction
                if o.triangle[k]>=0:
                    for a in ti.static(range(3)):
                        node=o.c.tris[o.triangle[k]][a];delta=-(o.maps[k,a]@correction)/o.c.mass[node]
                        for axis in ti.static(range(3)):
                            if not o.c.fixed[node,axis]:self.du[node][axis]+=delta[axis]
                if feedback:
                    fraction=ti.min(1.,ti.max(0.,o.cd[k]-self.initial_depth(k))/ti.max(o.cd[k]-1e-7,1e-30))
                    J=correction*(fraction/h);o.scatter(k,J)
                    o.jn[k]=J.norm()
                    for axis in ti.static(range(3)):o.totals[pid,axis]+=o.signs[o.slot(k)]*J[axis]
                    o.totals[pid,7]+=J.norm();o.totals[pid,4]+=1
                    ti.atomic_max(o.totals[pid,5],o.cd[k])
        for i in range(max(o.n,o.nn)):
            if i<o.n:
                o.s.x[i]+=ti.cast(self.dx[i]/L,ti.f32)
                if feedback:o.s.v[i]+=ti.cast(o.pdv[i]/L,ti.f32)
            if i<o.nn:
                o.c.u[i]+=self.du[i]
                if feedback:o.c.v[i]+=o.c.dv[i]
            if i==0:
                o.rx[0]+=self.dr[0]
                if feedback:o.rv[0]+=o.rdv[0];o.rw[0]+=o.rdw[0]
        if not feedback:o.support[None]=self.support_before[None]

    def contacts(self,h,feedback):
        o=self.o
        self.particles.solve_pbd(h,feedback)
        o.c.prepare_surface();o.c.find_contacts();o.find();o.contact_bound()
        self.project(h,int(feedback))
        if feedback:o.contact(1)

    def stabilize(self,h):
        for _ in range(2):self.contacts(h,False)

    def solve(self,h):
        o=self.o;s=o.s
        o.check_swept();o.check_motion()
        for _ in range(self.iterations):
            # Native PBF is deferred into this loop, not run twice.
            o.pressure_start();s.clear_neighbors();s.build_neighbors(o.n)
            s.density(o.n);s.corrections(o.n,1,h,3,0)
            o.record_fluid_pressure(h);s.apply_corrections(o.n,1,0,0.,0)
            o.pressure_finish(h)
            self.contacts(h,True)
