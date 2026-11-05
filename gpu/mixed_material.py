"""Resident thermomechanical MPM: elastic thermal stretch + existing J2/creep.

F stores the recoverable (elastic times thermal) distortion, as in the legacy
plastic solver. Plastic return changes that state; cooling never resets it.
Strength and hardening parameters are normalized by the reference modulus.
"""
import math
import taichi as ti
from solver import Solver
from thermal_plasticity import parameters, thermal_return
from metal_plasticity import parameters as metal_parameters, metal_return

PLASTIC_WORK_SCALE=4*math.sqrt(6)

@ti.data_oriented
class MixedMPM(Solver):
    def __init__(self,n,material,neighbor_domain=None):
        super().__init__(n,neighbor_domain=neighbor_domain)
        p=material.get('thermomechanical',{})
        self.alpha=p.get('expansion',0.);self.reference=p.get('referenceTemperature',20.)
        self.hot_ratio=p.get('hotStiffnessRatio',1.)
        self.plastic_heat_fraction=p.get('plasticHeatFraction',0.)
        self.heat_capacity=material.get('cp',1800.)
        # Host assignment preserves f64 authoring values. Casting a Python float
        # inside a default-f32 kernel first rounds it to f32 (e.g. beta=.6).
        self.dissipation_parameters=ti.field(ti.f64,shape=4)
        self.dissipation_parameters[0]=self.plastic_heat_fraction
        self.dissipation_parameters[1]=self.heat_capacity
        # MixedSolver sets these immutable configuration values before compiling
        # the first project kernel. Work is reported even when conversion is off.
        self.dissipation_stiffness=1.
        self.dissipation_thermal_enabled=True
        self.plastic_work=ti.field(ti.f64,shape=())
        self.plastic_heat=ti.field(ti.f64,shape=())
        self.energy_enabled=False
        self.plastic_trial_work=ti.field(ti.f64,shape=())
        self.plastic_return_work=ti.field(ti.f64,shape=())
        self.plastic_thermal_work=ti.field(ti.f64,shape=())
        self.energy_clamped=ti.field(ti.i32,shape=())
        self.tm=parameters(material['thermalMaterial'])
        self.thermal_materials[1]=self.tm
        metal=metal_parameters(material.get('plasticity'))
        if metal is None:raise ValueError('Invalid mixed MPM metal plasticity parameters')
        self.plasticity[1]=metal

    @property
    def dissipation_stiffness(self):
        return self._dissipation_stiffness

    @dissipation_stiffness.setter
    def dissipation_stiffness(self,value):
        self._dissipation_stiffness=value
        self.dissipation_parameters[2]=PLASTIC_WORK_SCALE*value
        self.dissipation_parameters[3]=4*value

    @ti.func
    def energy_factor(self,T):
        # Match the f32 temperature used by the mechanical constitutive law.
        temperature=ti.cast(T,ti.f32)
        theta=ti.min(1.,ti.max(0.,(temperature-self.tm[0])/(self.tm[1]-self.tm[0])))
        return ti.cast(1-(1-self.hot_ratio)*theta,ti.f64)

    @ti.func
    def energy_from_stretches(self,i,sigma,T):
        # Dimensionless potential W/mu, evaluated from an existing SVD.
        s=ti.cast(sigma,ti.f64);J=s[0]*s[1]*s[2]
        if J<=1e-8 or s.min()<=0:self.energy_clamped[None]=1
        J=ti.max(J,1e-8);w=ti.cast(0.,ti.f64)
        if self.model[i]==0:
            w=(s-ti.Vector([1.,1.,1.],dt=ti.f64)).norm_sqr()+.5*(J-1)**2
        elif self.model[i]==1:
            logJ=ti.log(J);w=.5*(s.norm_sqr()-3)-logJ+.5*logJ**2
        else:
            if s.min()<1e-6:self.energy_clamped[None]=1
            e=ti.log(ti.max(s,1e-6));w=e.norm_sqr()+.5*e.sum()**2
        # V0*mu = 4*m*stiffness*modulus_ratio, in SI joules.
        return ti.cast(self.mass[i],ti.f64)*self.dissipation_parameters[3]*self.energy_factor(T)*w

    @ti.func
    def recoverable_energy(self,i,F,T):
        """Recoverable strain energy (J); no thermoelastic entropy/hardening energy.

        Only the diagnostic clamp flag can change. Physical fields are read-only.
        """
        temperature=ti.cast(T,ti.f32)
        a=ti.exp(self.alpha*(temperature-self.reference));Fe=F/a
        result=ti.cast(0.,ti.f64)
        if Fe.determinant()<=1e-8:self.energy_clamped[None]=1
        if self.model[i]==1:
            # Neo-Hookean needs no SVD. f64 invariants prevent cancellation near I.
            A=ti.cast(Fe,ti.f64);J=ti.max(A.determinant(),1e-8);logJ=ti.log(J)
            w=.5*((A*A).sum()-3)-logJ+.5*logJ**2
            result=ti.cast(self.mass[i],ti.f64)*self.dissipation_parameters[3]*self.energy_factor(T)*w
        else:
            U,S,V=ti.svd(Fe,ti.f32)
            sigma=ti.Vector([S[k,k] for k in ti.static(range(3))])
            result=self.energy_from_stretches(i,sigma,T)
        return result

    @ti.func
    def stretch(self,i):
        # Exponential thermal stretch is positive and integrates constant alpha.
        return ti.exp(self.alpha*(self.temp[i]-self.reference))

    @ti.func
    def modulus_ratio(self,i):
        theta=ti.min(1.,ti.max(0.,(self.temp[i]-self.tm[0])/(self.tm[1]-self.tm[0])))
        return 1-(1-self.hot_ratio)*theta

    @ti.func
    def stress_tensor(self,i,stiffness):
        a=self.stretch(i);F=self.F[i]/a;J=ti.max(F.determinant(),1e-8)
        E0=self.mass[i]/(64*self.volume[i])*16000*stiffness;E=E0*self.modulus_ratio(i)
        mu,la=.4*E,.4*E;tau=ti.Matrix.zero(ti.f32,3,3)
        if self.model[i]==1:
            tau=mu*(F@F.transpose()-ti.Matrix.identity(ti.f32,3))+la*ti.log(J)*ti.Matrix.identity(ti.f32,3)
        else:
            U,S,V=ti.svd(F,ti.f32)
            if 4<=self.model[i]<=7 or self.model[i]>=10:
                e=ti.Vector([ti.log(ti.max(S[k,k],1e-6)) for k in ti.static(range(3))]);d=2*mu*e+la*e.sum()
                tau=U@ti.Matrix([[d[0],0.,0.],[0.,d[1],0.],[0.,0.,d[2]]])@U.transpose()
            else:
                tau=2*mu*(F-U@V.transpose())@F.transpose()+la*(J-1)*J*ti.Matrix.identity(ti.f32,3)
        dev=tau-tau.trace()/3*ti.Matrix.identity(ti.f32,3)
        self.stress[i]=ti.sqrt(1.5*(dev*dev).sum())/ti.max(self.F[i].determinant(),1e-8)/E0
        return tau

    @ti.func
    def project(self,i,F,dt):
        result=F
        temperature=self.temp[i];old_energy=ti.cast(0.,ti.f64)
        if ti.static(self.energy_enabled):
            old_energy=self.recoverable_energy(i,self.F[i],temperature)
        if 4<=self.model[i]<=7 or self.model[i]>=10:
            a=self.stretch(i);U,S,V=ti.svd(F/a,ti.f32)
            sigma=ti.Vector([ti.max(S[k,k],1e-8) for k in ti.static(range(3))])
            factor=self.modulus_ratio(i)
            # Existing return map uses stresses / current E; authoring uses E0.
            projected=sigma;increment=0.
            if self.model[i]<=7:
                params=self.plasticity[1];params[0]/=factor;params[1]/=factor
                projected,increment=metal_return(sigma,self.model[i],self.plastic[i],dt,self.temp[i],params)
            else:
                params=self.thermal_materials[1]
                params[3]/=factor;params[4]/=factor;params[8]/=factor
                projected,increment=thermal_return(sigma,self.model[i],self.plastic[i],dt,self.temp[i],params)
            self.plastic[i]+=increment
            result=a*(U@ti.Matrix([[projected[0],0.,0.],[0.,projected[1],0.],[0.,0.,projected[2]]])@V.transpose())
            # Backward-Euler plastic/creep work: V0 * tau_eq(returned) * dep.
            # V0=.001*volume m3 and E0_phys=E0_internal/.025 Pa, hence
            # V0*mu/m = 4*stiffness*modulus_ratio J/kg. Using returned Kirchhoff
            # stress avoids a spurious thermal/elastic determinant factor.
            # The extra trial-to-return elastic release 1.5*V0*mu*dep**2 is
            # numerical return-map dissipation; it is deliberately not heat.
            e=ti.log(ti.max(projected,1e-6));dev=e-e.sum()/3
            specific_work=self.dissipation_parameters[2]*ti.cast(factor,ti.f64)*ti.cast(dev.norm(),ti.f64)*ti.cast(ti.max(0.,increment),ti.f64)
            mass=ti.cast(self.mass[i],ti.f64)
            self.plastic_work[None]+=mass*specific_work
            returned_energy=ti.cast(0.,ti.f64)
            if ti.static(self.energy_enabled):
                trial_energy=self.energy_from_stretches(i,sigma,temperature)
                returned_energy=self.energy_from_stretches(i,projected,temperature)
                self.plastic_trial_work[None]+=trial_energy-old_energy
                # Signed mechanical contribution; its negative is the additional
                # return-map algorithmic loss, distinct from physical plastic work.
                self.plastic_return_work[None]+=returned_energy-trial_energy+mass*specific_work
            if ti.static(self.dissipation_thermal_enabled and self.plastic_heat_fraction>0):
                before=self.enthalpy[i]
                self.enthalpy[i]=before+self.dissipation_parameters[0]*specific_work
                self.temp[i]=ti.cast(self.enthalpy[i]/self.dissipation_parameters[1],ti.f32)
                # Book the represented enthalpy increment, including roundoff.
                self.plastic_heat[None]+=mass*(self.enthalpy[i]-before)
                if ti.static(self.energy_enabled and (self.alpha!=0 or self.hot_ratio!=1)):
                    if self.temp[i]!=temperature:
                        # Freeze the actual reconstructed f32 F. Reusing ideal
                        # projected singulars here misses reconstruction/thermal
                        # division roundoff in the observer's stored energy.
                        # The extra evaluations occur only if mechanical T changes.
                        self.plastic_thermal_work[None]+=self.recoverable_energy(i,result,self.temp[i])-self.recoverable_energy(i,result,temperature)
        elif ti.static(self.energy_enabled):
            self.plastic_trial_work[None]+=self.recoverable_energy(i,F,temperature)-old_energy
        return result
