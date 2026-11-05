"""MPM-led native-domain orchestration. All views reference resident Taichi fields.

The common grid belongs to the MPM operator. FEM topology, PBF neighborhoods
and rigid generalized coordinates remain native; coupling uses shared GPU
impulse/heat ledgers rather than pretending every domain is an MPM material.
No field readback or synchronization is permitted in substep/checkpoint.
"""
from dataclasses import dataclass

@dataclass(frozen=True)
class DomainView:
    id: str
    method: str
    count: int
    fields: dict
    start: int = 0
    length_scale: float = 1.

class DeviceDomains:
    def __init__(self):self.domains={}
    def register(self,view):
        if view.id in self.domains:raise ValueError('Duplicate device domain: '+view.id)
        if view.method not in ('mpm','pbf','fem','rigid') or view.count<1:raise ValueError('Invalid device domain')
        self.domains[view.id]=view
        return view
    def describe(self):
        return [dict(id=v.id,method=v.method,count=v.count,start=v.start,lengthScale=v.length_scale,fields=list(v.fields)) for v in self.domains.values()]

class DeviceTransaction:
    def __init__(self,*participants):self.participants=participants
    def checkpoint(self,restore=False):
        for participant in self.participants:participant(restore)

class NativeDomain:
    def __init__(self,owner,view):self.o=owner;self.view=view
    def predict(self,h):pass
    def advance(self,h):pass

class MPMDomain(NativeDomain):
    def predict(self,h):self.o.particle_drift(h,self.view.start,self.view.start+self.view.count,False)
    def advance(self,h):
        o=self.o;s=o.s
        s.prepare(o.n,o.c.stiffness);s.clear_grid();s.p2g(o.n,h)
        s.grid_step(0,0.,0.);s.g2p(o.n,h)

class PBFDomain(NativeDomain):
    def predict(self,h):self.o.particle_drift(h,self.view.start,self.view.start+self.view.count,True)
    def advance(self,h):
        if self.o.framework.pbd is not None:return
        o=self.o;s=o.s;o.pressure_start()
        for _ in range(3):
            s.clear_neighbors();s.build_neighbors(o.n);s.density(o.n)
            s.corrections(o.n,1,h,3,0);o.record_fluid_pressure(h);s.apply_corrections(o.n,1,0,0.,0)
        o.pressure_finish(h)

class FEMDomain(NativeDomain):
    def advance(self,h):
        c=self.o.c
        c.fem_thermal_force();c.fem_loading(h,0);c.fem_force();c.fem_drift(h)
        c.fem_loading(h,1);c.fem_force();c.fem_kick(h)

class RigidDomain(NativeDomain):
    def predict(self,h):self.o.rigid_drift(h)

class CouplingManager:
    def __init__(self,owner,domains):
        self.o=owner;self.pairs=tuple(owner.pairs)
        for p in self.pairs:
            if p['a'] not in domains.domains or p['b'] not in domains.domains or p['a']==p['b']:
                raise ValueError('Contact pair references an invalid device domain')
        self.impulse_heat=owner.totals;self.support=owner.support
    def mechanical(self,h):
        o=self.o;c=o.c
        if o.framework.pbd is not None:
            o.framework.pbd.solve(h);return
        o.check_swept();o.check_motion()
        for _ in range(6):
            o.particle_interface.solve()
            c.prepare_surface();c.find_contacts();o.find();o.contact_bound()
            o.contact(0);o.contact(1);o.contact(2)
    def thermal(self,h):
        o=self.o;c=o.c;s=o.s
        if not o.project['solver']['thermal']:return
        c.prepare_surface();c.find_contacts();o.find();s.clear_neighbors();s.build_neighbors(o.n)
        o.thermal_prepare();o.heat(0,h);o.heat(1,h);o.heat_apply();o.thermal_loads.step(h)

class MPMFramework:
    def __init__(self,owner,length_scale):
        self.o=owner;c=owner.c;s=owner.s
        self.clock=owner.device_time;self.domains=DeviceDomains()
        f,m,w,r=owner.project['parts']
        particle_fields=dict(position=s.x,velocity=s.v,mass=s.mass,enthalpy=s.enthalpy,temperature=s.temp,pinned=s.pinned)
        mv=self.domains.register(DomainView(m['id'],'mpm',owner.nm,{**particle_fields,'deformation':s.F,'affine':s.C},length_scale=length_scale))
        wv=self.domains.register(DomainView(w['id'],'pbf',owner.n-owner.nm,particle_fields,start=owner.nm,length_scale=length_scale))
        fv=self.domains.register(DomainView(f['id'],'fem',owner.nn,dict(reference=c.nodes,displacement=c.u,velocity=c.v,mass=c.mass,temperature=c.temperature,capacity=c.capacity,connectivity=c.cells)))
        rv=self.domains.register(DomainView(r['id'],'rigid',1,dict(position=owner.rx,velocity=owner.rv,rotation=owner.rq,angularVelocity=owner.rw,temperature=owner.rigid_temperature)))
        self.operators=(MPMDomain(owner,mv),PBFDomain(owner,wv),FEMDomain(owner,fv),RigidDomain(owner,rv))
        self.grid=dict(mass=s.gmass,momentum_or_velocity=s.gv)
        self.coupling=CouplingManager(owner,self.domains)
        self.mode=owner.project['solver'].get('couplingMode','native')
        if self.mode not in ('native','unified-pbd'):raise ValueError('Unknown couplingMode')
        self.pbd=None
        if self.mode=='unified-pbd':
            from unified_pbd import UnifiedPBD
            iterations=owner.project['solver'].get('pbdIterations',6)
            if isinstance(iterations,bool) or not isinstance(iterations,int) or not 1<=iterations<=20:raise ValueError('pbdIterations must be an integer in 1–20')
            self.pbd=UnifiedPBD(owner,iterations)
        self.transaction=DeviceTransaction(c.checkpoint,owner.thermal_loads.checkpoint,owner.checkpoint_extra)
    def substep(self,h):
        o=self.o
        if getattr(self,'pbd',None) is not None:self.pbd.stabilize(h)
        o.capture_motion()
        for domain in self.operators:domain.predict(h)
        for domain in self.operators:domain.advance(h)
        self.coupling.mechanical(h);self.coupling.thermal(h)
        o.check_motion();o.validate_state(h);o.c.advance_clock(h)
    def checkpoint(self,restore=False):self.transaction.checkpoint(restore)
    def describe(self):
        return dict(schema='mpm-unified-framework/1',coordinator='mpm',execution='taichi-cuda',
                    domains=self.domains.describe(),contactPairs=[dict(id=p['id'],a=p['a'],b=p['b']) for p in self.coupling.pairs],
                    clock='shared-adaptive',state='resident-device-views',rollback='all-domains-and-ledgers',
                    gridScope='mpm-only',coupling='unified-pbd-hybrid' if self.pbd else 'native-contact-and-thermal',
                    couplingMode=self.mode,pbdIterations=self.pbd.iterations if self.pbd else None,
                    constraintScope='density-and-interdomain-contact' if self.pbd else None,multiRate=False)
