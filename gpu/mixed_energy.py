"""Opt-in, resident read-only observer for recoverable MPM/FEM mechanics.

Every numerical work term belongs to an independently measured operator. The
stress/strain, gravity and Verlet integration errors remain in the residual;
none is reassigned to material dissipation or converted to heat.
"""
import math
import numpy as np
import taichi as ti

L=.025
P2G,G2P,BOUNDARY,POSITION,NORMAL,DAMPING,EXTERNAL,THERMAL,STRESS,GRAVITY_KICK,GRAVITY_POTENTIAL,FEM_ERROR=range(12)
STORAGE_KEYS=('mpmKinetic','mpmAffine','mpmPotential','mpmElastic','femKinetic','femElastic')


def disabled_energy(thermal):
    return dict(schema='coupled-energy/1',scope='recoverable-mpm-fem-mechanics',enabled=False,complete=False,reasons=['diagnostics-disabled'],
        storage={k:None for k in STORAGE_KEYS},initial=None,mechanical=None,knownMechanical=None,externalWork=None,thermalWork=None,
        physical={k:None for k in ['normal','friction','plastic','femDamping','total']},
        numerical={k:None for k in ['p2g','g2p','gridBoundary','positionCorrection','plasticReturn','total']},
        rawResidual=None,knownTermsResidual=None,unexplainedResidual=None,knownUnexplainedResidual=None,relativeResidual=None,
        mpmStressStrainError=None,gravityIntegrationResidual=None,femIntegrationResidual=None,thermalResidual=thermal['residual'],heatConversion=True,
        coverage=dict(recoverableMechanical=False,totalThermodynamic=False,reasons=['diagnostics-disabled','weak-thermoelastic-feedback','untracked-cold-work']))


