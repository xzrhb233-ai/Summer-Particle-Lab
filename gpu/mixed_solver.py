"""Resident thermoplastic MPM, thermoelastic FEM, conduction and dissipative heat.

Geometry/CSR assembly is a one-time import. No .to_numpy(), scalar field read,
IPC, or device sync is allowed inside substep(). Frames are the transfer unit.
Contact uses parallel Jacobi with a conservative shared-node row-sum bound.
"""
import copy
import math
import time
import numpy as np
import taichi as ti
from mixed_thermal import MixedThermalLoads
from mixed_material import MixedMPM
from mixed_program import DeviceCurve
from mixed_energy import MixedEnergy,disabled_energy

L=.025

def field(data,dtype=ti.f64,vector=0):
    a=np.asarray(data,dtype=np.int32 if dtype==ti.i32 else np.float32 if dtype==ti.f32 else np.float64)
    if not a.size:a=np.zeros((1,vector) if vector else (1,),dtype=a.dtype)
    out=ti.Vector.field(vector,dtype,shape=len(a)) if vector else ti.field(dtype,shape=a.shape)
    out.from_numpy(a);return out

@ti.data_oriented
class MixedSolver:
    def __init__(self,compiled):
        self.c=compiled;self.project=compiled['project'];p=self.project;seed=compiled['seed'];f=compiled['fem']
        self.particle_cp=seed.get('cp',1800.);self.particle_k=seed.get('conductivity',.13)
        self.n=len(seed['points']);self.nn=len(f['nodes']);self.nt=len(f['surface']);self.time=0.;self.steps=0;self.requests=0
        self.device_time=ti.field(ti.f64,shape=());self.back_time=ti.field(ti.f64,shape=())
        self.s=MixedMPM(self.n,p['parts'][1]['material'],neighbor_domain=seed['domain'] if compiled.get('compactNeighbors',False) else None);s=self.s;s.configure_domain(seed['domain']);s.count=self.n
        s.energy_enabled=bool(p['solver'].get('diagnostics',False))
        rows=np.zeros((self.n,9),np.float32);rows[:,:3]=seed['points'];rows[:,3]=11;rows[:,4]=seed['model'];rows[:,5]=seed['temperature']*self.particle_cp;rows[:,7]=.025;rows[:,8]=35;s.insert(0,rows)
        s.pinned.from_numpy(np.asarray(seed.get('pinned',[0]*self.n),np.int32))
        self.seed_values(seed['mass'],seed['volume'],seed['velocity'],seed['temperature'])
        self.reference_positions=field(np.asarray(seed['points'])*L,vector=3)
        self.nodes=field(f['nodes'],vector=3);self.mass=field(np.array(f['m']).reshape(-1,3)[:,0]);self.fixed=field(np.array(f['fixed']).reshape(-1,3),ti.i32)
        self.force=field(np.array(f['force']).reshape(-1,3),vector=3);self.u=ti.Vector.field(3,ti.f64,shape=self.nn);self.v=ti.Vector.field(3,ti.f64,shape=self.nn)
        self.base_force=field(np.array(f['force']).reshape(-1,3),vector=3);self.fthermal=ti.Vector.field(3,ti.f64,shape=self.nn)
        self.bindings=[(b,DeviceCurve(b['curveDefinition']),field(np.asarray(b['weights']).reshape(-1,3),vector=3)) for b in f.get('bindings',[])]
        self.events=sorted(set(t for c in [b['curveDefinition'] for b in f.get('bindings',[])]+[d['definition']['program'] for d in compiled.get('thermalLoads',[]) if d['definition'].get('program')] for t in ([x[0] for x in c['points']] if 'points' in c else [c['start'],c['end']])))
        self.cells=field([c['ids'] for c in f['cells']],ti.i32,4);self.cell_volume=field([c['volume'] for c in f['cells']]);self.grads=field([g for c in f['cells'] for g in c['grads']],vector=3);self.nc=len(f['cells'])
        self.expansion=p['parts'][0]['material']['expansion'] if p['solver']['thermal'] else 0.;self.tref=p['parts'][0]['material']['referenceTemperature'];self.bulk3=3*f['A']['lambda']+2*f['A']['mu']
        self.v.from_numpy(np.array(f['velocity'],np.float64).reshape(-1,3))
        self.internal=ti.Vector.field(3,ti.f64,shape=self.nn);self.dv=ti.Vector.field(3,ti.f64,shape=self.nn);self.du=ti.Vector.field(3,ti.f64,shape=self.nn)
        self.offsets=field(f['A']['offsets'],ti.i32);self.indices=field(f['A']['indices'],ti.i32);self.values=field(f['A']['values'])
        self.tris=field([t['nodes'] for t in f['surface']],ti.i32,3);self.normals=field([t['normal'] for t in f['surface']],vector=3)
        self.temperature=ti.field(ti.f64,shape=self.nn);self.capacity=field(f['capacity']);self.temperature.fill(p['parts'][0]['initial']['temperature'])
        self.qf=ti.field(ti.f64,shape=self.nn);self.qp=ti.field(ti.f64,shape=self.n);self.bf=ti.field(ti.f64,shape=self.nn);self.bp=ti.field(ti.f64,shape=self.n)
        self.ef=field([[e['i'],e['j']] for e in f['thermalEdges']],ti.i32,2);self.gf=field([e['g'] for e in f['thermalEdges']]);self.nf=len(f['thermalEdges'])
        self.ep=field([e[:2] for e in seed['edges']],ti.i32,2);self.gp=field([e[2] for e in seed['edges']]);self.np=len(seed['edges'])
        self.hit=ti.field(ti.i32,shape=self.n);self.weights=ti.Vector.field(3,ti.f64,shape=self.n);self.normal=ti.Vector.field(3,ti.f64,shape=self.n);self.arm=ti.Vector.field(3,ti.f64,shape=self.n);self.depth=ti.field(ti.f64,shape=self.n)
        self.weight_sum=ti.field(ti.f64,shape=self.nn)
        domain=p['discretization']['mpm'];self.bin_h=max(domain['cellSize'],.1);self.bin_lo=np.array(domain['lower'])-.3;self.bin_shape=tuple(np.ceil((np.array(domain['upper'])+.3-self.bin_lo)/self.bin_h).astype(int));self.bin_total=math.prod(self.bin_shape)
        self.bin_count=ti.field(ti.i32,shape=self.bin_total);self.bin_tris=ti.field(ti.i32,shape=(self.bin_total,128))
        self.radius=seed['spacing']/2;self.contact=p['contactPairs'][0];self.skin=self.radius*self.contact['thermalToleranceRatio'];self.reach=self.radius+self.skin
        self.kf=p['parts'][0]['material']['conductivity'];cell=min(x/n for x,n in zip(p['parts'][0]['geometry']['size'],p['parts'][0]['discretization']['divisions']))
        hc=self.contact['contactConductance'];self.conductance=seed['spacing']**2/(1/hc+self.radius/self.particle_k+.5*cell/self.kf) if hc and self.kf and self.particle_k and self.contact['thermal'] else 0.
        self.stats=ti.field(ti.f64,shape=18);self.status=ti.field(ti.i32,shape=());self.thermal_ratio=ti.field(ti.f64,shape=())
        # Cumulative SI joules: friction loss, generated heat, MPM share, FEM share.
        # These remain separate from stats[4], the signed conductive interface heat.
        self.friction_totals=ti.field(ti.f64,shape=4);self.back_friction=ti.field(ti.f64,shape=4)
        self.friction_stage=ti.field(ti.f64,shape=4);self.friction_weights=ti.field(ti.f64,shape=self.n)
        self.normal_impulses=ti.field(ti.f64,shape=self.n)
        self.friction_fraction=self.contact.get('frictionHeatFraction',0.)
        self.friction_to_a=self.contact.get('frictionHeatToA',.5)
        if any(not math.isfinite(x) or not 0<=x<=1 for x in [self.friction_fraction,self.friction_to_a]):raise ValueError('Friction heat fractions must lie in [0, 1]')
        # Python floating constants otherwise enter default-f32 expressions.
        # Keep the authored conversion/partition exact to f64 in the heat book.
        self.friction_parameters=field([self.friction_fraction,self.friction_to_a])
        self.back_plastic_work=ti.field(ti.f64,shape=());self.back_plastic_heat=ti.field(ti.f64,shape=())
        self.frame_totals=ti.field(ti.f64,shape=20)
        self.stiffness=p['solver']['stiffness'];self.gravity=p['environment']['gravity'];self.damping=p['solver']['damping']
        self.s.dissipation_stiffness=self.stiffness;self.s.dissipation_thermal_enabled=bool(p['solver']['thermal'])
        # JSON encodes the infinite diffusion limit of an insulating part as null.
        thermal_dt=f['thermalDt'] if f['thermalDt'] is not None else math.inf
        self.step_limits=dict(requested=p['solver']['dt'],fem=f['dt'],thermal=thermal_dt if math.isfinite(thermal_dt) else None,mpm=domain['cellSize']/L/8/240)
        self.dt=min(v for v in self.step_limits.values() if v is not None)
        self.snapshot_bytes=0;self.output_ms=0;self.last_ms=0;self.total_ms=0;self.min_dt=self.dt;self.max_dt=0
        self.backups={}
        for name in ['x','v','F','C','enthalpy','temp','stress','plastic']:
            a=getattr(s,name);shape=a.shape
            if name in ['F','C']:b=ti.Matrix.field(3,3,ti.f32,shape=shape)
            elif name in ['x','v']:b=ti.Vector.field(3,ti.f32,shape=shape)
            else:b=ti.field(ti.f64 if name=='enthalpy' else ti.f32,shape=shape)
            self.backups[name]=b
        self.bu=ti.Vector.field(3,ti.f64,shape=self.nn);self.bv=ti.Vector.field(3,ti.f64,shape=self.nn);self.bt=ti.field(ti.f64,shape=self.nn);self.bs=ti.field(ti.f64,shape=18)
        self.prepare_surface();self.find_contacts();self.check_initial();self.check_status()
        self.initial_thermal=self.thermal_energy();self.initial_frame=copy.deepcopy(compiled['frame'])
        self.thermal_loads=MixedThermalLoads(self,compiled.get('thermalLoads',[]))
        self.energy=MixedEnergy(self) if s.energy_enabled else None
        self.energy_backups={}
        if self.energy:
            for name in ['plastic_return_work','plastic_thermal_work','plastic_trial_work']:
                self.energy_backups[name]=ti.field(ti.f64,shape=())
            self.energy_backups['energy_clamped']=ti.field(ti.i32,shape=())
            self.energy.before_heat()
        self.thermal_loads.step(0) # Account for initial thermostat energy, too.
        if self.energy:self.energy.after_heat()

    @ti.kernel
    def seed_values(self,m:ti.f32,vol:ti.f32,velocity:ti.types.vector(3,ti.f32),T:ti.f64):
        for i in range(self.n):
            self.s.mass[i]=m;self.s.volume[i]=vol;self.s.inv_mass[i]=1/m;self.s.v[i]=velocity;self.s.lab.part[i]=1
            if self.s.pinned[i]:self.s.inv_mass[i]=0.;self.s.v[i]=ti.Vector.zero(ti.f32,3)
            self.s.enthalpy[i]=T*self.particle_cp;self.s.temp[i]=ti.cast(T,ti.f32)

    @ti.func
    def bin_coord(self,x):
        return ti.cast(ti.floor((x-ti.Vector(self.bin_lo))/self.bin_h),ti.i32)

    @ti.func
    def bin_id(self,c):
        return c[0]+self.bin_shape[0]*(c[1]+self.bin_shape[1]*c[2])

    @ti.kernel
    def prepare_surface(self):
        for i in range(self.bin_total):self.bin_count[i]=0
        for t in range(self.nt):
            ids=self.tris[t];a=self.nodes[ids[0]]+self.u[ids[0]];b=self.nodes[ids[1]]+self.u[ids[1]];c=self.nodes[ids[2]]+self.u[ids[2]]
            lo=self.bin_coord(ti.min(a,ti.min(b,c))-self.reach-1e-8);hi=self.bin_coord(ti.max(a,ti.max(b,c))+self.reach+1e-8)
            for k in ti.static(range(3)):
                if lo[k]<0 or hi[k]>=self.bin_shape[k]:self.status[None]=1
                lo[k]=ti.max(0,lo[k]);hi[k]=ti.min(self.bin_shape[k]-1,hi[k])
            for x,y,z in ti.ndrange((lo[0],hi[0]+1),(lo[1],hi[1]+1),(lo[2],hi[2]+1)):
                cell=self.bin_id(ti.Vector([x,y,z]));slot=ti.atomic_add(self.bin_count[cell],1)
                if slot<128:self.bin_tris[cell,slot]=t
                else:self.status[None]=2

    @ti.func
    def closest(self,p,a,b,c):
        ab=b-a;ac=c-a;ap=p-a;d1=ab.dot(ap);d2=ac.dot(ap);bp=p-b;d3=ab.dot(bp);d4=ac.dot(bp);cp=p-c;d5=ab.dot(cp);d6=ac.dot(cp)
        vc=d1*d4-d3*d2;vb=d5*d2-d1*d6;va=d3*d6-d5*d4;w=ti.Vector([0.,0.,0.],dt=ti.f64)
        if d1<=0 and d2<=0:w=ti.Vector([1.,0.,0.])
        elif d3>=0 and d4<=d3:w=ti.Vector([0.,1.,0.])
        elif vc<=0 and d1>=0 and d3<=0:
            v=d1/(d1-d3);w=ti.Vector([1-v,v,0.])
        elif d6>=0 and d5<=d6:w=ti.Vector([0.,0.,1.])
        elif vb<=0 and d2>=0 and d6<=0:
            v=d2/(d2-d6);w=ti.Vector([1-v,0.,v])
        elif va<=0 and d4-d3>=0 and d5-d6>=0:
            v=(d4-d3)/(d4-d3+d5-d6);w=ti.Vector([0.,1-v,v])
        else:
            denom=va+vb+vc
            if denom<=1e-30:self.status[None]=3
            else:w=ti.Vector([va,vb,vc])/denom
        return w

    @ti.kernel
    def find_contacts(self):
        for n in range(self.nn):self.weight_sum[n]=0
        for i in range(self.n):
            p=ti.cast(self.s.x[i],ti.f64)*L;c=self.bin_coord(p);best=ti.cast(1e30,ti.f64);self.hit[i]=-1
            valid=1
            for k in ti.static(range(3)):
                if c[k]<0 or c[k]>=self.bin_shape[k]:valid=0
            if valid:
                cell=self.bin_id(c)
                for slot in range(ti.min(128,self.bin_count[cell])):
                    t=self.bin_tris[cell,slot];ids=self.tris[t];a=self.nodes[ids[0]]+self.u[ids[0]];b=self.nodes[ids[1]]+self.u[ids[1]];v=self.nodes[ids[2]]+self.u[ids[2]]
                    w=self.closest(p,a,b,v);q=w[0]*a+w[1]*b+w[2]*v;d=p-q;length=d.norm();normal=(b-a).cross(v-a).normalized(1e-30)
                    if normal.dot(self.normals[t])<0:normal=-normal
                    sign=1.
                    if d.dot(normal)<-1e-10:sign=-1.
                    if length<=self.reach+1e-9 and (length<best-1e-12 or ti.abs(length-best)<1e-12 and t<self.hit[i]):
                        best=length;self.hit[i]=t;self.weights[i]=w;self.arm[i]=q-p;self.depth[i]=self.radius-sign*length
                        self.normal[i]=normal
                        if length>1e-12:self.normal[i]=d*(sign/length)
            if self.hit[i]>=0 and self.depth[i]>=-1e-9:
                for a in ti.static(range(3)):self.weight_sum[self.tris[self.hit[i]][a]]+=self.weights[i][a]

    @ti.kernel
    def check_initial(self):
        for i in range(self.n):
            if self.hit[i]>=0 and self.depth[i]>1e-7:self.status[None]=4

    @ti.kernel
    def fem_force(self):
        for row in range(self.nn*3):
            total=ti.cast(0.,ti.f64)
            for j in range(self.offsets[row],self.offsets[row+1]):
                c=self.indices[j];total+=self.values[j]*self.u[c//3][c%3]
            self.internal[row//3][row%3]=total

    @ti.kernel
    def fem_thermal_force(self):
        for n in range(self.nn):self.fthermal[n]=ti.Vector.zero(ti.f64,3)
        for c in range(self.nc):
            temperature=ti.cast(0.,ti.f64)
            for a in ti.static(range(4)):temperature+=self.temperature[self.cells[c][a]]/4
            stress=self.bulk3*self.expansion*(temperature-self.tref)
            for a in ti.static(range(4)):self.fthermal[self.cells[c][a]]+=self.cell_volume[c]*stress*self.grads[4*c+a]

    @ti.kernel
    def apply_binding(self,curve:ti.template(),weights:ti.template(),scale:ti.f64,offset:ti.f64,base:ti.f64,dt:ti.f64,end:ti.i32):
        t=self.device_time[None]
        if end:t+=dt-ti.min(dt*1e-7,1e-12*ti.max(1.,t+dt))
        delta=offset+scale*curve.value(t)-base
        for n in range(self.nn):self.force[n]+=delta*weights[n]

    def fem_loading(self,dt,end):
        self.force.copy_from(self.base_force)
        for b,curve,weights in self.bindings:self.apply_binding(curve,weights,b['scale'],b['offset'],b['base'],dt,end)

    @ti.kernel
    def fem_drift(self,dt:ti.f64):
        decay=ti.exp(-self.damping*dt/2)
        for n in range(self.nn):
            for k in ti.static(range(3)):
                if not self.fixed[n,k]:
                    self.v[n][k]=self.v[n][k]*decay+.5*dt*(self.force[n][k]+self.fthermal[n][k]-self.internal[n][k])/self.mass[n]
                    self.u[n][k]+=dt*self.v[n][k]

    @ti.kernel
    def fem_kick(self,dt:ti.f64):
        decay=ti.exp(-self.damping*dt/2)
        for n in range(self.nn):
            for k in ti.static(range(3)):
                if not self.fixed[n,k]:self.v[n][k]=(self.v[n][k]+.5*dt*(self.force[n][k]+self.fthermal[n][k]-self.internal[n][k])/self.mass[n])*decay

    @ti.kernel
    def particle_gravity(self,dt:ti.f32):
        for i in range(self.n):
            if not self.s.pinned[i]:self.s.v[i]+=ti.Vector(self.gravity)*dt/L

    @ti.func
    def spin(self,i):
        C=self.s.C[i];return ti.Vector([C[2,1]-C[1,2],C[0,2]-C[2,0],C[1,0]-C[0,1]],dt=ti.f64)*.5

    @ti.func
    def relative(self,i):
        v=ti.Vector.zero(ti.f64,3);ids=self.tris[self.hit[i]]
        if not self.s.pinned[i]:v=ti.cast(self.s.v[i],ti.f64)*L+self.spin(i).cross(self.arm[i])
        for a in ti.static(range(3)):v-=self.weights[i][a]*self.v[ids[a]]
        return v

    @ti.func
    def contact_bound(self,i,direction,rotation):
        m=ti.cast(self.s.mass[i],ti.f64);bound=ti.cast(0.,ti.f64)
        if not self.s.pinned[i]:
            bound=1/m
            if rotation:bound+=self.arm[i].cross(direction).norm_sqr()/(2*m*(self.s.mpm_h[None]*L)**2/4)
        ids=self.tris[self.hit[i]];w=self.weights[i]
        for a in ti.static(range(3)):
            for k in ti.static(range(3)):
                if not self.fixed[ids[a],k]:bound+=w[a]*self.weight_sum[ids[a]]*direction[k]**2/self.mass[ids[a]]
        return ti.max(1e-20,bound)

    @ti.func
    def particle_impulse(self,i,J):
        if not self.s.pinned[i]:
            m=ti.cast(self.s.mass[i],ti.f64);inertia=2*m*(self.s.mpm_h[None]*L)**2/4
            self.s.v[i]+=ti.cast(J/m/L,ti.f32);omega=self.arm[i].cross(J)/inertia
            self.s.C[i]+=ti.cast(ti.Matrix([[0.,-omega[2],omega[1]],[omega[2],0.,-omega[0]],[-omega[1],omega[0],0.]]),ti.f32)

    @ti.func
    def scatter_impulse(self,i,J):
        ids=self.tris[self.hit[i]];w=self.weights[i]
        if self.s.pinned[i]:
            for k in ti.static(range(3)):self.stats[6+k]+=J[k]
        for a in ti.static(range(3)):
            for k in ti.static(range(3)):
                if not self.fixed[ids[a],k]:self.dv[ids[a]][k]-=w[a]*J[k]/self.mass[ids[a]]
                else:self.stats[6+k]-=w[a]*J[k]
        torque=(ti.cast(self.s.x[i],ti.f64)*L+self.arm[i]-ti.Vector(self.project['parts'][0]['geometry']['center'])).cross(J)
        for k in ti.static(range(3)):self.stats[k]+=J[k];self.stats[12+k]+=torque[k]

    @ti.kernel
    def contact_iteration(self):
        for n in range(self.nn):self.dv[n]=ti.Vector.zero(ti.f64,3);self.du[n]=ti.Vector.zero(ti.f64,3);self.qf[n]=0.
        for k in range(4):self.friction_stage[k]=0.
        # Normal projection is a separate operator. Friction sees post-normal
        # velocities, so its heat excludes normal impact and position cleanup.
        for i in range(self.n):
            self.normal_impulses[i]=0.;self.friction_weights[i]=0.
            if self.hit[i]>=0 and self.depth[i]>=-1e-9:
                normal=self.normal[i];vn=self.relative(i).dot(normal)
                jn=ti.max(0.,-vn/self.contact_bound(i,normal,1));J=jn*normal;self.normal_impulses[i]=jn
                self.particle_impulse(i,J);self.scatter_impulse(i,J)
                self.stats[3]+=jn;ti.atomic_max(self.stats[5],self.depth[i])
                if self.depth[i]>.8*self.radius:self.status[None]=5
        for n in range(self.nn):self.v[n]+=self.dv[n];self.dv[n]=ti.Vector.zero(ti.f64,3)
        # Each particle has its own affine spin. Shared FEM node response is
        # assembled first, then measured once; per-contact quadratic work would
        # omit cross terms and invent heat when several particles share a node.
        for i in range(self.n):
            if self.normal_impulses[i]>0:
                normal=self.normal[i];rel=self.relative(i);vt=rel-rel.dot(normal)*normal;speed=vt.norm()
                self.stats[15]+=speed;self.stats[16]+=1
                if speed>1e-12 and self.contact['friction']>0:
                    tangent=vt/speed;bound=self.contact_bound(i,tangent,1)
                    jt=ti.min(self.contact['friction']*self.normal_impulses[i],speed/bound);J=-jt*tangent
                    # Only skew(C) changes. Symmetric affine energy is retained.
                    m=ti.cast(self.s.mass[i],ti.f64);inertia=2*m*(self.s.mpm_h[None]*L)**2/4
                    before=ti.cast(0.,ti.f64)
                    if not self.s.pinned[i]:before=.5*m*(ti.cast(self.s.v[i],ti.f64)*L).norm_sqr()+.5*inertia*self.spin(i).norm_sqr()
                    self.particle_impulse(i,J);self.scatter_impulse(i,J)
                    after=ti.cast(0.,ti.f64)
                    if not self.s.pinned[i]:after=.5*m*(ti.cast(self.s.v[i],ti.f64)*L).norm_sqr()+.5*inertia*self.spin(i).norm_sqr()
                    self.friction_stage[0]+=after-before;self.friction_stage[2]+=before
                    # This nonnegative row-sum bound supplies only the spatial
                    # distribution. The generated energy is the measured loss.
                    weight=ti.max(0.,jt*speed-.5*jt*jt*bound)
                    self.friction_weights[i]=weight;self.friction_stage[1]+=weight
                    for k in ti.static(range(3)):self.stats[9+k]+=J[k]
        for n in range(self.nn):
            dv=self.dv[n]
            if dv.norm_sqr()>0:
                self.friction_stage[0]+=self.mass[n]*dv.dot(self.v[n]+.5*dv)
                self.friction_stage[2]+=.5*self.mass[n]*self.v[n].norm_sqr()
            self.v[n]+=dv
        loss=-self.friction_stage[0]
        # Particle velocities/affine matrices are f32. Reject actual injection,
        # allowing only cancellation at their representable energy resolution.
        tolerance=2e-6*ti.max(1e-12,self.friction_stage[2])+1e-12
        if loss < -tolerance:self.status[None]=9
        loss=ti.max(0.,loss);self.friction_totals[0]+=loss
        generated=ti.cast(0.,ti.f64)
        if ti.static(self.project['solver']['thermal']):generated=loss*self.friction_parameters[0]
        if self.friction_stage[1]>0:self.friction_stage[3]=generated/self.friction_stage[1]
        partition=self.friction_parameters[1]
        self.friction_totals[1]+=generated;self.friction_totals[2]+=generated*partition;self.friction_totals[3]+=generated*(1-partition)
        for i in range(self.n):
            if self.friction_weights[i]>0:
                heat=self.friction_weights[i]*self.friction_stage[3]
                self.s.enthalpy[i]+=heat*partition/self.s.mass[i]
                self.s.temp[i]=ti.cast(self.s.enthalpy[i]/self.particle_cp,ti.f32)
                for a in ti.static(range(3)):self.qf[self.tris[self.hit[i]][a]]+=heat*(1-partition)*self.weights[i][a]
        for n in range(self.nn):self.temperature[n]+=self.qf[n]/self.capacity[n]
        # Geometric cleanup is a numerical operator, never a heat source.
        for i in range(self.n):
            if self.hit[i]>=0 and self.depth[i]>0:
                normal=self.normal[i];ids=self.tris[self.hit[i]];w=self.weights[i]
                correction=self.depth[i]/self.contact_bound(i,normal,0)
                if not self.s.pinned[i]:self.s.x[i]+=ti.cast(correction*normal/self.s.mass[i]/L,ti.f32)
                for a in ti.static(range(3)):
                    for k in ti.static(range(3)):
                        if not self.fixed[ids[a],k]:self.du[ids[a]][k]-=w[a]*correction*normal[k]/self.mass[ids[a]]
        for n in range(self.nn):self.u[n]+=self.du[n]

    @ti.func
    def interface_g(self,i):
        coverage=ti.cast(self.depth[i]>=0,ti.f64)
        if self.skin>0:coverage=ti.min(1.,ti.max(0.,(self.depth[i]+self.skin)/self.skin))
        return self.conductance*coverage

    @ti.kernel
    def heat_budget(self,dt:ti.f64):
        for i in range(self.n):self.bp[i]=0;self.qp[i]=0
        for n in range(self.nn):self.bf[n]=0;self.qf[n]=0
        for e in range(self.np):
            i,j=self.ep[e][0],self.ep[e][1];g=self.gp[e];self.bp[i]+=g;self.bp[j]+=g
        for e in range(self.nf):
            i,j=self.ef[e][0],self.ef[e][1];g=self.gf[e];self.bf[i]+=g;self.bf[j]+=g
        for i in range(self.n):
            if self.hit[i]>=0:
                g=self.interface_g(i);self.bp[i]+=g
                for a in ti.static(range(3)):self.bf[self.tris[self.hit[i]][a]]+=g*self.weights[i][a]
        self.thermal_ratio[None]=1.
        for i in range(self.n):ti.atomic_min(self.thermal_ratio[None],.45*self.s.mass[i]*self.particle_cp/ti.max(1e-30,self.bp[i]*dt))
        for n in range(self.nn):ti.atomic_min(self.thermal_ratio[None],.45*self.capacity[n]/ti.max(1e-30,self.bf[n]*dt))
        if self.thermal_ratio[None]<.999999:self.status[None]=6

    @ti.kernel
    def heat_exchange(self,dt:ti.f64):
        for e in range(self.np):
            i,j=self.ep[e][0],self.ep[e][1];q=(self.s.enthalpy[j]-self.s.enthalpy[i])/self.particle_cp*self.gp[e]*dt;self.qp[i]+=q;self.qp[j]-=q
        for e in range(self.nf):
            i,j=self.ef[e][0],self.ef[e][1];q=(self.temperature[j]-self.temperature[i])*self.gf[e]*dt;self.qf[i]+=q;self.qf[j]-=q
        for i in range(self.n):
            if self.hit[i]>=0:
                g=self.interface_g(i)
                for a in ti.static(range(3)):
                    n=self.tris[self.hit[i]][a];q=(self.temperature[n]-self.s.enthalpy[i]/self.particle_cp)*g*self.weights[i][a]*dt
                    self.qp[i]+=q;self.qf[n]-=q;self.stats[4]+=q
                    if g*self.weights[i][a]>0:self.stats[17]+=1
        for i in range(self.n):self.s.enthalpy[i]+=self.qp[i]/self.s.mass[i];self.s.temp[i]=ti.cast(self.s.enthalpy[i]/self.particle_cp,ti.f32)
        for n in range(self.nn):self.temperature[n]+=self.qf[n]/self.capacity[n]

    @ti.kernel
    def check_state(self,dt:ti.f32):
        if self.s.limits[0]<dt*.99999:self.status[None]=7
        for i in range(self.n):
            J=self.s.F[i].determinant()
            if ti.math.isnan(J) or J<1e-6 or J>1e6 or ti.math.isnan(self.s.plastic[i]):self.status[None]=8
            for k in ti.static(range(3)):
                if ti.math.isnan(self.s.x[i][k]) or ti.math.isnan(self.s.v[i][k]) or ti.math.isinf(self.s.v[i][k]) or ti.abs(self.s.v[i][k])>1e5:self.status[None]=8
                if self.s.x[i][k]<self.s.domain_lo[None][k] or self.s.x[i][k]>self.s.domain_hi[None][k]:self.status[None]=8
            if ti.math.isnan(self.s.enthalpy[i]) or self.s.enthalpy[i]/self.particle_cp < -273.150001 or self.s.enthalpy[i]/self.particle_cp > 1e6:self.status[None]=8
        for n in range(self.nn):
            if self.u[n].norm()>1 or ti.math.isnan(self.u[n].norm()) or ti.math.isnan(self.temperature[n]) or self.temperature[n]<-273.150001 or self.temperature[n]>1e6:self.status[None]=8

    def check_status(self):
        code=int(self.status[None])
        if code:raise ValueError({1:'FEM moved outside GPU contact grid',2:'GPU contact bin overflow',3:'Degenerate FEM triangle',4:'Initial MPM/FEM overlap',5:'Contact penetration exceeds 0.8 particle radius',6:'Thermal stability limit exceeded; reduce dt',7:'MPM CFL limit exceeded; reduce dt',8:'GPU state became invalid',9:'Friction stage increased kinetic energy beyond floating-point tolerance'}[code])

    @ti.kernel
    def advance_clock(self,h:ti.f64):
        self.device_time[None]+=h

    def substep(self,h):
        if self.energy:self.energy.begin_mpm()
        self.particle_gravity(h)
        if self.energy:self.energy.after_gravity()
        self.s.prepare(self.n,self.stiffness);self.s.clear_grid();self.s.p2g(self.n,h)
        if self.energy:self.energy.after_p2g()
        self.s.grid_step(0,0.,0.)
        if self.energy:self.energy.after_grid()
        self.s.g2p(self.n,h)
        if self.energy:self.energy.after_g2p()
        self.fem_thermal_force();self.fem_loading(h,0);self.fem_force()
        if self.energy:self.energy.before_fem_drift(h)
        self.fem_drift(h);self.fem_loading(h,1);self.fem_force()
        if self.energy:self.energy.before_fem_kick(h)
        self.fem_kick(h)
        if self.energy:self.energy.after_fem()
        if self.contact['mechanical']:
            for _ in range(4):
                self.prepare_surface();self.find_contacts()
                if self.energy:self.energy.before_contact()
                self.contact_iteration()
                if self.energy:self.energy.after_contact()
        if self.project['solver']['thermal']:
            if self.energy:self.energy.before_heat()
            self.prepare_surface();self.find_contacts();self.heat_budget(h);self.heat_exchange(h)
            self.thermal_loads.step(h)
            if self.energy:self.energy.after_heat()
        self.check_state(h)
        self.advance_clock(h)

    def thermal_energy(self):
        return float(np.dot(self.mass.to_numpy()*0+1,self.capacity.to_numpy()*self.temperature.to_numpy())+np.dot(self.s.mass.to_numpy().astype(float),self.s.enthalpy.to_numpy()))

    @ti.kernel
    def export_frame(self,out:ti.types.ndarray(dtype=ti.f32,ndim=2)):
        for k in range(20):self.frame_totals[k]=0
        self.frame_totals[3]=1e30;self.frame_totals[4]=-1e30
        for i in range(self.n):
            m=ti.cast(self.s.mass[i],ti.f64);T=self.s.enthalpy[i]/self.particle_cp
            self.frame_totals[0]+=m;self.frame_totals[1]+=m*T;self.frame_totals[2]+=m*self.s.enthalpy[i]
            ti.atomic_min(self.frame_totals[3],T);ti.atomic_max(self.frame_totals[4],T)
            for k in ti.static(range(3)):
                out[i,k]=self.s.x[i][k]*L;self.frame_totals[5+k]+=m*self.s.x[i][k]*L;self.frame_totals[8+k]+=m*self.s.v[i][k]*L
            out[i,3]=11+self.s.model[i];out[i,4]=ti.cast(T,ti.f32);out[i,5]=self.s.pinned[i];out[i,6]=self.s.stress[i];out[i,7]=self.s.plastic[i]
            self.frame_totals[12]+=m*self.s.plastic[i];ti.atomic_max(self.frame_totals[13],self.s.plastic[i])
            self.frame_totals[14]+=m*self.s.modulus_ratio(i)
            ti.atomic_max(self.frame_totals[15],(ti.cast(self.s.x[i],ti.f64)*L-self.reference_positions[i]).norm())
            ti.atomic_max(self.frame_totals[16],self.s.stress[i]*self.project['parts'][1]['material']['density']*10*self.stiffness)
            self.frame_totals[17]+=m*self.s.stretch(i)
        for n in range(self.nn):self.frame_totals[11]+=self.capacity[n]*self.temperature[n]

    def checkpoint(self,restore=False):
        for name,b in self.backups.items():
            a=getattr(self.s,name);a.copy_from(b) if restore else b.copy_from(a)
        for a,b in [(self.u,self.bu),(self.v,self.bv),(self.temperature,self.bt),(self.stats,self.bs)]:a.copy_from(b) if restore else b.copy_from(a)
        for a,b in [(self.friction_totals,self.back_friction),(self.s.plastic_work,self.back_plastic_work),(self.s.plastic_heat,self.back_plastic_heat)]:a.copy_from(b) if restore else b.copy_from(a)
        if self.energy:
            self.energy.checkpoint(restore)
            for name,b in self.energy_backups.items():
                a=getattr(self.s,name);a.copy_from(b) if restore else b.copy_from(a)
        self.thermal_loads.checkpoint(restore)
        self.device_time.copy_from(self.back_time) if restore else self.back_time.copy_from(self.device_time)

    def step(self,duration,emit=True):
        if not isinstance(duration,(int,float)) or not math.isfinite(duration) or not 0<duration<=1 or self.time+duration>60+1e-9:raise ValueError('Invalid mixed interval')
        stops=[t for t in self.events if self.time+1e-12<t<self.time+duration-1e-12]+[self.time+duration]
        segments=[];t=self.time
        for stop in stops:
            n=max(1,math.ceil((stop-t)/self.dt-1e-9));segments.append((n,(stop-t)/n));t=stop
        count=sum(n for n,h in segments)
        if count>200000:raise ValueError('Too many mixed substeps')
        self.checkpoint();self.status[None]=0;start=time.perf_counter()
        try:
            for n,h in segments:
                for _ in range(n):self.substep(h)
            ti.sync();self.check_status()
        except Exception:
            self.checkpoint(True);self.status[None]=0;raise
        self.last_ms=(time.perf_counter()-start)*1000;self.total_ms+=self.last_ms;self.steps+=count;self.time+=duration;self.requests+=1;self.min_dt=min(self.min_dt,*[h for n,h in segments]);self.max_dt=max(self.max_dt,*[h for n,h in segments])
        return self.snapshot(duration) if emit else None

    def snapshot(self,duration=0):
        start=time.perf_counter();u=self.u.to_numpy();v=self.v.to_numpy();T=self.temperature.to_numpy();stats=self.stats.to_numpy()
        self.s.prepare(self.n,self.stiffness);particles=np.empty((self.n,8),np.float32);self.export_frame(particles);totals=self.frame_totals.to_numpy()
        state=dict(u=u.ravel().tolist(),v=v.ravel().tolist(),temperature=T.tolist())
        loads=self.thermal_loads.results(duration);external=sum(l['heat'] for l in loads)
        thermal=float(totals[2]+totals[11]);delta=stats-getattr(self,'previous_stats',np.zeros(18));self.previous_stats=stats.copy()
        friction=self.friction_totals.to_numpy();friction_delta=friction-getattr(self,'previous_friction',np.zeros(4));self.previous_friction=friction.copy()
        plastic_work=float(self.s.plastic_work[None]);plastic_heat=float(self.s.plastic_heat[None]);generated=plastic_heat+float(friction[1])
        pair={**self.contact,'force':(delta[:3]/duration if duration else np.zeros(3)).tolist(),'oppositeForce':(-delta[:3]/duration if duration else np.zeros(3)).tolist(),'totalImpulse':stats[:3].tolist(),'supportImpulse':stats[6:9].tolist(),'normalForce':float(delta[3]/duration) if duration else 0.,'tangentialForce':[0,0,0],'torque':[0,0,0],'slipSpeed':0,'maxPenetration':float(stats[5]),'heat':float(delta[4]),'heatRate':float(delta[4]/duration) if duration else 0.,'accumulatedHeat':float(stats[4]),'normalLoss':None,'frictionLoss':float(friction[0]),'correctionWork':None,'particleCorrectionWork':None}
        pair.update(frictionLossScope='cumulative-from-start',frictionHeat=float(friction[1]),frictionHeatIntoA=float(friction[2]),frictionHeatIntoB=float(friction[3]),intervalFrictionHeat=float(friction_delta[1]),frictionHeatRate=float(friction_delta[1]/duration) if duration else 0.,accumulatedFrictionHeat=float(friction[1]),accumulatedFrictionHeatIntoA=float(friction[2]),accumulatedFrictionHeatIntoB=float(friction[3]))
        pair.update(tangentialForce=(delta[9:12]/duration if duration else np.zeros(3)).tolist(),torque=(delta[12:15]/duration if duration else np.zeros(3)).tolist(),slipSpeed=float(delta[15]/delta[16]) if delta[16] else 0.,samples=int(delta[16]),thermalSamples=int(delta[17]))
        part=dict(count=self.n,mass=float(totals[0]),temperature=float(totals[1]/totals[0]),minTemperature=float(totals[3]),maxTemperature=float(totals[4]),solids=self.n,liquids=0,position=(totals[5:8]/totals[0]).tolist(),velocity=(totals[8:11]/totals[0]).tolist())
        part.update(meanPlasticStrain=float(totals[12]/totals[0]),maxPlasticStrain=float(totals[13]),stiffnessRatio=float(totals[14]/totals[0]),maxDisplacement=float(totals[15]),maxStress=float(totals[16]),thermalStretch=float(totals[17]/totals[0]))
        clock=dict(schema='coupling-clock/1',scheme='fixed-stable-batch/1',requestedDt=self.project['solver']['dt'],stepLimits=self.step_limits,baseDt=self.dt,steps=self.steps,minDt=self.min_dt if self.steps else None,maxDt=self.max_dt if self.steps else None,eventCuts=0,requestCuts=0,maxDrift=0,domains=[dict(id=k,time=self.time,steps=self.steps) for k in ['mpm','fem']])
        self.snapshot_bytes+=particles.nbytes+u.nbytes+v.nbytes+T.nbytes;self.output_ms=(time.perf_counter()-start)*1000
        part['externalHeat']=sum(l['heat'] for l in loads if l['target']==self.project['parts'][1]['id'])
        thermal=dict(enabled=self.project['solver']['thermal'],energy=thermal,initialEnergy=self.initial_thermal,externalHeat=external,generatedHeat=generated,generated=dict(plastic=plastic_heat,friction=float(friction[1]),mpm=plastic_heat+float(friction[2]),fem=float(friction[3])),plasticWork=plastic_work,frictionLoss=float(friction[0]),residual=thermal-self.initial_thermal-external-generated,interfaceHeatIntoMPM=float(stats[4]),exchangedHeat=abs(float(stats[4])),loads=loads)
        energy=self.energy.snapshot(thermal,friction) if self.energy else disabled_energy(thermal)
        self.output_ms=(time.perf_counter()-start)*1000
        return dict(time=self.time,state=state,part=part,contactPairs=[pair],thermalLoads=loads,thermal=thermal,energy=energy,clock=clock,
            performance=dict(solverMs=self.last_ms,totalSolverMs=self.total_ms,snapshotMs=self.output_ms,frameBytes=particles.nbytes+u.nbytes+v.nbytes+T.nbytes,transferredBytes=self.snapshot_bytes,substepHostTransfers=0,requests=self.requests,contactAlgorithm='row-sum-bounded Jacobi / normal then friction / 4 iterations',frictionHeatDistribution='measured assembled kinetic loss / row-sum contact weights',bulkHeat='reference-neighbor finite-volume solid conduction')),particles
