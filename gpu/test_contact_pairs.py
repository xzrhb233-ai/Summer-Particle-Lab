import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver
ROOT=Path(__file__).resolve().parent.parent
def fixture(flag):
    return json.loads(subprocess.check_output(['node','tests/gpu-pair-fixtures.mjs',flag],cwd=ROOT,text=True,encoding='utf-8'))
class PairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixture('--pair-projects');cls.report={}
    @classmethod
    def tearDownClass(cls):
        cls.s.close()
        (ROOT/'artifacts/gpu-contact-pairs-validation.json').write_text(json.dumps(dict(backend=cls.backend,cases=cls.report),indent=2),encoding='utf-8')
    def test_01_independent_thermal_interfaces(self):
        s=self.s;s.initialize(self.projects['heat'])
        for _ in range(48):s.thermal.step(1/480,False)
        s.last_duration=.1;f,p=s.snapshot();cpu=fixture('--pair-cpu')
        np.testing.assert_allclose(p[:,4],np.array(list(cpu['particles'].values())).reshape(-1,8)[:,4],atol=3e-5,rtol=0)
        a,b=f['contactPairs'];self.assertLess(a['heat'],0);self.assertEqual(b['heat'],0)
        self.assertAlmostEqual(a['heat'],cpu['contactPairs'][0]['heat'],delta=.002)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-6)
        self.report['thermal']=dict(coupling=f['coupling'],pairs=f['contactPairs'])
    def test_02_shared_node_isolation_and_momentum(self):
        s=self.s;f,p=s.initialize(self.projects['mechanical'])
        mass=s.s.mass.to_numpy()[:s.s.count];initial=mass.sum(dtype=float)*np.array([-.3,0,.2])
        f,p=s.step(1/480);velocity=s.s.v.to_numpy()[:s.s.count]*.025
        momentum=np.sum(mass[:,None]*velocity,axis=0)+2*np.array(f['bodies'][0]['velocity'])
        np.testing.assert_allclose(momentum,initial,atol=2e-6,rtol=0)
        np.testing.assert_allclose(velocity[8:],np.tile([-.3,0,.2],(8,1)),atol=2e-6,rtol=0)
        a,b=f['contactPairs'];self.assertGreater(a['normalForce'],0);self.assertGreater(np.linalg.norm(a['tangentialForce']),0)
        self.assertEqual(b['normalForce'],0);self.assertEqual(b['samples'],0);self.assertEqual(b['maxPenetration'],0)
        np.testing.assert_allclose(2*np.array(f['bodies'][0]['velocity']),np.array(a['force'])/480,atol=1e-6)
        self.report['sharedNodes']=dict(momentumError=(momentum-initial).tolist(),pairs=f['contactPairs'])
    def test_03_pbf_pair_control(self):
        s=self.s;s.initialize(self.projects['fluid'])
        for _ in range(12):f,p=s.step(1/480)
        self.assertTrue(np.isfinite(p).all());self.assertGreater(f['contactPairs'][0]['normalForce'],0)
        self.assertEqual(f['contactPairs'][1]['normalForce'],0)
        self.report['fluid']=f['contactPairs']
    def test_04_press_slide_release(self):
        s=self.s;s.initialize(self.projects['demo']);peak_force=0.;peak_slip=0.;peak_penetration=0.;milestones={}
        for k in range(180):
            f,p=s.step(1/60);self.assertTrue(np.isfinite(p).all())
            a=f['contactPairs'][0];peak_force=max(peak_force,a['normalForce']);peak_slip=max(peak_slip,a['slipSpeed']);peak_penetration=max(peak_penetration,a['maxPenetration'])
            if k+1 in [36,60,114,132,180]:milestones[str(k+1)]=dict(time=f['time'],pairs=f['contactPairs'],coupling=f['coupling'],bodies=f['bodies'],joints=f['joints'])
        self.report['demo']=dict(peakForce=peak_force,peakSlip=peak_slip,peakPenetration=peak_penetration,milestones=milestones)
        self.assertGreater(peak_force,1);self.assertGreater(peak_slip,.01)
        self.assertLess(f['contactPairs'][0]['heat'],1e-8);self.assertEqual(f['contactPairs'][0]['samples'],0)
        self.assertGreater(f['coupling']['maxTemperature'],21)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-4)
if __name__=='__main__':unittest.main(verbosity=2)
