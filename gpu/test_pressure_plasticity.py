import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from solver import Solver
from pressure_plasticity import parameters,DEFAULTS

@ti.kernel
def return_one(s:ti.template()):
    s.F[0]=s.project(0,s.F[0],.01)

class PressureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize();cls.s=Solver()
    def setUp(self):self.s.reset('empty');self.s.settings.update(thermal=False,gravity=False,gravityMode='scene',stiffness=1)
    def test_cpu_cuda_return_stress_and_volume_agreement(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('pressure_reference.mjs'))],text=True))
        s=self.s;s.box([-4,0,-4],[4,8,4],model=8)
        for c in cases:
            s.model[0]=c['model'];s.F[0]=np.array(c['F']).reshape(3,3);s.jp[0]=c['jp'];s.plastic[0]=c['ep'];s.pressure_materials[1]=parameters(c['p'])
            return_one(s);s.prepare(1,1)
            np.testing.assert_allclose(s.F[0].to_numpy(),np.array(c['expected']).reshape(3,3),atol=4e-6,rtol=5e-5)
            self.assertAlmostEqual(s.jp[0],c['newJp'],places=5);self.assertAlmostEqual(s.plastic[0],c['plastic'],places=5);self.assertAlmostEqual(s.stress[0],c['vm'],places=5)
            self.assertAlmostEqual(np.linalg.det(s.F[0].to_numpy())*s.jp[0],np.linalg.det(np.array(c['F']).reshape(3,3))*c['jp'],places=5)
    def test_validation_lifetime_and_packet(self):
        s=self.s
        for p in [dict(alpha=0),dict(epsD=0),dict(dilatancy=1),dict(tension=.2),dict(cohesion=True)]:
            self.assertIsNone(parameters(p));self.assertFalse(s.box([-4,0,-4],[4,8,4],model=9,pressure=p));self.assertEqual(s.count,0)
        s.box([-4,0,-4],[4,8,4],model=8,pressure=dict(slope=.4))
        s.box([20,0,-4],[28,8,4],model=9,pressure=dict(alpha=2))
        s.command(dict(type='brush',tool='erase',point=[-4,0,-4],radius=1))
        self.assertEqual(s.lab.part[0],2);self.assertAlmostEqual(s.pressure_materials[2][4],2)
        meta,data=s.snapshot();self.assertEqual(meta['models'][8:10],[26,27]);self.assertEqual(data[0,3],20)
        s.reset('empty');np.testing.assert_allclose(s.pressure_materials[2].to_numpy(),list(DEFAULTS.values()))

    def test_compression_scene(self):
        s=self.s;s.reset('porous');before=s.snapshot()[0]
        self.assertEqual(before['models'],[0,0,0,0,0,0,0,0,1078,1078,0,0]);s.set_press(dict(target=-20,speed=16))
        for k in range(150):s.step()
        after=s.snapshot()[0];self.assertGreater(after['minJ'],0);self.assertGreater(after['maxPlastic'],0)
        self.assertAlmostEqual(after['mass'],before['mass'],places=5);self.assertAlmostEqual(after['energy'],before['energy'],places=4)
        self.assertTrue(np.any(s.jp.to_numpy()[1078:s.count]<.99))

if __name__=='__main__':unittest.main(verbosity=2)
