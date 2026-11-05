import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver
ROOT=Path(__file__).resolve().parent.parent
def fixture(flag):
    return json.loads(subprocess.check_output(['node','tests/material-contact-fixtures.mjs',flag],cwd=ROOT,text=True,encoding='utf-8'))
class MaterialContactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixture('--projects');cls.cpu=fixture('--cpu');cls.report={}
    @classmethod
    def tearDownClass(cls):
        cls.s.close()
        name='gpu-material-contact-validation.json' if len(sys.argv)==1 else 'gpu-material-contact-partial.json'
        (ROOT/'artifacts'/name).write_text(json.dumps(dict(backend=cls.backend,cases=cls.report),indent=2),encoding='utf-8')
    def velocities(self):
        return self.s.s.v.to_numpy()[:self.s.s.count]*.025
    def angular_momentum(self):
        s=self.s.s;n=s.count;mass=s.mass.to_numpy()[:n];x=s.x.to_numpy()[:n]*.025;v=self.velocities();C=s.C.to_numpy()[:n]
        spin=np.stack([C[:,2,1]-C[:,1,2],C[:,0,2]-C[:,2,0],C[:,1,0]-C[:,0,1]],axis=1)
        return np.sum(mass[:,None]*(np.cross(x,v)+(float(s.mpm_h[None])*.025)**2/4*spin),axis=0,dtype=float)
    def test_01_disabled_contact_and_fixed_grid_isolation(self):
        for fixed in [False,True]:
            p=copy.deepcopy(self.projects['fixed'] if fixed else self.projects['disabled'])
            p['contactPairs'][0]['mechanical']=False
            self.s.initialize(p);before=self.velocities().copy()
            for _ in range(8):f,data=self.s.step(1/480)
            np.testing.assert_allclose(self.velocities(),before,atol=2e-6,rtol=0)
            self.assertEqual(f['contactPairs'][0]['normalForce'],0)
    def test_02_collision_friction_and_cpu_alignment(self):
        for name in ['collision','friction']:
            s=self.s;s.initialize(self.projects[name]);mass=s.s.mass.to_numpy()[:s.s.count]
            initial=np.sum(mass[:,None]*self.velocities(),axis=0,dtype=float);angular=self.angular_momentum();peak=0.;peak_tangent=0.
            for _ in range(24):
                f,data=s.step(1/480);pair=f['contactPairs'][0]
                peak=max(peak,pair['normalForce']);peak_tangent=max(peak_tangent,np.linalg.norm(pair['tangentialForce']))
                self.assertTrue(np.isfinite(data).all())
                np.testing.assert_allclose(np.sum(mass[:,None]*self.velocities(),axis=0,dtype=float),initial,atol=3e-5,rtol=0)
            self.assertGreater(peak,1)
            np.testing.assert_allclose(self.angular_momentum(),angular,rtol=0,atol=3e-5)
            if name=='friction':self.assertGreater(peak_tangent,1)
            else:self.assertLess(peak_tangent,1e-7)
            expected=np.array(self.cpu[name]['final']['velocities']).reshape(-1,3)
            difference=float(np.max(np.abs(self.velocities()-expected)))
            self.assertLess(difference,.003)
            self.report[name]=dict(peakNormalForce=peak,peakTangentForce=peak_tangent,velocityMaxDifference=difference,finalPair=pair)
    def test_03_interface_heat_and_reverse_orientation(self):
        for reverse in [False,True]:
            p=copy.deepcopy(self.projects['thermal'])
            if reverse:p['contactPairs'][0]['a'],p['contactPairs'][0]['b']='b','a'
            s=self.s;s.initialize(p)
            for _ in range(24):s.thermal.step(1/480,False)
            s.last_duration=.05;f,data=s.snapshot();pair=f['contactPairs'][0]
            expected=self.cpu['thermal']['pair']['heat']*(-1 if reverse else 1)
            self.assertAlmostEqual(pair['heat'],expected,delta=.03)
            self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
            self.report['thermal-reversed' if reverse else 'thermal']=dict(pair=pair,coupling=f['coupling'])
        p=copy.deepcopy(self.projects['thermal']);p['contactPairs'][0]['thermal']=False;p['couplings'][0]['thermal']=True
        s.initialize(p);before=s.s.enthalpy.to_numpy()[:s.s.count].copy()
        for _ in range(24):s.thermal.step(1/480,False)
        np.testing.assert_allclose(s.s.enthalpy.to_numpy()[:s.s.count],before,rtol=0,atol=1e-7)
    def test_04_separation_and_true_gap(self):
        for separating in [True,False]:
            p=copy.deepcopy(self.projects['collision'])
            if separating:
                for part in p['parts']:part['initial']['velocity']=[-x for x in part['initial']['velocity']]
            else:
                p['parts'][0]['geometry']['center'][0]=-.13;p['parts'][1]['geometry']['center'][0]=.13
            self.s.initialize(p);f,data=self.s.step(1/480)
            self.assertAlmostEqual(f['contactPairs'][0]['normalForce'],0,delta=1e-5)
    def test_05_hot_block_demo(self):
        s=self.s;s.initialize(self.projects['demo']);peak=0.;depth=0.;trace=[]
        for k in range(180):
            f,data=s.step(1/60);pair=f['contactPairs'][0]
            self.assertTrue(np.isfinite(data).all())
            peak=max(peak,pair['normalForce']);depth=max(depth,pair['maxPenetration'])
            if (k+1)%30==0:trace.append(dict(time=f['time'],pair=pair,coupling=f['coupling']))
        self.report['demo']=dict(peakNormalForce=peak,maxPenetration=depth,trace=trace)
        self.assertGreater(peak,1)
        self.assertLess(f['contactPairs'][0]['accumulatedHeat'],-1)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-4)
        self.assertLess(depth,.01)
        self.assertTrue(any(t['pair']['accumulatedHeat']< -1 and t['pair']['normalForce']==0 and t['pair']['heat']==0 for t in trace))
    def test_06_regions_next_to_another_fixed_material(self):
        self.s.initialize(self.projects['attached'])
        for _ in range(24):f,data=self.s.step(1/480)
        self.assertLess(f['maxError'],.002)
        region=next(j for j in f['joints'] if j['id']=='right-grip')
        self.assertEqual(region['state'],'active')
        self.assertGreater(np.linalg.norm(region['torque']),.01)
        self.assertEqual(f['contactPairs'][0]['normalForce'],0)
if __name__=='__main__':unittest.main(verbosity=2)
