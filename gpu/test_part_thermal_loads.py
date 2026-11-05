import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver
ROOT=Path(__file__).resolve().parent.parent
def fixture(flag):
    return json.loads(subprocess.check_output(['node','tests/gpu-part-thermal-fixtures.mjs',flag],cwd=ROOT,text=True,encoding='utf-8'))
class PartThermalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixture('--projects');cls.cpu=fixture('--cpu');cls.report={}
    @classmethod
    def tearDownClass(cls):
        cls.s.close();(ROOT/'artifacts/gpu-part-thermal-validation.json').write_text(json.dumps(dict(backend=cls.backend,cases=cls.report),indent=2),encoding='utf-8')
    def test_shared_boundaries_cpu_gpu_and_real_step(self):
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        for name,p in self.projects.items():
            with self.subTest(name=name):
                s=self.s;s.initialize(p);s.thermal.step(.2,True);f,a=s.snapshot();cpu=self.cpu[name]
                np.testing.assert_allclose(a[:,4],cpu['temperature'],atol=3e-5,rtol=1e-6)
                np.testing.assert_allclose(s.s.enthalpy.to_numpy()[:s.s.count],cpu['enthalpy'],atol=.02,rtol=1e-6)
                np.testing.assert_allclose([b['temperature'] for b in f['bodies']],cpu['bodies'],atol=1e-5)
                self.assertAlmostEqual(f['thermalLoads'][0]['heat'],cpu['loads'][0]['heat'],delta=.1)
                self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
                # Isolated heat integration above intentionally bypasses the
                # mechanical phase-list update. Test the real driver afresh,
                # including its next step after a freeze/melt transition.
                s.initialize(p)
                for _ in range(2):f,a=s.step(1/480)
                self.assertTrue(np.isfinite(a).all());self.assertGreater(f['time'],0)
                if name=='water':self.assertTrue(np.any(a[:,3]==4))
                self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
                self.report[name]=dict(time=f['time'],minTemperature=float(a[:,4].min()),maxTemperature=float(a[:,4].max()),loads=f['thermalLoads'],balance=f['coupling'])
if __name__=='__main__':unittest.main(verbosity=2)
