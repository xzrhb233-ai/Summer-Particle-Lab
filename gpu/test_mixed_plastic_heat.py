"""Local constitutive plastic/creep heat checks, without a mesh/time-step study."""
import math
import unittest
import numpy as np
import taichi as ti
from mixed_material import MixedMPM
from runtime import initialize
from thermal_plasticity import DEFAULTS


@ti.kernel
def imposed_return(s:ti.template(),trial:ti.types.matrix(3,3,ti.f32),temperature:ti.f32,dt:ti.f32):
    for i in range(s.capacity):
        s.temp[i]=temperature
        s.enthalpy[i]=ti.cast(temperature,ti.f64)*s.heat_capacity
        s.F[i]=s.project(i,trial,dt)


class PlasticHeatChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize('cuda')

    def make(self,model=10,beta=1.,cp=900.,alpha=0.,ratio=1.,stiffness=7.,thermal=True,creep=None):
        material=dict(cp=cp,thermalMaterial=DEFAULTS|(creep or {}),thermomechanical=dict(
            expansion=alpha,referenceTemperature=20.,hotStiffnessRatio=ratio,plasticHeatFraction=beta))
        s=MixedMPM(1,material)
        s.dissipation_stiffness=stiffness
        s.dissipation_thermal_enabled=thermal
        s.model.fill(model);s.mass.fill(.037);s.volume.fill(.025);s.plastic.fill(0.)
        return s

    def project(self,s,trial,temperature=20.,dt=.01):
        imposed_return(s,np.asarray(trial,np.float32),temperature,dt)
        return dict(F=s.F.to_numpy()[0].astype(float),ep=float(s.plastic[0]),
                    work=float(s.plastic_work[None]),heat=float(s.plastic_heat[None]),
                    h=float(s.enthalpy[0]),mass=float(s.mass[0]),volume=float(s.volume[0]))

    def test_elastic_and_hydrostatic_returns_generate_no_heat(self):
        shear=np.diag([1.2,1/math.sqrt(1.2),1/math.sqrt(1.2)])
        for model in [0,1]:
            r=self.project(self.make(model),shear)
            self.assertEqual(r['work'],0.);self.assertEqual(r['heat'],0.)
        for model in [10,11]:
            r=self.project(self.make(model),np.eye(3)*1.1)
            self.assertLess(abs(r['work']),1e-12);self.assertLess(abs(r['heat']),1e-12)
        r=self.project(self.make(10),np.diag([1.001,1/1.001,1.]))
        self.assertEqual(r['ep'],0.);self.assertEqual(r['work'],0.);self.assertEqual(r['heat'],0.)

    def test_j2_work_has_si_units_and_excludes_numerical_return_loss(self):
        temperature=100.;alpha=.0005;stiffness=7.;ratio=.35;beta=.6;cp=900.
        a=math.exp(alpha*(temperature-20));trial=a*np.diag([1.2,1/math.sqrt(1.2),1/math.sqrt(1.2)])
        s=self.make(beta=beta,cp=cp,alpha=alpha,ratio=ratio,stiffness=stiffness)
        r=self.project(s,trial,temperature)
        e=np.log(np.linalg.svd(r['F']/a,compute_uv=False));dev=e-e.mean()
        factor=1-(1-ratio)*(temperature-DEFAULTS['Tref'])/(DEFAULTS['Thot']-DEFAULTS['Tref'])
        V0=.001*r['volume'];E0=r['mass']/(64*r['volume'])*16000*stiffness/.025;mu=.4*E0*factor
        expected=V0*math.sqrt(6)*mu*np.linalg.norm(dev)*r['ep']
        self.assertGreater(r['ep'],0.);self.assertGreater(expected,0.)
        self.assertAlmostEqual(r['work']/expected,1.,delta=2e-5)
        self.assertAlmostEqual(r['heat']/r['work'],beta,delta=2e-8)
        self.assertAlmostEqual(r['mass']*(r['h']-temperature*cp),r['heat'],delta=1e-10)
        et=np.log(np.linalg.svd(trial/a,compute_uv=False));dt=et-et.mean()
        release=V0*mu*(dt@dt-dev@dev)
        self.assertGreater(release,r['work'])
        self.assertAlmostEqual((release-r['work'])/(1.5*V0*mu*r['ep']**2),1.,delta=1e-4)
        # Thermal stretch must not multiply work by a**3 or erase plastic volume preservation.
        self.assertAlmostEqual(np.linalg.det(r['F']),a**3,delta=3e-6)

    def test_beta_scales_heat_without_changing_one_step_return(self):
        trial=np.diag([1.12,1/math.sqrt(1.12),1/math.sqrt(1.12)])
        rows=[self.project(self.make(beta=b),trial) for b in [0.,.25,1.]]
        self.assertGreater(rows[0]['work'],0.);self.assertEqual(rows[0]['heat'],0.)
        for b,r in zip([0.,.25,1.],rows):
            np.testing.assert_array_equal(r['F'],rows[0]['F'])
            self.assertEqual(r['ep'],rows[0]['ep'])
            self.assertAlmostEqual(r['work'],rows[0]['work'],places=12)
            self.assertAlmostEqual(r['heat'],b*r['work'],delta=1e-9)
        off=self.project(self.make(beta=1.,thermal=False),trial)
        self.assertGreater(off['work'],0.);self.assertEqual(off['heat'],0.)
        self.assertEqual(off['h'],20*900)

    def test_creep_work_is_positive_and_zero_rate_or_zero_dt_is_athermal(self):
        trial=np.diag([math.exp(.1),math.exp(-.1),1.])
        creep=dict(n=1.,Q=0.,rate=.1,stress=.04)
        s=self.make(11,beta=.8,cp=450.,creep=creep)
        r=self.project(s,trial,dt=.02)
        q_trial=math.sqrt(6)*.4*math.sqrt(.02)
        expected_ep=.02*.1*q_trial/.04/(1+.02*.1*1.2/.04)
        expected_work=r['mass']*10*7*(q_trial-1.2*expected_ep)*expected_ep
        self.assertAlmostEqual(r['ep']/expected_ep,1.,delta=2e-5)
        self.assertAlmostEqual(r['work']/expected_work,1.,delta=2e-5)
        self.assertAlmostEqual(r['heat'],.8*r['work'],delta=1e-9)
        self.assertGreater(r['h'],20*450)
        for rate,dt in [(0.,.02),(.1,0.)]:
            z=self.project(self.make(11,creep=creep|dict(rate=rate)),trial,dt=dt)
            self.assertEqual(z['ep'],0.);self.assertEqual(z['work'],0.);self.assertEqual(z['heat'],0.)


if __name__=='__main__':unittest.main(verbosity=2)
