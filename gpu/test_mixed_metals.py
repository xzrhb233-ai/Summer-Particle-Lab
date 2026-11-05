"""CUDA resident metal laws: CPU reference, thermal return and heat bookkeeping."""
import json,math,subprocess,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from mixed_material import MixedMPM
from metal_plasticity import DEFAULTS,parameters
from thermal_plasticity import DEFAULTS as THERMAL

@ti.kernel
def return_one(s:ti.template(),dt:ti.f32):
    s.F[0]=s.project(0,s.F[0],dt)

class MixedMetals(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize('cuda')
        cls.s=MixedMPM(1,dict(cp=900.,thermalMaterial=THERMAL,plasticity=DEFAULTS,
            thermomechanical=dict(expansion=.0002,hotStiffnessRatio=.4,plasticHeatFraction=.6)))
        cls.s.energy_enabled=True;cls.s.dissipation_stiffness=7.
        cls.s.mass.fill(.037);cls.s.volume.fill(.025)

    def seed(self,model,F,temp=20.,ep=0.,p=None):
        s=self.s;s.model[0]=model;s.F[0]=F;s.plastic[0]=ep
        s.temp[0]=temp;s.enthalpy[0]=temp*900;s.plasticity[1]=parameters(p)
        for f in [s.plastic_work,s.plastic_heat,s.plastic_trial_work,s.plastic_return_work,s.plastic_thermal_work,s.energy_clamped]:f.fill(0)
        return s

    def test_reference_return_stress_and_irreversible_history(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('mixed_metal_reference.mjs'))],text=True))
        for c in cases:
            s=self.seed(c['model'],np.array(c['F']).reshape(3,3),temp=c['temp'],ep=c['ep'],p=c['p'])
            return_one(s,c['dt']);actual=s.F[0].to_numpy()
            np.testing.assert_allclose(actual,np.array(c['expected']).reshape(3,3),atol=4e-6,rtol=4e-5)
            self.assertAlmostEqual(s.plastic[0],c['plastic'],places=5)
            # Compare at the same pre-heat temperature as the CPU reference.
            s.temp[0]=c['temp'];s.prepare(1,7.)
            E0=s.mass[0]/(64*s.volume[0])*16000*7
            np.testing.assert_allclose(s.tau[0].to_numpy()/E0,np.array(c['tau']).reshape(3,3),atol=3e-6,rtol=5e-4)
            self.assertGreaterEqual(s.plastic_work[None],0.)
            self.assertAlmostEqual(s.plastic_heat[None],.6*s.plastic_work[None],delta=1e-10)
            self.assertAlmostEqual(s.mass[0]*(s.enthalpy[0]-c['temp']*900),s.plastic_heat[None],delta=1e-10)
            ep=float(s.plastic[0]);s.F[0]=np.eye(3)*math.exp(.0002*(c['temp']-20));return_one(s,.01)
            self.assertAlmostEqual(s.plastic[0],ep,places=6)

    def test_thermal_expansion_and_hydrostatic_loading_do_not_create_plastic_heat(self):
        for model in [4,5,6,7]:
            a=math.exp(.0002*(120-20));s=self.seed(model,np.eye(3)*a*1.05,temp=120)
            return_one(s,.01)
            self.assertLess(abs(s.plastic_work[None]),1e-12)
            self.assertEqual(s.plastic_heat[None],0.)
            self.assertEqual(s.plastic[0],0.)

    def test_johnson_cook_temperature_and_rate_response(self):
        trial=np.diag([1.3,.8,1/1.04]);rows={}
        for model in [4,5,6,7]:
            for T in [20.,650.]:
                for dt in [.001,.02]:
                    a=math.exp(.0002*(T-20));s=self.seed(model,a*trial,temp=T,ep=.15,p=dict(A=.03,B=.12))
                    return_one(s,dt);ep=float(s.plastic[0])-.15;rows[model,T,dt]=ep
                    self.assertGreater(ep,0.)
                    self.assertAlmostEqual(np.linalg.det(s.F[0].to_numpy()),a**3,delta=4e-6)
                    self.assertGreater(s.plastic_heat[None],0.)
                    self.assertEqual(s.energy_clamped[None],0)
                    self.assertAlmostEqual(s.plastic_heat[None],.6*s.plastic_work[None],delta=1e-9)
        for model in [6,7]:self.assertLess(rows[model,20.,.001],rows[model,20.,.02])
        self.assertGreater(rows[6,650.,.02],rows[7,650.,.02])
        self.assertGreater(rows[4,20.,.02],rows[5,20.,.02])

if __name__=='__main__':unittest.main(verbosity=2)
