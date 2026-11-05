"""Resident recoverable-energy/return-work checks for models 0, 1, 10 and 11."""
import math
import unittest
import numpy as np
import taichi as ti
from mixed_material import MixedMPM
from runtime import initialize
from thermal_plasticity import DEFAULTS


@ti.kernel
def evaluate(s:ti.template(),F:ti.types.matrix(3,3,ti.f32),T:ti.f32)->ti.f64:
    return s.recoverable_energy(0,F,T)


@ti.kernel
def stress_work(s:ti.template(),F:ti.types.matrix(3,3,ti.f32),T:ti.f32,A:ti.types.matrix(3,3,ti.f32),stiffness:ti.f32)->ti.f64:
    s.F[0]=F;s.temp[0]=T
    tau=s.stress_tensor(0,stiffness)
    return ti.cast(64*s.volume[0]*.025*.025*(tau*A).sum(),ti.f64)


@ti.kernel
def return_trial(s:ti.template(),F:ti.types.matrix(3,3,ti.f32),T:ti.f32,dt:ti.f32):
    s.temp[0]=T;s.enthalpy[0]=ti.cast(T,ti.f64)*s.dissipation_parameters[1]
    s.F[0]=s.project(0,F,dt)


def potential(F,model,T,mass,stiffness,alpha,hot_ratio):
    a=math.exp(alpha*(T-20));Fe=np.asarray(F,dtype=float)/a;J=np.linalg.det(Fe)
    factor=1-(1-hot_ratio)*np.clip((T-DEFAULTS['Tref'])/(DEFAULTS['Thot']-DEFAULTS['Tref']),0,1)
    if model==1:
        w=.5*(np.sum(Fe*Fe)-3)-math.log(J)+.5*math.log(J)**2
    else:
        sigma=np.linalg.svd(Fe,compute_uv=False)
        if model==0:w=np.sum((sigma-1)**2)+.5*(J-1)**2
        else:
            e=np.log(sigma);w=e@e+.5*e.sum()**2
    return 4*mass*stiffness*factor*w


class MaterialEnergyChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize('cuda')

    def make(self,model=10,enabled=True,beta=0.,cp=900.,alpha=.0002,ratio=.35,stiffness=7.):
        m=dict(cp=cp,thermalMaterial=DEFAULTS,thermomechanical=dict(expansion=alpha,referenceTemperature=20.,hotStiffnessRatio=ratio,plasticHeatFraction=beta))
        s=MixedMPM(1,m);s.energy_enabled=enabled;s.dissipation_stiffness=stiffness
        s.model.fill(model);s.mass.fill(.037);s.volume.fill(.025)
        s.F.from_numpy(np.eye(3,dtype=np.float32)[None]);s.temp.fill(20);s.enthalpy.fill(20*cp)
        return s

    def energy(self,s,F,T=20.):return float(evaluate(s,np.asarray(F,np.float32),T))

    def test_si_potentials_objectivity_and_free_thermal_stretch(self):
        angle=.63;Q=np.array([[math.cos(angle),-math.sin(angle),0],[math.sin(angle),math.cos(angle),0],[0,0,1.]])
        F=np.array([[1.14,.07,0],[.01,.94,.03],[0,.02,1.04]])
        for model in [0,1,10,11]:
            s=self.make(model);T=100.;mass=float(s.mass[0])
            U=self.energy(s,F,T);expected=potential(F,model,T,mass,7.,.0002,.35)
            self.assertAlmostEqual(U/expected,1.,delta=3e-5)
            self.assertAlmostEqual(self.energy(s,Q@F,T),U,delta=3e-6)
            a=math.exp(.0002*(T-20));self.assertLess(abs(self.energy(s,a*Q,T)),2e-10)
            s.mass[0]=2*mass;self.assertAlmostEqual(self.energy(s,F,T),2*U,delta=2e-8)

    def test_energy_derivative_matches_kirchhoff_stress(self):
        F=np.array([[1.12,.06,.02],[.01,.95,0],[0,.02,1.03]])
        A=np.array([[.3,.12,0],[.04,-.2,.06],[0,0,.1]])
        h=.001;T=80.
        for model in [0,1,10,11]:
            s=self.make(model)
            derivative=(self.energy(s,(np.eye(3)+h*A)@F,T)-self.energy(s,(np.eye(3)-h*A)@F,T))/(2*h)
            expected=float(stress_work(s,F.astype(np.float32),T,A.astype(np.float32),7.))
            self.assertAlmostEqual(derivative/expected,1.,delta=.002)

    def test_return_book_splits_trial_physical_and_algorithmic_work(self):
        F=np.diag([1.16,1/math.sqrt(1.16),1/math.sqrt(1.16)]).astype(np.float32)
        for model in [10,11]:
            s=self.make(model,alpha=0.,ratio=1.);initial=self.energy(s,np.eye(3));trial=self.energy(s,F)
            return_trial(s,F,20.,.02)
            final=self.energy(s,s.F.to_numpy()[0]);wp=float(s.plastic_work[None]);ret=float(s.plastic_return_work[None]);step=float(s.plastic_trial_work[None])
            self.assertGreater(wp,0.);self.assertLess(ret,0.)
            self.assertAlmostEqual(step,trial-initial,delta=2e-6)
            self.assertAlmostEqual(final-initial,step-wp+ret,delta=2e-6)
            dep=float(s.plastic[0]);expected_loss=6*float(s.mass[0])*7*dep**2
            self.assertAlmostEqual(-ret,expected_loss,delta=2e-6)
            self.assertEqual(float(s.plastic_thermal_work[None]),0.)

    def test_frozen_deformation_thermal_work_and_passive_diagnostics(self):
        F=np.diag([1.15,1/math.sqrt(1.15),1/math.sqrt(1.15)]).astype(np.float32)
        # Larger stiffness exposes genuine temperature feedback without scaling Q.
        args=dict(beta=.9,cp=900.,alpha=.0004,ratio=.35,stiffness=100000.)
        enabled=self.make(10,enabled=True,**args);disabled=self.make(10,enabled=False,**args)
        return_trial(enabled,F,100.,.02);return_trial(disabled,F,100.,.02)
        for key in ['F','plastic','temp','enthalpy']:
            np.testing.assert_array_equal(getattr(enabled,key).to_numpy(),getattr(disabled,key).to_numpy())
        for key in ['plastic_work','plastic_heat']:
            self.assertEqual(float(getattr(enabled,key)[None]),float(getattr(disabled,key)[None]))
        afterF=enabled.F.to_numpy()[0];afterT=float(enabled.temp[0])
        self.assertGreater(afterT,100.)
        expected=self.energy(enabled,afterF,afterT)-self.energy(enabled,afterF,100.)
        measured=float(enabled.plastic_thermal_work[None])
        self.assertAlmostEqual(measured,expected,delta=3e-4)
        self.assertNotEqual(measured,0.)
        saved=[enabled.F.to_numpy().copy(),enabled.temp.to_numpy().copy(),enabled.enthalpy.to_numpy().copy()]
        forward=self.energy(enabled,afterF,140.)-self.energy(enabled,afterF,20.)
        backward=self.energy(enabled,afterF,20.)-self.energy(enabled,afterF,140.)
        self.assertAlmostEqual(forward+backward,0.,places=12)
        for field,before in zip([enabled.F,enabled.temp,enabled.enthalpy],saved):np.testing.assert_array_equal(field.to_numpy(),before)
        self.assertEqual(float(disabled.plastic_trial_work[None]),0.)
        self.assertEqual(float(disabled.plastic_return_work[None]),0.)
        self.assertEqual(float(disabled.plastic_thermal_work[None]),0.)

    def test_clamped_stretches_are_reported_as_incomplete_coverage(self):
        s=self.make(10);self.assertEqual(int(s.energy_clamped[None]),0)
        self.energy(s,np.diag([1e-7,2.,2.]))
        self.assertEqual(int(s.energy_clamped[None]),1)


if __name__=='__main__':unittest.main(verbosity=2)
