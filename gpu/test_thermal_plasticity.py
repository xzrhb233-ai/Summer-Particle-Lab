import json,subprocess,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from solver import Solver
from thermal_plasticity import parameters,DEFAULTS

@ti.kernel
def return_one(s:ti.template()):
    s.F[0]=s.project(0,s.F[0],.01)

class ThermalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize();cls.s=Solver()
    def setUp(self):self.s.reset('empty');self.s.settings.update(thermal=False,gravity=False,gravityMode='scene',stiffness=1)
    def test_cpu_cuda_temperature_return_agreement(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('thermal_reference.mjs'))],text=True))
        s=self.s;s.box([-4,0,-4],[4,8,4],model=10)
        for c in cases:
            s.model[0]=c['model'];s.F[0]=np.array(c['F']).reshape(3,3);s.plastic[0]=c['ep'];s.temp[0]=c['T'];s.thermal_materials[1]=parameters(c['p'])
            return_one(s);s.prepare(1,1)
            np.testing.assert_allclose(s.F[0].to_numpy(),np.array(c['expected']).reshape(3,3),atol=4e-6,rtol=5e-5)
            self.assertAlmostEqual(s.plastic[0],c['plastic'],places=5);self.assertAlmostEqual(s.stress[0],c['vm'],places=5)
    def test_brush_temperature_history_and_parameter_lifetime(self):
        s=self.s
        for bad in [dict(Thot=20),dict(Q=-1),dict(rate=float('nan')),dict(n=True)]:
            self.assertIsNone(parameters(bad));self.assertFalse(s.box([-4,0,-4],[4,8,4],model=11,thermalMaterial=bad));self.assertEqual(s.count,0)
        for model in [10,11]:
            s.reset('empty');s.box([-4,0,-4],[4,8,4],model=model,thermalMaterial=dict(Q=40000))
            F=np.array([[1,.05,0],[0,1,0],[0,0,1]],np.float32);s.F[0]=F;return_one(s);cold=s.plastic[0]
            for _ in range(20):s.command(dict(type='brush',tool='heat',point=[-4,0,-4],radius=1))
            self.assertGreater(s.temp[0],180);s.F[0]=F;return_one(s);hot=s.plastic[0];self.assertGreater(hot-cold,2*cold)
            for _ in range(20):s.command(dict(type='brush',tool='cool',point=[-4,0,-4],radius=1))
            self.assertAlmostEqual(s.temp[0],20,places=4);self.assertAlmostEqual(s.plastic[0],hot)
            s.F[0]=F;return_one(s);self.assertLess(s.plastic[0]-hot,hot-cold)
            meta,data=s.snapshot();self.assertEqual(meta['models'][model],27);self.assertEqual(len(meta['models']),12);self.assertEqual(data[0,3],11+model)
        s.box([20,0,-4],[28,8,4],model=10,thermalMaterial=dict(Q=10000));s.command(dict(type='brush',tool='erase',point=[-4,0,-4],radius=1))
        self.assertEqual(s.lab.part[0],2);self.assertEqual(s.thermal_materials[2][6],10000)
        s.reset('empty');np.testing.assert_allclose(s.thermal_materials[2].to_numpy(),list(DEFAULTS.values()))
    def test_contact_heat_updates_temperature_conservatively(self):
        s=self.s;s.settings.update(thermal=True,heatRate=100)
        s.box([-4,0,-4],[4,8,4],model=10,temperature=180)
        s.box([8,0,-4],[16,8,4],model=11,temperature=20);s.pinned.fill(1)
        before=s.snapshot()[0]
        for _ in range(10):s.step()
        self.assertLess(s.temp.to_numpy()[:27].mean(),180);self.assertGreater(s.temp.to_numpy()[27:54].mean(),20)
        self.assertAlmostEqual(s.snapshot()[0]['energy'],before['energy'],places=4)
    def test_hot_cold_compression(self):
        s=self.s;s.reset('thermomech');s.settings['thermal']=True;before=s.snapshot()[0]
        self.assertEqual(before['models'][10:],[1078,1078]);s.set_press(dict(target=-20,speed=16))
        for _ in range(120):s.step()
        after=s.snapshot()[0];self.assertGreater(after['maxPlastic'],0);self.assertGreater(after['minJ'],0)
        self.assertAlmostEqual(after['mass'],before['mass'],places=5);self.assertAlmostEqual(after['energy'],before['energy'],places=3)

if __name__=='__main__':unittest.main(verbosity=2)
