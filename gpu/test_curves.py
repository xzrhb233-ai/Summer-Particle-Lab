import copy
import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver

ROOT=Path(__file__).resolve().parent.parent
def fixture(flag):
    return json.loads(subprocess.check_output(['node','tests/gpu-curve-fixtures.mjs',flag],cwd=ROOT,text=True,encoding='utf-8'))

class CurveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixture('--curve-projects');cls.report={}
    @classmethod
    def tearDownClass(cls):
        cls.s.close()
        (ROOT/'artifacts/gpu-curves-validation.json').write_text(json.dumps(dict(backend=cls.backend,cases=cls.report),indent=2),encoding='utf-8')
    def test_01_short_force_pulse_cpu_contact_path(self):
        s=self.s;s.initialize(self.projects['pulse']);self.assertFalse(s.native)
        f,_=s.step(1/60)
        self.assertAlmostEqual(f['bodies'][0]['velocity'][0],.2,delta=2e-6)
        self.assertAlmostEqual(f['loadResponses'][0]['commandIntegral'],.4,delta=1e-9)
        for _ in range(5):f,_=s.step(1/60)
        self.assertAlmostEqual(f['bodies'][0]['velocity'][0],.2,delta=2e-6)
        self.report['shortForcePulse']=dict(time=f['time'],velocity=f['bodies'][0]['velocity'],loads=f['loadResponses'])
    def test_02_gpu_heat_integral_and_cpu_agreement(self):
        s=self.s;s.initialize(self.projects['heat']);self.assertTrue(s.native)
        f,p=s.step(1/60);cpu=fixture('--curve-cpu')
        self.assertAlmostEqual(f['coupling']['externalHeat'],6502,delta=1e-6)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-6)
        self.assertAlmostEqual(f['coupling']['meanTemperature'],cpu['coupling']['meanTemperature'],delta=2e-5)
        self.assertAlmostEqual(f['bodies'][0]['velocity'][0],.2,delta=2e-6)
        for r in f['loadResponses']:
            c=next(c for c in cpu['loadResponses'] if c['id']==r['id'])
            self.assertAlmostEqual(r['commandIntegral'],c['commandIntegral'],delta=1e-6)
            self.assertAlmostEqual(r['response'],c['response'],delta=2e-5)
        s.command(dict(type='region-heat',value=dict(power=-1000)))
        g,q=s.snapshot();self.assertEqual(g['time'],f['time']);np.testing.assert_array_equal(p,q)
        self.assertEqual({r['id'] for r in g['loadResponses']},{'force','body-heat'})
        g,_=s.step(1/60);self.assertAlmostEqual(g['coupling']['externalHeat'],6502-1000/60,delta=1e-6)
        self.report['heatPulse']=dict(cpu=cpu['coupling'],gpu=f['coupling'],loads=f['loadResponses'],manualOverride=g['coupling'])
    def test_03_full_staged_heat_twist_unload_cool(self):
        s=self.s;s.initialize(self.projects['staged']);milestones={}
        for k in range(210):
            f,p=s.step(1/60);self.assertTrue(np.isfinite(p).all())
            if k+1 in [60,126,150,210]:
                milestones[str(k+1)]=dict(time=f['time'],coupling=f['coupling'],loads=f['loadResponses'])
        hot=milestones['60']['coupling']['meanTemperature']
        self.assertGreater(hot,25);self.assertLess(f['coupling']['meanTemperature'],hot-5)
        peak=next(r for r in milestones['126']['loads'] if r['kind']=='motor-target')
        end=next(r for r in f['loadResponses'] if r['kind']=='motor-target')
        self.assertGreater(peak['response'],.35);self.assertLess(abs(end['response']),.03)
        self.assertEqual(end['requested'],0);self.assertLess(abs(f['coupling']['externalHeat']),1e-4)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-4)
        self.assertEqual(f['coupling']['liquids'],0)
        self.report['staged']=milestones

if __name__=='__main__':unittest.main(verbosity=2)
