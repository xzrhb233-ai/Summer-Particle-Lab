"""Separate APIC velocity fields and unilateral, gap-gated MPM contact."""
import taichi as ti
from solver import N
L=.025

@ti.data_oriented
class MaterialContact:
    def __init__(self,project):
        self.project,self.s,self.pairs=project,project.s,project.pairs
        self.enabled=ti.field(ti.i32,shape=())
        self.fixed=ti.field(ti.i32,shape=(16,N,N,N))
        self.gradient=ti.Vector.field(3,ti.f64,shape=(16,N,N,N))
        self.moment=ti.Vector.field(3,ti.f64,shape=(16,N,N,N))
        self.contact_mask=ti.field(ti.u32,shape=(16,N,N,N))
        self.particle_mask=ti.field(ti.u32,shape=16384)
        self.reach=ti.field(ti.f32,shape=())
        self.speed=ti.field(ti.f32,shape=())
        self.counts=ti.field(ti.i32,shape=N**3)
        self.prefix=ti.field(ti.i32,shape=N**3)
        self.cursor=ti.field(ti.i32,shape=N**3)
        self.ids=ti.field(ti.i32,shape=16384*27)
        self.scan=ti.algorithms.PrefixSumExecutor(N**3)
        self.com=ti.Vector.field(3,ti.f64,shape=16)
        self.total=ti.field(ti.f64,shape=16)
        self.work=ti.field(ti.f64,shape=3)
        self.parts=0

    def initialize(self,model):
        self.parts=len(model['coupling']['parts'])
        self.enabled[None]=int(self.parts>1)
        self.work.fill(0)

    @ti.kernel
    def bounds(self,n:ti.i32):
        self.reach[None]=0.;self.speed[None]=0.
        for p in range(n):
            self.particle_mask[p]=ti.u32(0)
            if self.s.is_solid(p):
                ti.atomic_max(self.reach[None],(64*self.s.volume[p])**(1./3.)*self.s.F[p].norm())
                ti.atomic_max(self.speed[None],self.s.v[p].norm())

    @ti.kernel
    def near_domains(self,n:ti.i32,dt:ti.f32):
        skin=self.s.mpm_h[None]*.002
        span=ti.cast(ti.ceil((self.reach[None]+2*self.speed[None]*dt+skin)/self.s.neighbor_h[None]),ti.i32)
        for p in range(n):
            if self.s.is_solid(p):
                cell=self.s.cell(self.s.x[p]);a=self.s.lab.part[p]-1
                for x,y,z in ti.ndrange((-span,span+1),(-span,span+1),(-span,span+1)):
                    c=cell+ti.Vector([x,y,z])
                    if c.min()>=0 and c.max()<N:
                        cid=self.s.cell_id(c)
                        for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                            q=self.s.sorted_ids[slot];b=self.s.lab.part[q]-1
                            if q>p and a!=b and self.s.is_solid(q) and self.pairs.material_params[a,b,0]>.5:
                                d=self.s.x[q]-self.s.x[p];r=d.norm()
                                if r>1e-10:
                                    normal=d/r
                                    ra=.5*(64*self.s.volume[p])**(1./3.)*(self.s.F[p].transpose()@normal).norm()
                                    rb=.5*(64*self.s.volume[q])**(1./3.)*(self.s.F[q].transpose()@normal).norm()
                                    gap=r-ra-rb;vn=(self.s.v[q]-self.s.v[p]).dot(normal)
                                    if gap<=skin+ti.max(0.,-vn*dt):
                                        ti.atomic_or(self.particle_mask[p],ti.u32(1)<<b)
                                        ti.atomic_or(self.particle_mask[q],ti.u32(1)<<a)
                                        depth=ti.max(0.,-gap)*L
                                        ti.atomic_max(self.project.penetration[None],depth)
                                        ti.atomic_max(self.pairs.material_stats[ti.min(a,b),ti.max(a,b),12],ti.cast(depth,ti.f64))

    @ti.kernel
    def scatter(self,n:ti.i32,dt:ti.f32):
        h=self.s.mpm_h[None];origin=self.s.mpm_origin[None]
        for key in ti.grouped(self.pairs.mass):
            self.pairs.mass[key]=0.;self.pairs.delta[key]=ti.Vector.zero(ti.f32,3)
            self.gradient[key]=ti.Vector.zero(ti.f32,3);self.moment[key]=ti.Vector.zero(ti.f32,3);self.fixed[key]=0
            self.contact_mask[key]=ti.u32(0)
        for i in self.counts:self.counts[i]=0;self.cursor[i]=0
        for a in self.total:self.total[a]=0.;self.com[a]=ti.Vector.zero(ti.f32,3)
        for p in range(n):
            if self.s.is_solid(p):
                part=self.s.lab.part[p]-1;mass=self.s.mass[p]
                self.total[part]+=mass;self.com[part]+=mass*self.s.x[p]*L
                base=ti.cast(ti.floor((self.s.x[p]-origin)/h-.5),ti.i32)
                fx=(self.s.x[p]-origin)/h-base;w=self.s.weights(fx)
                dw=ti.Matrix.rows([(fx-1.5)/h,-2*(fx-1)/h,(fx-.5)/h])
                affine=mass*self.s.C[p]-dt*64*self.s.volume[p]*4/(h*h)*self.s.tau[p]
                for x,y,z in ti.static(ti.ndrange(3,3,3)):
                    offset=ti.Vector([x,y,z]);I=base+offset;key=ti.Vector([part,I[0],I[1],I[2]])
                    weight=w[x,0]*w[y,1]*w[z,2]
                    self.pairs.mass[key]+=weight*mass
                    self.pairs.delta[key]+=weight*(mass*self.s.v[p]+affine@((offset-fx)*h))
                    if self.s.pinned[p] and weight>1e-8:ti.atomic_max(self.fixed[key],1)
                    if weight>1e-10:
                        ti.atomic_or(self.contact_mask[key],self.particle_mask[p])
                        self.gradient[key]+=mass*ti.Vector([dw[x,0]*w[y,1]*w[z,2],w[x,0]*dw[y,1]*w[z,2],w[x,0]*w[y,1]*dw[z,2]])
                        self.moment[key]+=mass*weight*self.s.x[p]
                        self.counts[(I[0]*N+I[1])*N+I[2]]+=1
        for key in ti.grouped(self.pairs.mass):
            mass=self.pairs.mass[key]
            if mass>1e-12:
                I=ti.Vector([key[1],key[2],key[3]]);q=origin+ti.cast(I,ti.f32)*h
                v=self.pairs.delta[key]/mass
                for a in ti.static(range(3)):
                    if self.fixed[key] or (q[a]<self.s.domain_lo[None][a]+h and v[a]<0) or (q[a]>self.s.domain_hi[None][a]-h and v[a]>0):v[a]=0
                self.pairs.delta[key]=v
        for a in self.total:
            if self.total[a]>0:self.com[a]/=self.total[a]

    @ti.kernel
    def fill_clouds(self,n:ti.i32):
        h=self.s.mpm_h[None];origin=self.s.mpm_origin[None]
        for p in range(n):
            if self.s.is_solid(p):
                base=ti.cast(ti.floor((self.s.x[p]-origin)/h-.5),ti.i32)
                w=self.s.weights((self.s.x[p]-origin)/h-base)
                for x,y,z in ti.static(ti.ndrange(3,3,3)):
                    if w[x,0]*w[y,1]*w[z,2]>1e-10:
                        I=base+ti.Vector([x,y,z]);cid=(I[0]*N+I[1])*N+I[2]
                        slot=ti.atomic_add(self.cursor[cid],1)
                        self.ids[self.prefix[cid]-self.counts[cid]+slot]=p

    def transfer(self,n,dt):
        self.bounds(n);self.s.clear_neighbors();self.s.build_neighbors(n);self.near_domains(n,dt)
        self.scatter(n,dt);self.prefix.copy_from(self.counts)
        self.scan.run(self.prefix);self.fill_clouds(n)

    @ti.kernel
    def contact(self,parts:ti.i32,dt:ti.f32):
        h=self.s.mpm_h[None]
        for cid in self.counts:
            if self.counts[cid]>0:
                I=ti.Vector([cid//(N*N),cid//N%N,cid%N])
                for a in range(parts):
                    for b in range(a+1,parts):
                        ka=ti.Vector([a,I[0],I[1],I[2]]);kb=ti.Vector([b,I[0],I[1],I[2]])
                        ma,mb=self.pairs.mass[ka],self.pairs.mass[kb]
                        if self.pairs.material_params[a,b,0]>.5 and ma>1e-10 and mb>1e-10 and (self.contact_mask[ka]&(ti.u32(1)<<b))!=0 and (self.contact_mask[kb]&(ti.u32(1)<<a))!=0:
                            difference=self.moment[kb]/mb-self.moment[ka]/ma
                            normal=self.gradient[kb]/mb-self.gradient[ka]/ma
                            if normal.norm()<1e-8:normal=difference
                            length=normal.norm()
                            if length>1e-10:
                                normal/=length
                                if normal.dot(difference)<0:normal=-normal
                                upper,lower=ti.cast(-1e20,ti.f64),ti.cast(1e20,ti.f64)
                                for slot in range(self.prefix[cid]-self.counts[cid],self.prefix[cid]):
                                    p=self.ids[slot];part=self.s.lab.part[p]-1
                                    if part==a or part==b:
                                        extent=.5*(64*self.s.volume[p])**(1./3.)*(self.s.F[p].transpose()@normal).norm()
                                        center=self.s.x[p].dot(normal)
                                        if part==a:upper=ti.max(upper,center+extent)
                                        else:lower=ti.min(lower,center-extent)
                                gap=(lower-upper)*L;skin=h*L*.002
                                relative=(self.pairs.delta[kb]-self.pairs.delta[ka])*L;vn=relative.dot(normal)
                                ia=0. if self.fixed[ka] else 1/ma;ib=0. if self.fixed[kb] else 1/mb;W=ia+ib
                                if W>0 and gap<=skin+ti.max(0.,-vn*dt):
                                    jn=ti.max(0.,-vn-ti.max(0.,gap-skin)/dt)/W
                                    tangent=relative-vn*normal;speed=tangent.norm();jt=ti.min(self.pairs.material_params[a,b,2]*jn,speed/W)
                                    J=jn*normal
                                    if speed>1e-12:J-=jt*tangent/speed
                                    self.pairs.delta[ka]-=J*ia/L;self.pairs.delta[kb]+=J*ib/L
                                    normal_work=jn*vn+.5*jn*jn*W
                                    friction_work=-jt*speed+.5*jt*jt*W
                                    self.work[0]+=normal_work;self.work[1]+=friction_work
                                    self.work[2]+=ti.max(0.,normal_work+friction_work)
                                    point=(self.s.mpm_origin[None]+ti.cast(I,ti.f32)*h)*L
                                    # Both torque ledgers use each material's COM.
                                    ta=(point-self.com[a]).cross(-J);tb=(point-self.com[b]).cross(J)
                                    for k in ti.static(range(3)):
                                        self.pairs.material_stats[a,b,k]-=ti.cast(J[k],ti.f64)
                                        self.pairs.material_stats[a,b,k+3]+=ti.cast(ta[k],ti.f64)
                                        self.pairs.material_stats[b,a,k+3]+=ti.cast(tb[k],ti.f64)
                                        self.pairs.material_stats[a,b,k+7]-=ti.cast(J[k]-jn*normal[k],ti.f64)
                                    self.pairs.material_stats[a,b,6]+=ti.cast(jn,ti.f64)
                                    self.pairs.material_stats[a,b,10]+=ti.cast(speed,ti.f64)
                                    self.pairs.material_stats[a,b,11]+=1.