@ti.data_oriented
class MixedEnergy:
    def __init__(self,owner):
        self.o=owner;self.s=owner.s
        self.values=ti.field(ti.f64,shape=12);self.back_values=ti.field(ti.f64,shape=12)
        self.issues=ti.field(ti.i32,shape=2);self.back_issues=ti.field(ti.i32,shape=2)
        self.storage=ti.field(ti.f64,shape=6);self.stage=ti.field(ti.f64,shape=16)
        self.shadow_mass=ti.field(ti.f64,shape=self.s.gmass.shape)
        self.shadow_momentum=ti.Vector.field(3,ti.f64,shape=self.s.gmass.shape)
        self.old_x=ti.Vector.field(3,ti.f32,shape=owner.n)
        self.old_particle_temperature=ti.field(ti.f32,shape=owner.n)
        self.old_u=ti.Vector.field(3,ti.f64,shape=owner.nn)
        self.old_temperature=ti.field(ti.f64,shape=owner.nn)
        self.start_force=ti.Vector.field(3,ti.f64,shape=owner.nn)
        self.lambda_=float(owner.c['fem']['A']['lambda']);self.mu=float(owner.c['fem']['A']['mu'])
        self.parameters=ti.field(ti.f64,shape=5)
        self.parameters.from_numpy(np.asarray([L,self.lambda_,self.mu,owner.expansion,owner.tref],np.float64))
        self.gravity=ti.Vector.field(3,ti.f64,shape=());self.gravity[None]=owner.gravity
        self.measure_storage();self.initial=float(np.sum(self.storage.to_numpy()))

    @ti.func
    def particle_kinetic(self,i):
        mass=ti.cast(self.s.mass[i],ti.f64);velocity=ti.cast(self.s.v[i],ti.f64)*self.parameters[0]
        return .5*mass*velocity.norm_sqr()

    @ti.func
    def particle_affine(self,i):
        C=ti.cast(self.s.C[i],ti.f64);h=ti.cast(self.s.mpm_h[None],ti.f64)*self.parameters[0]
        return .5*ti.cast(self.s.mass[i],ti.f64)*h*h/4*(C*C).sum()

    @ti.func
    def particle_potential(self,i):
        return -ti.cast(self.s.mass[i],ti.f64)*self.gravity[None].dot(ti.cast(self.s.x[i],ti.f64)*self.parameters[0])

    @ti.func
    def fem_cell_energy(self,c,old_u,old_T):
        gradient=ti.Matrix.zero(ti.f64,3,3);temperature=ti.cast(0.,ti.f64)
        for a in ti.static(range(4)):
            n=self.o.cells[c][a];u=self.o.u[n];T=self.o.temperature[n]
            if old_u:u=self.old_u[n]
            if old_T:T=self.old_temperature[n]
            gradient+=u.outer_product(self.o.grads[4*c+a]);temperature+=T/4
        theta=self.parameters[3]*(temperature-self.parameters[4])
        strain=.5*(gradient+gradient.transpose())-theta*ti.Matrix.identity(ti.f64,3)
        return self.o.cell_volume[c]*(self.parameters[2]*(strain*strain).sum()+.5*self.parameters[1]*strain.trace()**2)

    @ti.kernel
    def measure_storage(self):
        for k in range(6):self.storage[k]=0.
        for i in range(self.o.n):
            self.storage[0]+=self.particle_kinetic(i);self.storage[1]+=self.particle_affine(i)
            self.storage[2]+=self.particle_potential(i)
            self.storage[3]+=self.s.recoverable_energy(i,self.s.F[i],self.s.temp[i])
            if self.s.model[i]!=0 and self.s.model[i]!=1 and not (4<=self.s.model[i]<=7) and self.s.model[i]!=10 and self.s.model[i]!=11:self.issues[0]=1
        for n in range(self.o.nn):self.storage[4]+=.5*self.o.mass[n]*self.o.v[n].norm_sqr()
        for c in range(self.o.nc):self.storage[5]+=self.fem_cell_energy(c,0,0)

    @ti.kernel
    def begin_mpm(self):
        self.stage[0]=0.;self.stage[1]=0.
        for i in range(self.o.n):
            self.stage[0]+=self.particle_kinetic(i)+self.particle_affine(i)
            self.stage[1]+=self.particle_potential(i)

    @ti.kernel
    def after_gravity(self):
        self.stage[2]=0.
        for i in range(self.o.n):self.stage[2]+=self.particle_kinetic(i)+self.particle_affine(i)
        self.values[GRAVITY_KICK]+=self.stage[2]-self.stage[0]

    @ti.kernel
    def after_p2g(self):
        # Shadow APIC scatter excludes stress. It never writes the live grid,
        # whose gv still contains momentum at this measurement boundary.
        for I in ti.grouped(self.shadow_mass):
            self.shadow_mass[I]=0.;self.shadow_momentum[I]=ti.Vector.zero(ti.f64,3)
        for p in range(self.o.n):
            h=self.s.mpm_h[None];origin=self.s.mpm_origin[None]
            base=ti.cast(ti.floor((self.s.x[p]-origin)/h-.5),ti.i32)
            fx=(self.s.x[p]-origin)/h-base;weights=self.s.weights(fx)
            mass=ti.cast(self.s.mass[p],ti.f64);v=ti.cast(self.s.v[p],ti.f64)*self.parameters[0];C=ti.cast(self.s.C[p],ti.f64)
            for i,j,k in ti.static(ti.ndrange(3,3,3)):
                offset=ti.Vector([i,j,k]);dpos=ti.cast((offset-fx)*h,ti.f64)*self.parameters[0]
                weight=ti.cast(weights[i,0]*weights[j,1]*weights[k,2],ti.f64)
                self.shadow_mass[base+offset]+=weight*mass
                self.shadow_momentum[base+offset]+=weight*mass*(v+C@dpos)
        self.stage[3]=0.;self.stage[4]=0.
        for I in ti.grouped(self.shadow_mass):
            if self.shadow_mass[I]>1e-12:self.stage[3]+=.5*self.shadow_momentum[I].norm_sqr()/self.shadow_mass[I]
            if self.s.gmass[I]>1e-12:
                momentum=ti.cast(self.s.gv[I],ti.f64)*self.parameters[0]
                self.stage[4]+=.5*momentum.norm_sqr()/ti.cast(self.s.gmass[I],ti.f64)
        self.values[P2G]+=self.stage[3]-self.stage[2]
        self.values[STRESS]+=self.stage[4]-self.stage[3]

    @ti.kernel
    def after_grid(self):
        self.stage[5]=0.
        for I in ti.grouped(self.s.gmass):
            if self.s.gmass[I]>1e-12:
                velocity=ti.cast(self.s.gv[I],ti.f64)*self.parameters[0]
                self.stage[5]+=.5*ti.cast(self.s.gmass[I],ti.f64)*velocity.norm_sqr()
        self.values[BOUNDARY]+=self.stage[5]-self.stage[4]

    @ti.kernel
    def after_g2p(self):
        self.stage[6]=0.;self.stage[7]=0.
        for i in range(self.o.n):
            self.stage[6]+=self.particle_kinetic(i)+self.particle_affine(i)
            self.stage[7]+=self.particle_potential(i)
        self.values[G2P]+=self.stage[6]-self.stage[5]
        self.values[GRAVITY_POTENTIAL]+=self.stage[7]-self.stage[1]

    @ti.kernel
    def before_fem_drift(self,h:ti.f64):
        self.stage[8]=0.;self.stage[9]=self.values[DAMPING];self.stage[10]=self.values[EXTERNAL]
        decay=ti.exp(-self.o.damping*h/2)
        for n in range(self.o.nn):
            self.old_u[n]=self.o.u[n];self.start_force[n]=self.o.force[n]
            self.stage[8]+=.5*self.o.mass[n]*self.o.v[n].norm_sqr()
            for k in ti.static(range(3)):
                if not self.o.fixed[n,k]:self.values[DAMPING]+=.5*self.o.mass[n]*self.o.v[n][k]**2*(1-decay*decay)
        for c in range(self.o.nc):self.stage[8]+=self.fem_cell_energy(c,0,0)

    @ti.kernel
    def before_fem_kick(self,h:ti.f64):
        decay=ti.exp(-self.o.damping*h/2)
        for n in range(self.o.nn):
            for k in ti.static(range(3)):
                if not self.o.fixed[n,k]:
                    v=self.o.v[n][k]+.5*h*(self.o.force[n][k]+self.o.fthermal[n][k]-self.o.internal[n][k])/self.o.mass[n]
                    self.values[DAMPING]+=.5*self.o.mass[n]*v*v*(1-decay*decay)
                    self.values[EXTERNAL]+=.5*(self.start_force[n][k]+self.o.force[n][k])*(self.o.u[n][k]-self.old_u[n][k])

    @ti.kernel
    def after_fem(self):
        self.stage[11]=0.
        for n in range(self.o.nn):self.stage[11]+=.5*self.o.mass[n]*self.o.v[n].norm_sqr()
        for c in range(self.o.nc):self.stage[11]+=self.fem_cell_energy(c,0,0)
        self.values[FEM_ERROR]+=self.stage[11]-self.stage[8]+self.values[DAMPING]-self.stage[9]-(self.values[EXTERNAL]-self.stage[10])

    @ti.kernel
    def before_contact(self):
        self.stage[12]=0.;self.stage[13]=self.o.friction_totals[0]
        for i in range(self.o.n):
            self.old_x[i]=self.s.x[i]
            if ti.static(self.s.alpha!=0 or self.s.hot_ratio!=1):self.old_particle_temperature[i]=self.s.temp[i]
            self.stage[12]+=self.particle_kinetic(i)+self.particle_affine(i)
        for n in range(self.o.nn):
            self.old_u[n]=self.o.u[n];self.old_temperature[n]=self.o.temperature[n]
            self.stage[12]+=.5*self.o.mass[n]*self.o.v[n].norm_sqr()

    @ti.kernel
    def after_contact(self):
        self.stage[14]=0.
        for i in range(self.o.n):
            self.stage[14]+=self.particle_kinetic(i)+self.particle_affine(i)
            self.values[POSITION]-=ti.cast(self.s.mass[i],ti.f64)*self.gravity[None].dot((ti.cast(self.s.x[i],ti.f64)-ti.cast(self.old_x[i],ti.f64))*self.parameters[0])
            if ti.static(self.s.alpha!=0 or self.s.hot_ratio!=1):
                if self.s.temp[i]!=self.old_particle_temperature[i]:
                    self.values[THERMAL]+=self.s.recoverable_energy(i,self.s.F[i],self.s.temp[i])-self.s.recoverable_energy(i,self.s.F[i],self.old_particle_temperature[i])
        for n in range(self.o.nn):self.stage[14]+=.5*self.o.mass[n]*self.o.v[n].norm_sqr()
        for c in range(self.o.nc):
            after_heat=self.fem_cell_energy(c,1,0)
            if ti.static(self.o.expansion!=0):self.values[THERMAL]+=after_heat-self.fem_cell_energy(c,1,1)
            self.values[POSITION]+=self.fem_cell_energy(c,0,0)-after_heat
        loss=self.stage[12]-self.stage[14]-(self.o.friction_totals[0]-self.stage[13])
        self.values[NORMAL]+=loss
        if loss < -2e-6*ti.max(1e-12,self.stage[12])-1e-12:self.issues[1]=1

    @ti.kernel
    def before_heat(self):
        if ti.static(self.s.alpha!=0 or self.s.hot_ratio!=1):
            for i in range(self.o.n):self.old_particle_temperature[i]=self.s.temp[i]
        if ti.static(self.o.expansion!=0):
            for n in range(self.o.nn):self.old_temperature[n]=self.o.temperature[n]

    @ti.kernel
    def after_heat(self):
        if ti.static(self.s.alpha!=0 or self.s.hot_ratio!=1):
            for i in range(self.o.n):
                if self.s.temp[i]!=self.old_particle_temperature[i]:
                    self.values[THERMAL]+=self.s.recoverable_energy(i,self.s.F[i],self.s.temp[i])-self.s.recoverable_energy(i,self.s.F[i],self.old_particle_temperature[i])
        if ti.static(self.o.expansion!=0):
            for c in range(self.o.nc):self.values[THERMAL]+=self.fem_cell_energy(c,0,0)-self.fem_cell_energy(c,0,1)

    def checkpoint(self,restore=False):
        for a,b in [(self.values,self.back_values),(self.issues,self.back_issues)]:a.copy_from(b) if restore else b.copy_from(a)

    def snapshot(self,thermal,friction):
        self.measure_storage();stored=self.storage.to_numpy();v=self.values.to_numpy();issues=self.issues.to_numpy()
        plastic=float(self.s.plastic_work[None]);plastic_return=float(self.s.plastic_return_work[None]);plastic_thermal=float(self.s.plastic_thermal_work[None])
        trial=float(self.s.plastic_trial_work[None]);E=float(np.sum(stored));W=float(v[EXTERNAL]);Wt=float(v[THERMAL])+plastic_thermal
        physical=dict(normal=float(v[NORMAL]),friction=float(friction[0]),plastic=plastic,femDamping=float(v[DAMPING]));physical['total']=sum(physical.values())
        numerical=dict(p2g=float(v[P2G]),g2p=float(v[G2P]),gridBoundary=float(v[BOUNDARY]),positionCorrection=float(v[POSITION]),plasticReturn=plastic_return);numerical['total']=sum(numerical.values())
        known=E+physical['total']-self.initial-W-Wt;remaining=known-numerical['total']
        reasons=[]
        if issues[0]:reasons.append('unsupported-recoverable-material-energy')
        if issues[1]:reasons.append('normal-contact-injected-energy')
        if int(self.s.energy_clamped[None]):reasons.append('constitutive-energy-clamp-active')
        if not all(math.isfinite(x) for x in [*stored,*v,plastic,plastic_return,plastic_thermal,trial]):reasons.append('non-finite-energy-observation')
        complete=not reasons
        return dict(schema='coupled-energy/1',scope='recoverable-mpm-fem-mechanics',enabled=True,complete=complete,reasons=reasons,
            storage={k:float(x) for k,x in zip(STORAGE_KEYS,stored)},initial=self.initial,mechanical=E if complete else None,knownMechanical=E,
            externalWork=W,thermalWork=Wt,physical=physical,numerical=numerical,rawResidual=known if complete else None,knownTermsResidual=known,
            unexplainedResidual=remaining if complete else None,knownUnexplainedResidual=remaining,
            relativeResidual=remaining/max(1e-12,abs(self.initial),abs(E),abs(W),abs(Wt),abs(physical['total'])) if complete else None,
            mpmStressStrainError=float(v[STRESS])+trial,gravityIntegrationResidual=float(v[GRAVITY_KICK]+v[GRAVITY_POTENTIAL]),femIntegrationResidual=float(v[FEM_ERROR]),
            thermalResidual=thermal['residual'],heatConversion=True,
            coverage=dict(recoverableMechanical=complete,totalThermodynamic=False,reasons=['weak-thermoelastic-feedback','untracked-cold-work']),
            transferObservation='independent unstressed f64 APIC shadow grid; live f32 scatter roundoff remains visible')
