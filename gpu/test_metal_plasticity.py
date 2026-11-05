import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from solver import Solver
from metal_plasticity import parameters,DEFAULTS

@ti.kernel
def return_one(s:ti.template(),dt:ti.f32):
    s.F[0]=s.project(0,s.F[0],dt)

class MetalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize();cls.s=Solver()

    def setUp(self):
        self.s.reset('empty');self.s.settings.update(gravity=False,gravityMode='scene',thermal=False,stiffness=1)

    def test_cpu_gpu_return_and_stress_agreement(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('metal_reference.mjs'))],text=True))
        self.s.box([-4,0,-4],[4,8,4],model=4)
        for c in cases:
            self.s.model[0]=c['model'];self.s.temp[0]=c['temp'];self.s.plastic[0]=c['ep']
            self.s.plasticity[1]=parameters(c['p']);self.s.F[0]=np.array(c['F']).reshape(3,3)
            return_one(self.s,c['dt'])
            actual=self.s.F[0].to_numpy()
            np.testing.assert_allclose(actual,np.array(c['expected']).reshape(3,3),atol=4e-6,rtol=4e-5)
            self.assertAlmostEqual(self.s.plastic[0],c['plastic'],places=5)
            self.assertAlmostEqual(np.linalg.det(actual),1,places=5)
            self.s.prepare(1,1)
            E=self.s.mass[0]/(64*self.s.volume[0])*16000
            np.testing.assert_allclose(self.s.tau[0].to_numpy()/E,np.array(c['tau']).reshape(3,3),atol=3e-6,rtol=5e-4)

    def test_parameter_validation_and_part_lifetime(self):
        for p in [dict(A=float('nan')),dict(B=-1),dict(n=0),dict(rate0=0),dict(Tm=20),dict(A=True),dict(typo=1),[]]:
            self.assertIsNone(parameters(p))
            self.assertFalse(self.s.box([-4,0,-4],[4,8,4],model=6,plasticity=p))
        self.assertEqual(self.s.count,0);self.assertEqual(self.s.lab.next_id,1)
        self.assertTrue(self.s.box([-4,0,-4],[4,8,4],model=6,plasticity=dict(A=.1,B=.2)))
        self.assertTrue(self.s.box([20,0,-4],[28,8,4],model=7,plasticity=dict(A=.01)))
        self.s.command(dict(type='brush',tool='erase',point=[-4,0,-4],radius=1))
        self.assertEqual(self.s.model[0],7);self.assertEqual(self.s.lab.part[0],2)
        self.assertAlmostEqual(self.s.plasticity[2][0],.01)
        meta,data=self.s.snapshot();self.assertEqual(meta['models'][6:8],[26,27]);self.assertEqual(data[0,3],18)
        self.s.reset('empty');np.testing.assert_allclose(self.s.plasticity[2].to_numpy(),list(DEFAULTS.values()))

    def test_metal_compression_preserves_mass_and_energy(self):
        self.s.reset('metals');before=self.s.snapshot()[0]
        self.assertEqual(before['models'],[0,0,0,0,539,539,539,539,0,0,0,0])
        self.s.set_press(dict(target=-20,speed=16))
        for _ in range(150):self.s.step()
        after=self.s.snapshot()[0]
        self.assertGreater(after['minJ'],0);self.assertGreater(after['maxPlastic'],0)
        self.assertAlmostEqual(after['mass'],before['mass'],places=5)
        self.assertAlmostEqual(after['energy'],before['energy'],places=4)

if __name__=='__main__':unittest.main()
