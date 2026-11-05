"""MPM-led unified Taichi solver. Native-domain kernels and shared GPU fields.

One sphere, one Tet4 solid and two particle groups. All physical updates run in
Taichi kernels. Host orchestration launches a fixed shared clock; only output
frames read fields. Contact is bounded Jacobi, with wrench-preserving FEM maps.
"""
import copy,math,time
import numpy as np
import taichi as ti
from mixed_solver import MixedSolver,field,L
from mixed_thermal import MixedThermalLoads
from mixed_energy import disabled_energy
from particle_interface import ParticleInterface
from mpm_framework import MPMFramework

@ti.data_oriented
class UnifiedMPMSolver:
    def __init__(self,data):
        self.optimized=bool(data.get('optimize',True))
        self.project=data['fullProject'];p=self.project;self.nm=data['nm'];self.n=len(data['seed']['points'])
        base=copy.deepcopy(data);base['thermalLoads']=[]
        base['compactNeighbors']=self.optimized
        self.c=MixedSolver(base);c=self.c;self.s=c.s;self.nn=c.nn;self.device_time=c.device_time
        self.capacity=c.capacity;self.temperature=c.temperature;self.particle_cp=c.particle_cp
        self.particle_cps=field([c.particle_cp]*self.nm+[4180.]*(self.n-self.nm))
        self.pk=field([c.particle_k]*self.nm+[.6]*(self.n-self.nm))
        f,m,w,r=p['parts'];self.rigid=r;self.rmass=r['material']['mass'];self.rr=r['geometry']['size'][0]/2
        self.rinv=0. if r['boundary']['motion']=='fixed' else 1/self.rmass;self.ri=self.rinv/(.4*self.rr**2)
        self.rigid_capacity=self.rmass*r['material']['cp'];self.rk=r['material']['conductivity'];self.rdamping=r['boundary']['damping']
        self.rx=field([r['geometry']['center']],vector=3);self.rv=field([r['initial']['velocity']],vector=3);self.rw=field([r['initial']['angularVelocity']],vector=3)
        # A sphere is orientation-invariant, but its physical rotation is reported.
        self.rq=field([data.get('rigidQuaternion',[0,0,0,1])],vector=4);self.rigid_temperature=field([r['initial']['temperature']])
        self.rdv=ti.Vector.field(3,ti.f64,shape=1);self.rdw=ti.Vector.field(3,ti.f64,shape=1)
        self.pdv=ti.Vector.field(3,ti.f64,shape=self.n);self.pbase=ti.Vector.field(3,ti.f32,shape=self.n)
        self.ncontacts=2*self.n+1;nc=self.ncontacts
        self.active=ti.field(ti.i32,shape=nc);self.triangle=ti.field(ti.i32,shape=nc)
        self.cn=ti.Vector.field(3,ti.f64,shape=nc);self.cw=ti.Vector.field(3,ti.f64,shape=nc);self.ca=ti.Vector.field(3,ti.f64,shape=nc)
        self.cd=ti.field(ti.f64,shape=nc);self.maps=ti.Matrix.field(3,3,ti.f64,shape=(nc,3))
        self.row=ti.field(ti.f64,shape=self.nn);self.rrow=ti.field(ti.f64,shape=());self.rrot=ti.field(ti.f64,shape=());self.bound=ti.field(ti.f64,shape=nc);self.jn=ti.field(ti.f64,shape=nc)
        self.pairs=p['contactPairs'];self.npairs=len(self.pairs)
        self.pair_index=[];self.pair_sign=[]
        for a,b in [(m,f),(w,f),(m,r),(w,r),(r,f)]:
            idx=next((i for i,d in enumerate(self.pairs) if {d['a'],d['b']}=={a['id'],b['id']}),-1)
            self.pair_index.append(idx);self.pair_sign.append(1 if idx<0 or self.pairs[idx]['a']==a['id'] else -1)
        self.pids=field(self.pair_index,ti.i32);self.signs=field(self.pair_sign)
        self.rarea=self.pairs[self.pair_index[4]].get('thermalArea',.001) if self.pair_index[4]>=0 else .001
        self.params=field([[float(d['mechanical']),float(d['thermal']),d['friction'],d['contactConductance'],d.get('thermalToleranceRatio',0)] for d in self.pairs],vector=5)
        self.fluid_pair=next((i for i,d in enumerate(self.pairs) if {d['a'],d['b']}=={m['id'],w['id']}),-1)
        self.fluid_sign=1 if self.fluid_pair<0 or self.pairs[self.fluid_pair]['a']==m['id'] else -1
        self.fluid_center=m['geometry']['center'] if self.fluid_sign==1 else w['geometry']['center']
        self.s.pressure_split[None]=self.nm
        self.s.pressure_cross[None]=int(self.fluid_pair<0 or self.pairs[self.fluid_pair]['mechanical'])
        self.totals=ti.field(ti.f64,shape=(max(1,self.npairs),15)) # Jxyz, Q, samples, depth, heat samples, Jn, Jtxyz, slip, torquexyz
        self.support=ti.Vector.field(3,ti.f64,shape=())
        self.rheat=ti.field(ti.f64,shape=());self.rbudget=ti.field(ti.f64,shape=())
        # Use the authored request and model limits. Contact/motion validation
        # still rolls back and reduces a trial step when necessary.
        self.step_limits=dict(c.step_limits)
        self.dt=min(v for v in self.step_limits.values() if v is not None);self.time=0.;self.steps=0;self.requests=0;self.total_ms=0.;self.last_ms=0.;self.frame_bytes=0
        # A larger starting step must not raise the smallest available contact
        # step. Keep the old 0.2 ms / 256 resolution (or finer for small requests).
        self.minimum_trial_dt=min(self.dt/256,7.8125e-7)
        self.max_contact_retries=math.ceil(math.log2(self.dt/self.minimum_trial_dt))
        self.setup_water(data['water']['mass'],data['water']['volume'],data['water']['velocity'],data['water']['temperature'])
        self.thermal_loads=MixedThermalLoads(self,data['thermalLoads'])
        self.events=sorted(set(c.events+[x[0] for d in data['thermalLoads'] for x in d['definition'].get('program',{}).get('points',[])]))
        self.initial_thermal=self.thermal_energy();self.initial_mpm_energy=float(np.dot(self.s.mass.to_numpy()[:self.nm].astype(float),self.s.enthalpy.to_numpy()[:self.nm]));self.thermal_loads.step(0)
        self.extra_backups=[]
        for a in [self.rx,self.rv,self.rw,self.rq,self.rigid_temperature,self.totals,self.support]:
            b=ti.Vector.field(a.n,ti.f64,shape=a.shape) if hasattr(a,'n') else ti.field(ti.f64,shape=a.shape)
            self.extra_backups.append((a,b))
        self.previous=np.zeros((max(1,self.npairs),15))
        cell=min(x/n for x,n in zip(f['geometry']['size'],f['discretization']['divisions']))
        # Half the relative travel budget per domain. Includes thin FEM cells.
        self.travel_budget=.075*min(c.radius,self.rr,cell)
        self.motion_x=ti.Vector.field(3,ti.f32,shape=self.n)
        self.motion_u=ti.Vector.field(3,ti.f64,shape=self.nn)
        self.motion_r=ti.Vector.field(3,ti.f64,shape=1)
        self.motion_ratio=ti.field(ti.f64,shape=())
        self.swept_hits=ti.field(ti.i32,shape=());self.swept_tests=ti.field(ti.i32,shape=())
        self.swept_unresolved=ti.field(ti.i32,shape=())
        self.last_ccd_retries=0;self.last_swept_tests=0
        self.last_retries=0;self.last_motion_ratio=0.;self.min_dt=self.dt;self.max_dt=self.dt
        self.next_dt=self.dt;self.stable_intervals=0
        self.last_step_trials=[]
        self.particle_interface=ParticleInterface(self,data['water']['spacing'])
        self.framework=MPMFramework(self,L)

    @ti.kernel
    def capture_motion(self):
        for i in range(self.n):self.motion_x[i]=self.s.x[i]
        for a in range(self.nn):self.motion_u[a]=self.c.u[a]
        self.motion_r[0]=self.rx[0]

    @ti.kernel
    def check_motion(self):
        for i in range(self.n):ti.atomic_max(self.motion_ratio[None],ti.cast((self.s.x[i]-self.motion_x[i]).norm(),ti.f64)*L/self.travel_budget)
        for a in range(self.nn):ti.atomic_max(self.motion_ratio[None],(self.c.u[a]-self.motion_u[a]).norm()/self.travel_budget)
        ti.atomic_max(self.motion_ratio[None],(self.rx[0]-self.motion_r[0]).norm()/self.travel_budget)


    @ti.func
    def sphere_gap(self,p,a,b,c,r):
        w=self.c.closest(p,a,b,c)
        return (p-w[0]*a-w[1]*b-w[2]*c).norm()-r

    @ti.func
    def transient_sweep(self,p0,p1,a0,b0,c0,a1,b1,c1,r):
        eps=ti.max(1e-10,r*1e-7);possible=True;inner=r-4*eps
        for axis in ti.static(range(3)):
            lo=ti.min(a0[axis],b0[axis],c0[axis],a1[axis],b1[axis],c1[axis])
            hi=ti.max(a0[axis],b0[axis],c0[axis],a1[axis],b1[axis],c1[axis])
            if ti.max(p0[axis],p1[axis])+r+eps<lo or ti.min(p0[axis],p1[axis])-r-eps>hi:possible=False
        if possible or ti.static(not self.optimized):
            for frame in ti.static(range(2)):
                a=a0;b=b0;c=c0
                if frame==1:a=a1;b=b1;c=c1
                normal=(b-a).cross(c-a);size=normal.norm()
                if size>1e-15:
                    normal/=size
                    lo=ti.min(a0.dot(normal),b0.dot(normal),c0.dot(normal),a1.dot(normal),b1.dot(normal),c1.dot(normal))
                    hi=ti.max(a0.dot(normal),b0.dot(normal),c0.dot(normal),a1.dot(normal),b1.dot(normal),c1.dot(normal))
                    if ti.min(p0.dot(normal),p1.dot(normal))-hi>inner+eps or lo-ti.max(p0.dot(normal),p1.dot(normal))>inner+eps:possible=False
        hit=0
        if possible:
            g0=self.sphere_gap(p0,a0,b0,c0,r);g1=self.sphere_gap(p1,a1,b1,c1,r)
            if g0>eps and g1>eps:
                self.swept_tests[None]+=1
                # In the sphere's translating frame, every point of a linearly
                # moving triangle lies in the convex hull of its six endpoint
                # vertices. A separating plane therefore certifies a WHOLE
                # time interval, including face/edge/vertex grazing. Advancing
                # by gap / total speed instead stalled on tangential motion.
                ra=a0-p0;rb=b0-p0;rc=c0-p0
                da=a1-p1-ra;db=b1-p1-rb;dc=c1-p1-rc
                cell=0;depth=0;count=0;done=False
                while count<256 and not done:
                    width=ti.cast(1.,ti.f64)/ti.cast(1<<depth,ti.f64)
                    lo=cell*width;hi=lo+width;mid=(lo+hi)*.5
                    a=ra+da*mid;b=rb+db*mid;c=rc+dc*mid
                    w=self.c.closest(ti.Vector.zero(ti.f64,3),a,b,c)
                    q=w[0]*a+w[1]*b+w[2]*c;distance=q.norm()
                    if distance<=inner+eps:hit=1;done=True
                    else:
                        axis=q/distance
                        lower=ti.min((ra+da*lo).dot(axis),(rb+db*lo).dot(axis),(rc+dc*lo).dot(axis),
                                     (ra+da*hi).dot(axis),(rb+db*hi).dot(axis),(rc+dc*hi).dot(axis))
                        if lower>inner+eps:
                            # Stackless depth-first traversal: visit the right
                            # sibling, or finish after certifying the last leaf.
                            while depth>0 and cell%2==1:cell//=2;depth-=1
                            if depth==0:done=True
                            else:cell+=1
                        elif depth<20:cell*=2;depth+=1
                        else:
                            hit=1;done=True;self.swept_unresolved[None]+=1
                    count+=1
                if not done:
                    hit=1  # unresolved means retry, never clearance
                    self.swept_unresolved[None]+=1
        return hit

    @ti.kernel
    def check_swept(self):
        for k in range(self.n+1):
            slot=4;radius=self.rr;p0=self.motion_r[0];p1=self.rx[0]
            if k<self.n:
                slot=ti.cast(k>=self.nm,ti.i32);radius=self.c.radius
                p0=ti.cast(self.motion_x[k],ti.f64)*L;p1=ti.cast(self.s.x[k],ti.f64)*L
            pid=self.pids[slot]
            if pid>=0 and self.params[pid][0]>0:
                hits=0
                for t in range(self.c.nt):
                    ids=self.c.tris[t]
                    a0=self.c.nodes[ids[0]]+self.motion_u[ids[0]];a1=self.c.nodes[ids[0]]+self.c.u[ids[0]]
                    b0=self.c.nodes[ids[1]]+self.motion_u[ids[1]];b1=self.c.nodes[ids[1]]+self.c.u[ids[1]]
                    c0=self.c.nodes[ids[2]]+self.motion_u[ids[2]];c1=self.c.nodes[ids[2]]+self.c.u[ids[2]]
                    hit=self.transient_sweep(p0,p1,a0,b0,c0,a1,b1,c1,radius)
                    if ti.static(self.optimized):hits+=hit
                    else:self.swept_hits[None]+=hit
                # Avoid contending on one global counter for every rejected
                # particle/triangle pair. Integer counts are unchanged.
                if ti.static(self.optimized):
                    if hits>0:self.swept_hits[None]+=hits

    @ti.kernel
    def setup_water(self,m:ti.f32,vol:ti.f32,velocity:ti.types.vector(3,ti.f32),T:ti.f64):
        for i in range(self.nm,self.n):
            self.s.material[i]=2;self.s.model[i]=0;self.s.mass[i]=m;self.s.volume[i]=vol
            self.s.inv_mass[i]=1/m;self.s.v[i]=velocity;self.s.enthalpy[i]=4180*T;self.s.temp[i]=ti.cast(T,ti.f32)
            if self.s.pinned[i]:self.s.inv_mass[i]=0;self.s.v[i]=ti.Vector.zero(ti.f32,3)

    @ti.func
    def skew(self,x):
        return ti.Matrix([[0.,-x[2],x[1]],[x[2],0.,-x[0]],[-x[1],x[0],0.]],dt=ti.f64)

    @ti.kernel
    def particle_drift(self,h:ti.f64,begin:ti.i32,end:ti.i32,advect:ti.template()):
        for i in range(begin,end):
            if not self.s.pinned[i]:
                self.s.v[i]+=ti.cast(ti.Vector(self.c.gravity)*h/L,ti.f32)
                if ti.static(advect):self.s.x[i]+=self.s.v[i]*ti.cast(h,ti.f32)

    @ti.kernel
    def rigid_drift(self,h:ti.f64):
        if ti.static(self.rinv>0):
            self.rv[0]+=ti.Vector(self.c.gravity)*h;self.rv[0]*=ti.exp(-self.rdamping*h);self.rw[0]*=ti.exp(-self.rdamping*h);self.rx[0]+=self.rv[0]*h
            q=self.rq[0];w=self.rw[0];v=ti.Vector([q[0],q[1],q[2]]);dq=(q[3]*w+w.cross(v))*.5*h
            self.rq[0]=ti.Vector([v[0]+dq[0],v[1]+dq[1],v[2]+dq[2],q[3]-.5*h*w.dot(v)]).normalized()

    @ti.kernel
    def pressure_start(self):
        for i in range(self.n):self.pbase[i]=self.s.x[i]

    @ti.kernel
    def pressure_finish(self,h:ti.f64):
        for i in range(self.n):
            if not self.s.pinned[i]:self.s.v[i]+=(self.s.x[i]-self.pbase[i])/ti.cast(h,ti.f32)

    @ti.kernel
    def record_fluid_pressure(self,h:ti.f64):
        # Same pair contributions and common limiter as Solver.corrections.
        # Count each MPM/PBF edge once, before applying positions.
        if ti.static(self.fluid_pair>=0):
            if ti.static(self.optimized):
                # A range loop nested under a runtime if is serial in Taichi.
                # Keep the particle loop outermost; check the pair per worker.
                for i in range(self.nm):
                    if self.params[self.fluid_pair][0]>0:self.record_pressure_particle(i,h)
            else:
                if self.params[self.fluid_pair][0]>0:
                    for i in range(self.nm):self.record_pressure_particle(i,h)

    @ti.func
    def record_pressure_particle(self,i,h):
        pid=self.fluid_pair;cell=self.s.cell_index[i]
        sum_J=ti.Vector.zero(ti.f64,3);sum_torque=ti.Vector.zero(ti.f64,3)
        sum_normal=ti.cast(0.,ti.f64);samples=0
        for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
            cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
            for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                j=self.s.sorted_ids[slot]
                if j>=self.nm:
                    d=self.s.x[i]-self.s.x[j];r=d.norm()
                    if r>1e-6 and r<8:
                        q=1-r/8
                        raw=(self.s.lam[i]*self.s.volume[j]+self.s.lam[j]*self.s.volume[i])*(-3*q*q/8/2.08/r)*d
                        J=ti.cast(raw/self.s.max_delta[None],ti.f64)*L/h
                        if J.norm()>0:
                            signed=self.fluid_sign*J
                            torque=(ti.cast(self.s.x[i],ti.f64)*L-ti.Vector(self.fluid_center)).cross(signed)
                            if ti.static(self.optimized):
                                sum_J+=signed;sum_torque+=torque;sum_normal+=J.norm();samples+=1
                            else:
                                for axis in ti.static(range(3)):
                                    self.totals[pid,axis]+=signed[axis];self.totals[pid,12+axis]+=torque[axis]
                                self.totals[pid,7]+=J.norm();self.totals[pid,4]+=1
        if ti.static(self.optimized):
            if samples>0:
                for axis in ti.static(range(3)):
                    self.totals[pid,axis]+=sum_J[axis];self.totals[pid,12+axis]+=sum_torque[axis]
                self.totals[pid,7]+=sum_normal;self.totals[pid,4]+=samples

    @ti.func
    def slot(self,k):
        result=4
        if k<self.n:result=ti.cast(k>=self.nm,ti.i32)
        elif k<2*self.n:result=2+ti.cast(k-self.n>=self.nm,ti.i32)
        return result

    @ti.func
    def map_fem(self,k,point):
        ids=self.c.tris[self.triangle[k]];center=ti.Vector.zero(ti.f64,3);q=ti.Vector.zero(ti.f64,3)
        for a in ti.static(range(3)):
            x=self.c.nodes[ids[a]]+self.c.u[ids[a]];center+=x/3;q+=self.cw[k][a]*x
        S=ti.Matrix.zero(ti.f64,3,3)
        for a in ti.static(range(3)):
            r=self.c.nodes[ids[a]]+self.c.u[ids[a]]-center;S+=r.norm_sqr()*ti.Matrix.identity(ti.f64,3)-r.outer_product(r)
        inverse=S.inverse()
        for a in ti.static(range(3)):
            r=self.c.nodes[ids[a]]+self.c.u[ids[a]]-center
            self.maps[k,a]=self.cw[k][a]*ti.Matrix.identity(ti.f64,3)-self.skew(r)@inverse@self.skew(point-q)

    @ti.kernel
    def find(self):
        for a in range(self.nn):self.row[a]=0
        self.rrow[None]=0;self.rrot[None]=0
        for k in range(self.ncontacts):
            self.active[k]=0;self.triangle[k]=-1;self.jn[k]=0
            slot=self.slot(k);pid=self.pids[slot]
            if pid>=0:
                skin=self.params[pid][4]*self.c.radius
                if k<self.n:
                    if self.c.hit[k]>=0:
                        self.triangle[k]=self.c.hit[k];self.cn[k]=self.c.normal[k];self.cd[k]=self.c.depth[k];self.cw[k]=self.c.weights[k]
                        self.map_fem(k,ti.cast(self.s.x[k],ti.f64)*L)
                elif k<2*self.n:
                    i=k-self.n;d=ti.cast(self.s.x[i],ti.f64)*L-self.rx[0];length=d.norm()
                    self.cd[k]=self.rr+self.c.radius-length;self.cn[k]=d/ti.max(1e-12,length);self.ca[k]=d
                else:
                    best=ti.cast(1e30,ti.f64)
                    for t in range(self.c.nt):
                        ids=self.c.tris[t];a=self.c.nodes[ids[0]]+self.c.u[ids[0]];b=self.c.nodes[ids[1]]+self.c.u[ids[1]];c=self.c.nodes[ids[2]]+self.c.u[ids[2]]
                        weights=self.c.closest(self.rx[0],a,b,c);q=weights[0]*a+weights[1]*b+weights[2]*c;d=self.rx[0]-q;length=d.norm()
                        if length<best:
                            best=length;self.triangle[k]=t;self.cw[k]=weights;self.ca[k]=q-self.rx[0];self.cd[k]=self.rr-length;self.cn[k]=d/ti.max(length,1e-12)
                    if self.triangle[k]>=0:self.map_fem(k,self.rx[0]+self.ca[k])
                valid=(k>=self.n and k<2*self.n) or self.triangle[k]>=0
                if valid and self.cd[k]>=-skin-1e-8:
                    self.active[k]=1
                    if self.params[pid][0]>0 and self.cd[k]>=-1e-8:
                        if self.triangle[k]>=0:
                            for a in ti.static(range(3)):self.row[self.c.tris[self.triangle[k]][a]]+=self.maps[k,a].norm()
                        if k>=self.n:self.rrow[None]+=1;self.rrot[None]+=self.ca[k].norm()

    @ti.func
    def relative(self,k):
        v=ti.Vector.zero(ti.f64,3)
        if k<self.n:v=ti.cast(self.s.v[k],ti.f64)*L
        elif k<2*self.n:v=ti.cast(self.s.v[k-self.n],ti.f64)*L-self.rv[0]-self.rw[0].cross(self.ca[k])
        else:v=self.rv[0]+self.rw[0].cross(self.ca[k])
        if self.triangle[k]>=0:
            for a in ti.static(range(3)):v-=self.maps[k,a].transpose()@self.c.v[self.c.tris[self.triangle[k]][a]]
        return v

    @ti.kernel
    def contact_bound(self):
        for k in range(self.ncontacts):
            self.bound[k]=1
            if self.active[k]:
                value=ti.cast(0.,ti.f64)
                if k<2*self.n:value=2*ti.cast(self.s.inv_mass[k%self.n],ti.f64)
                if k>=self.n:value+=self.rrow[None]*self.rinv+self.rrot[None]*self.ca[k].norm()*self.ri
                if self.triangle[k]>=0:
                    for a in ti.static(range(3)):
                        node=self.c.tris[self.triangle[k]][a];value+=self.maps[k,a].norm()*self.row[node]/self.c.mass[node]
                self.bound[k]=ti.max(value,1e-20)

    @ti.func
    def scatter(self,k,J):
        if k<2*self.n:
            i=k%self.n;self.pdv[i]+=J*ti.cast(self.s.inv_mass[i],ti.f64)
            if self.s.pinned[i]:self.support[None]-=J
        if k>=self.n:
            sign=1.
            if k<2*self.n:sign=-1.
            self.rdv[0]+=sign*J*self.rinv;self.rdw[0]+=sign*self.ca[k].cross(J)*self.ri
            if ti.static(self.rinv==0):self.support[None]-=sign*J
        if self.triangle[k]>=0:
            for a in ti.static(range(3)):
                node=self.c.tris[self.triangle[k]][a];force=-(self.maps[k,a]@J)
                for axis in ti.static(range(3)):
                    if not self.c.fixed[node,axis]:self.c.dv[node][axis]+=force[axis]/self.c.mass[node]
                    else:self.support[None][axis]-=force[axis]

    @ti.kernel
    def contact(self,mode:ti.i32):
        if ti.static(self.optimized):
            # Independent clears share one GPU launch. The following parallel
            # contact loop remains a separate task (a required global barrier).
            for i in range(max(self.n,self.nn)):
                if i<self.n:self.pdv[i]=ti.Vector.zero(ti.f64,3)
                if i<self.nn:self.c.dv[i]=ti.Vector.zero(ti.f64,3)
                if i==0:self.rdv[0]=ti.Vector.zero(ti.f64,3);self.rdw[0]=ti.Vector.zero(ti.f64,3)
        else:
            for i in range(self.n):self.pdv[i]=ti.Vector.zero(ti.f64,3)
            for i in range(self.nn):self.c.dv[i]=ti.Vector.zero(ti.f64,3)
            self.rdv[0]=ti.Vector.zero(ti.f64,3);self.rdw[0]=ti.Vector.zero(ti.f64,3)
        for k in range(self.ncontacts):
            pid=self.pids[self.slot(k)]
            if pid>=0 and self.active[k] and self.params[pid][0]>0 and self.cd[k]>=-1e-8:
                normal=self.cn[k];J=ti.Vector.zero(ti.f64,3);v=self.relative(k);bound=self.bound[k]
                if mode==0:
                    self.jn[k]=ti.max(0.,-v.dot(normal))/bound;J=normal*self.jn[k]
                elif mode==1:
                    tangent=v-v.dot(normal)*normal;speed=tangent.norm();J=-tangent*ti.min(1/bound,self.params[pid][2]*self.jn[k]/ti.max(speed,1e-20))
                else:J=normal*ti.max(0.,self.cd[k]-1e-7)*.5/bound
                self.scatter(k,J)
                if mode<2:
                    for a in ti.static(range(3)):self.totals[pid,a]+=self.signs[self.slot(k)]*J[a]
                    if mode==0:
                        self.totals[pid,4]+=1;self.totals[pid,7]+=self.jn[k];self.totals[pid,11]+=(v-v.dot(normal)*normal).norm()
                        ti.atomic_max(self.totals[pid,5],ti.max(0.,self.cd[k]))
                    else:
                        for a in ti.static(range(3)):self.totals[pid,8+a]+=self.signs[self.slot(k)]*J[a]
                    if k>=self.n:
                        torque=self.ca[k].cross(J)*self.signs[self.slot(k)]
                        for a in ti.static(range(3)):self.totals[pid,12+a]+=torque[a]
        if ti.static(self.optimized):
            # Scatter has finished before this task; applying particle, FEM and
            # rigid increments is independent, so no per-domain launch is needed.
            for i in range(max(self.n,self.nn)):
                if i<self.n:
                    if mode<2:self.s.v[i]+=ti.cast(self.pdv[i]/L,ti.f32)
                    else:self.s.x[i]+=ti.cast(self.pdv[i]/L,ti.f32)
                if i<self.nn:
                    if mode<2:self.c.v[i]+=self.c.dv[i]
                    else:self.c.u[i]+=self.c.dv[i]
                if i==0:
                    if mode<2:self.rv[0]+=self.rdv[0];self.rw[0]+=self.rdw[0]
                    else:self.rx[0]+=self.rdv[0]
        else:
            for i in range(self.n):
                if mode<2:self.s.v[i]+=ti.cast(self.pdv[i]/L,ti.f32)
                else:self.s.x[i]+=ti.cast(self.pdv[i]/L,ti.f32)
            for i in range(self.nn):
                if mode<2:self.c.v[i]+=self.c.dv[i]
                else:self.c.u[i]+=self.c.dv[i]
            if mode<2:self.rv[0]+=self.rdv[0];self.rw[0]+=self.rdw[0]
            else:self.rx[0]+=self.rdv[0]

    @ti.func
    def ptemperature(self,i):return self.s.enthalpy[i]/self.particle_cps[i]

    @ti.func
    def pcapacity(self,i):return ti.cast(self.s.mass[i],ti.f64)*self.particle_cps[i]

    @ti.func
    def interface_g(self,k):
        slot=self.slot(k);pid=self.pids[slot];g=ti.cast(0.,ti.f64)
        if pid>=0 and self.active[k] and self.params[pid][1]>0 and self.params[pid][3]>0:
            ka=ti.cast(self.rk,ti.f64);kb=ti.cast(self.c.kf,ti.f64);area=self.c.radius**2*4;length=self.c.radius
            if k<2*self.n:ka=self.pk[k%self.n]
            if k>=self.n and k<2*self.n:kb=self.rk
            if k==2*self.n:area=self.rarea
            if ka>0 and kb>0:
                g=area/(1/self.params[pid][3]+length/ka+length/kb)
                if self.cd[k]<0:g*=ti.max(0.,1+self.cd[k]/ti.max(self.c.radius*self.params[pid][4],1e-20))
        return g

    @ti.func
    def exchange(self,mode,i,j,g,dt):
        # Particle-particle edge, visited once. Row-sum limiter prevents overshoot.
        q=ti.cast(0.,ti.f64)
        if mode==0:self.c.bp[i]+=g;self.c.bp[j]+=g
        else:
            factor=ti.min(1.,ti.min(.45*self.pcapacity(i)/ti.max(dt*self.c.bp[i],1e-30),.45*self.pcapacity(j)/ti.max(dt*self.c.bp[j],1e-30)))
            q=dt*g*(self.ptemperature(j)-self.ptemperature(i))*factor;self.c.qp[i]+=q;self.c.qp[j]-=q
        return q

    @ti.kernel
    def thermal_prepare(self):
        for i in range(self.n):self.c.bp[i]=0;self.c.qp[i]=0
        for a in range(self.nn):self.c.bf[a]=0;self.c.qf[a]=0
        self.rbudget[None]=0;self.rheat[None]=0

    @ti.kernel
    def heat(self,mode:ti.i32,dt:ti.f64):
        for e in range(self.c.np):self.exchange(mode,self.c.ep[e][0],self.c.ep[e][1],self.c.gp[e],dt)
        for i in range(self.n):
            cell=self.s.cell_index[i]
            for a,b,c in ti.ndrange((-1,2),(-1,2),(-1,2)):
                cid=self.s.cell_id(cell+ti.Vector([a,b,c]))
                for slot in range(self.s.prefix[cid]-self.s.counts[cid],self.s.prefix[cid]):
                    j=self.s.sorted_ids[slot]
                    if j>i and j>=self.nm:
                        distance=(self.s.x[i]-self.s.x[j]).norm()*L;reach=4*self.c.radius
                        if distance<reach and self.pk[i]+self.pk[j]>0:
                            g=2*self.pk[i]*self.pk[j]/(self.pk[i]+self.pk[j])*2*self.c.radius*(1-distance/reach)
                            if ti.static(self.fluid_pair>=0):
                                if i<self.nm:
                                    g=0.
                                    pid=self.fluid_pair;length=2*self.c.radius;contact_reach=1.1*length
                                    if self.params[pid][1]>0 and self.params[pid][3]>0 and self.pk[i]>0 and self.pk[j]>0 and distance<contact_reach:
                                        g=length*length*(1-distance/contact_reach)/(1/self.params[pid][3]+self.c.radius/self.pk[i]+self.c.radius/self.pk[j])
                            q=self.exchange(mode,i,j,g,dt)
                            if ti.static(self.fluid_pair>=0):
                                if i<self.nm and mode==1 and g>0:
                                    self.totals[self.fluid_pair,3]+=self.fluid_sign*q;self.totals[self.fluid_pair,6]+=1
        for e in range(self.c.nf):
            i,j=self.c.ef[e][0],self.c.ef[e][1];g=self.c.gf[e]
            if mode==0:self.c.bf[i]+=g;self.c.bf[j]+=g
            else:
                factor=ti.min(1.,ti.min(.45*self.capacity[i]/ti.max(dt*self.c.bf[i],1e-30),.45*self.capacity[j]/ti.max(dt*self.c.bf[j],1e-30)))
                q=dt*g*(self.temperature[j]-self.temperature[i])*factor;self.c.qf[i]+=q;self.c.qf[j]-=q
        for k in range(self.ncontacts):
            g=self.interface_g(k)
            if g>0:
                pid=self.pids[self.slot(k)];capA=ti.cast(self.rigid_capacity,ti.f64);budgetA=self.rbudget[None];TA=self.rigid_temperature[0]
                if k<2*self.n:capA=self.pcapacity(k%self.n);budgetA=self.c.bp[k%self.n];TA=self.ptemperature(k%self.n)
                for a in range(3 if self.triangle[k]>=0 else 1):
                    node=0;weight=ti.cast(1.,ti.f64);capB=ti.cast(self.rigid_capacity,ti.f64);budgetB=self.rbudget[None];TB=self.rigid_temperature[0]
                    if self.triangle[k]>=0:
                        node=self.c.tris[self.triangle[k]][a];weight=self.cw[k][a];capB=self.capacity[node];budgetB=self.c.bf[node];TB=self.temperature[node]
                    conductance=g*weight
                    if mode==0:
                        if k<2*self.n:self.c.bp[k%self.n]+=conductance
                        else:self.rbudget[None]+=conductance
                        if self.triangle[k]>=0:self.c.bf[node]+=conductance
                        else:self.rbudget[None]+=conductance
                    else:
                        factor=ti.min(1.,ti.min(.45*capA/ti.max(dt*budgetA,1e-30),.45*capB/ti.max(dt*budgetB,1e-30)))
                        q=dt*conductance*(TB-TA)*factor
                        if k<2*self.n:self.c.qp[k%self.n]+=q
                        else:self.rheat[None]+=q
                        if self.triangle[k]>=0:self.c.qf[node]-=q
                        else:self.rheat[None]-=q
                        self.totals[pid,3]+=self.signs[self.slot(k)]*q;self.totals[pid,6]+=1

    @ti.kernel
    def heat_apply(self):
        for i in range(self.n):
            self.s.enthalpy[i]+=self.c.qp[i]/ti.cast(self.s.mass[i],ti.f64);self.s.temp[i]=ti.cast(self.ptemperature(i),ti.f32)
        for a in range(self.nn):self.temperature[a]+=self.c.qf[a]/self.capacity[a]
        self.rigid_temperature[0]+=self.rheat[None]/self.rigid_capacity

    @ti.kernel
    def validate_state(self,h:ti.f32):
        if self.s.limits[0]<h*.99999:self.c.status[None]=7
        for i in range(self.n):
            T=self.ptemperature(i)
            if ti.math.isnan(T) or T< -273.15001 or T>1e6:self.c.status[None]=8
            if self.s.v[i].norm()*L*h>self.c.radius*.5:self.c.status[None]=7
            for a in ti.static(range(3)):
                x=self.s.x[i][a];v=self.s.v[i][a]
                if ti.math.isnan(x) or ti.math.isnan(v) or ti.abs(v)>1e5 or x<self.s.domain_lo[None][a] or x>self.s.domain_hi[None][a]:self.c.status[None]=8
            if i<self.nm:
                J=self.s.F[i].determinant()
                if ti.math.isnan(J) or J<1e-6 or J>1e6 or ti.math.isnan(self.s.plastic[i]):self.c.status[None]=8
        for a in range(self.nn):
            if ti.math.isnan(self.c.u[a].norm()) or self.c.u[a].norm()>1 or ti.math.isnan(self.c.v[a].norm()) or ti.math.isinf(self.c.v[a].norm()) or ti.math.isnan(self.temperature[a]) or self.temperature[a]< -273.15001 or self.temperature[a]>1e6:self.c.status[None]=8
        if ti.math.isnan(self.rx[0].norm()) or ti.math.isnan(self.rv[0].norm()) or ti.math.isnan(self.rw[0].norm()) or ti.math.isinf(self.rv[0].norm()) or ti.math.isinf(self.rw[0].norm()) or ti.math.isnan(self.rigid_temperature[0]) or self.rigid_temperature[0]< -273.15001 or self.rigid_temperature[0]>1e6:self.c.status[None]=8
        if (self.rv[0].norm()+self.rw[0].norm()*self.rr)*h>self.c.radius*.5:self.c.status[None]=7
        for a in ti.static(range(3)):
            if self.rx[0][a]-self.rr<self.project['discretization']['mpm']['lower'][a] or self.rx[0][a]+self.rr>self.project['discretization']['mpm']['upper'][a]:self.c.status[None]=8

    def substep(self,h):self.framework.substep(h)

    def checkpoint_extra(self,restore=False):
        for a,b in self.extra_backups:a.copy_from(b) if restore else b.copy_from(a)

    def checkpoint(self,restore=False):self.framework.checkpoint(restore)

    def step(self,duration,emit=True):
        if not isinstance(duration,(int,float)) or not math.isfinite(duration) or not 0<duration<=1 or self.time+duration>60:raise ValueError('Invalid four-method interval')
        stops=[t for t in self.events if self.time+1e-12<t<self.time+duration-1e-12]+[self.time+duration]
        self.checkpoint();start=time.perf_counter();cap=self.next_dt;ccd_retries=0;trials=[]
        try:
            for retry in range(self.max_contact_retries+1):
                self.c.status[None]=0;self.motion_ratio[None]=0;self.swept_hits[None]=0;self.swept_tests[None]=0;self.swept_unresolved[None]=0
                segments=[];t=self.time
                for end in stops:
                    n=max(1,math.ceil((end-t)/cap-1e-9));segments.append((n,(end-t)/n));t=end
                if sum(n for n,h in segments)>200000:raise ValueError('Too many four-method contact substeps')
                for n,h in segments:
                    for _ in range(n):self.substep(h)
                # Only the completed output interval reads status back. Failed
                # trials restore all four fields/heat ledgers before resampling.
                ti.sync();code=int(self.c.status[None]);ratio=float(self.motion_ratio[None]);swept=int(self.swept_hits[None])
                trials.append(dict(cap=cap,status=code,maxTravelRatio=ratio,sweptHits=swept,unresolvedSweeps=int(self.swept_unresolved[None])))
                if code not in (0,5,7):self.c.check_status()
                if code==0 and math.isfinite(ratio) and ratio<=1.001 and not swept:break
                if swept:ccd_retries+=1
                self.checkpoint(True)
                if retry==self.max_contact_retries or cap<=self.minimum_trial_dt*(1+1e-12):raise ValueError('接触保护达到最小步长，当前区间已回滚；请检查接触几何或减小输出区间。')
                cap=max(self.minimum_trial_dt,cap*.5)
        except Exception:
            self.checkpoint(True);self.c.status[None]=0;raise
        self.last_retries=retry;self.last_motion_ratio=ratio;self.last_ccd_retries=ccd_retries;self.last_swept_tests=int(self.swept_tests[None])
        self.last_step_trials=trials
        self.min_dt=min(h for n,h in segments);self.max_dt=max(h for n,h in segments)
        # Only successful intervals update the controller; failed transactions
        # preserve it. Do not rediscover the same small contact step every frame.
        self.stable_intervals=0 if retry else self.stable_intervals+1
        self.next_dt=cap
        if self.stable_intervals>=8:
            self.next_dt=min(self.dt,cap*1.25);self.stable_intervals=0
        self.last_ms=(time.perf_counter()-start)*1000;self.total_ms+=self.last_ms;self.time+=duration;self.steps+=sum(n for n,h in segments);self.requests+=1
        return self.snapshot(duration) if emit else None

    def thermal_energy(self):return self.c.thermal_energy()+self.rigid_capacity*float(self.rigid_temperature[0])

    def snapshot(self,duration=0):
        start=time.perf_counter();c=self.c;s=self.s;x=s.x.to_numpy().astype(float)*L;v=s.v.to_numpy().astype(float)*L;m=s.mass.to_numpy().astype(float);H=s.enthalpy.to_numpy();cp=self.particle_cps.to_numpy();T=H/cp
        u=c.u.to_numpy();fv=c.v.to_numpy();ft=c.temperature.to_numpy();rx=self.rx.to_numpy()[0];rv=self.rv.to_numpy()[0];rw=self.rw.to_numpy()[0];rq=self.rq.to_numpy()[0];rT=float(self.rigid_temperature[0])
        particles=np.zeros((self.n,8),np.float32);particles[:,:3]=x;particles[:,3]=np.where(np.arange(self.n)<self.nm,11+s.model.to_numpy(),2);particles[:,4]=T;particles[:,5]=s.pinned.to_numpy();particles[:,6]=s.stress.to_numpy();particles[:,7]=s.plastic.to_numpy()
        parts=[]
        for b,sl in [(self.project['parts'][1],slice(0,self.nm)),(self.project['parts'][2],slice(self.nm,self.n))]:
            mass=m[sl].sum();parts.append(dict(id=b['id'],method=b['method'],values=dict(count=len(m[sl]),mass=float(mass),temperature=float(np.dot(m[sl],T[sl])/mass),minTemperature=float(T[sl].min()),maxTemperature=float(T[sl].max()),position=(np.sum(x[sl]*m[sl,None],axis=0)/mass).tolist(),velocity=(np.sum(v[sl]*m[sl,None],axis=0)/mass).tolist())))
        totals=self.totals.to_numpy();delta=totals-self.previous;self.previous=totals.copy();pairs=[]
        for i,d in enumerate(self.pairs):
            force=delta[i,:3]/duration if duration else np.zeros(3)
            pairs.append(dict(**d,force=force.tolist(),oppositeForce=(-force).tolist(),totalImpulse=totals[i,:3].tolist(),heat=float(delta[i,3]),heatRate=float(delta[i,3]/duration) if duration else 0.,accumulatedHeat=float(totals[i,3]),samples=int(delta[i,4]),maxPenetration=float(totals[i,5]),thermalSamples=int(delta[i,6]),normalForce=float(delta[i,7]/duration) if duration else 0.,tangentialForce=(delta[i,8:11]/duration if duration else np.zeros(3)).tolist(),slipSpeed=float(delta[i,11]/delta[i,4]) if delta[i,4] else 0.,torque=(delta[i,12:15]/duration if duration else np.zeros(3)).tolist(),frictionLoss=None,frictionHeat=None,normalLoss=None,correctionWork=None,contactEnergy=None))
            if self.framework.pbd:pairs[-1]['scheme']='unified-pbd-hybrid/1'
            if i==self.fluid_pair:pairs[-1].update(scheme='unified-pbd-particle/1' if self.framework.pbd else 'mpm-pbf-contact/2',slipSpeed=None)
        loads=self.thermal_loads.results(duration);external=sum(l['heat'] for l in loads);plastic=float(s.plastic_heat[None]);energy=float(np.dot(m,H)+np.dot(c.capacity.to_numpy(),ft)+self.rigid_capacity*rT)
        mpm_external=sum(l['heat'] for l in loads if l['target']==self.project['parts'][1]['id'])
        thermal=dict(enabled=self.project['solver']['thermal'],energy=energy,initialEnergy=self.initial_thermal,externalHeat=external,generatedHeat=plastic,generated=dict(plastic=plastic,friction=0,mpm=plastic,fem=0,pbf=0,rigid=0),plasticWork=float(s.plastic_work[None]),frictionLoss=None,residual=energy-self.initial_thermal-external-plastic,interfaceHeatIntoMPM=float(np.dot(m[:self.nm],H[:self.nm])-self.initial_mpm_energy-mpm_external-plastic),loads=loads)
        body=dict(id=self.rigid['id'],name=self.rigid['name'],shape='sphere',size=self.rigid['geometry']['size'],position=rx.tolist(),rotation=rq.tolist(),velocity=rv.tolist(),angularVelocity=rw.tolist(),temperature=rT,mass=self.rmass,type=self.rigid['boundary']['motion'],displacement=(rx-np.asarray(self.rigid['geometry']['center'])).tolist(),acceleration=None,kinetic=float(.5*self.rmass*np.dot(rv,rv)+.2*self.rmass*self.rr**2*np.dot(rw,rw)),potential=float(-self.rmass*np.dot(self.c.gravity,rx)))
        state=dict(u=u.ravel().tolist(),v=fv.ravel().tolist(),temperature=ft.tolist())
        clock=dict(schema='coupling-clock/1',scheme='resident-four-bounded-clock/1',requestedDt=self.project['solver']['dt'],stepLimits=self.step_limits,baseDt=self.dt,maxDt=self.max_dt,minDt=self.min_dt,nextDt=self.next_dt,steps=self.steps,maxDrift=0,domains=[dict(id=k,time=self.time,steps=self.steps) for k in ['mpm','fem','rigid','pbf']])
        frame_bytes=particles.nbytes+u.nbytes+fv.nbytes+ft.nbytes+rx.nbytes*3+rq.nbytes;self.frame_bytes+=frame_bytes
        aggregate=dict(count=self.n,mass=float(m.sum()),temperature=float(np.dot(m,T)/m.sum()),minTemperature=float(T.min()),maxTemperature=float(T.max()),solids=self.nm,liquids=self.n-self.nm,position=(np.sum(x*m[:,None],axis=0)/m.sum()).tolist(),velocity=(np.sum(v*m[:,None],axis=0)/m.sum()).tolist())
        return dict(four=True,framework=self.framework.describe(),time=self.time,state=state,part=aggregate,particleParts=parts,bodies=[body],contactPairs=pairs,thermalLoads=loads,thermal=thermal,energy=disabled_energy(thermal),clock=clock,contactSafety=dict(scheme='swept-sphere-fem/1',algorithm='interval-separation-v2',retries=self.last_retries,maxTravelRatio=self.last_motion_ratio,ccdRetries=self.last_ccd_retries,sweptTests=self.last_swept_tests,stepTrials=self.last_step_trials),
            performance=dict(solverMs=self.last_ms,totalSolverMs=self.total_ms,snapshotMs=(time.perf_counter()-start)*1000,frameBytes=frame_bytes,transferredBytes=self.frame_bytes,requests=self.requests,substepHostTransfers=0,neighborGrid=dict(shape=s.neighbor_shape,cells=s.neighbor_cells,referenceCells=67**3,compact=self.optimized),contactUpdates='fused-independent-domains' if self.optimized else 'separate-domains',contactAlgorithm='GPU bounded Jacobi / wrench-preserving FEM transfer',bulkHeat='reference solid edges + spatial fluid neighbors; row-sum heat limit')) ,particles
