import copy
import unittest
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver
from benchmark_project import bicycle_project
from benchmark_climb import project as climb_project

class ProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.project=bicycle_project()
    @classmethod
    def tearDownClass(cls):cls.s.close()

    def test_actual_gpu_two_way_impact_and_native_fixed_face(self):
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        initial,data=self.s.initialize(self.project);pins=data[:,5]>.5;fixed=data[pins,:3].copy();self.assertEqual(pins.sum(),48)
        peak=0;first=None
        while self.s.time<3-1e-8:
            f,p=self.s.step(min(1/60,3-self.s.time));wheel=next(b for b in f['bodies'] if b['id']=='front-wheel');force=np.linalg.norm(wheel['contactForce']);peak=max(peak,force)
            if first is None and force>1:first=self.s.time
            self.assertLess(f['maxError'],.002)
        self.assertGreater(first,2.);self.assertLess(first,2.6);self.assertGreater(peak,100)
        self.assertGreater(wheel['displacement'][0],1.6);self.assertLess(wheel['displacement'][0],2.1);self.assertLess(abs(wheel['velocity'][0]),.3)
        self.assertGreater(np.max(np.abs(p[:,0]-data[:,0])),.1);np.testing.assert_array_equal(p[pins,:3],fixed)
        self.assertTrue(np.isfinite(p).all());self.assertLess(abs(f['coupling']['thermalResidual']),.001)
        self.assertLess(f['coupling']['maxPenetration'],.03)

    def test_rejected_project_preserves_running_gpu_state(self):
        self.s.initialize(self.project);before,points=self.s.step(.01)
        for change in ('heat','overlap','count'):
            p=copy.deepcopy(self.project)
            if change=='heat':p['loads'].append(dict(id='bad-heat',type='body-heat',target=p['parts'][0]['id'],power=1e20))
            if change=='overlap':next(b for b in p['parts'] if b['method']=='mpm')['geometry']['center']=[0,1,0]
            if change=='count':next(b for b in p['parts'] if b['method']=='mpm')['geometry']['size']=[1,3,3]
            with self.assertRaises(ValueError):self.s.initialize(p)
            after,a=self.s.snapshot();self.assertEqual(before['time'],after['time']);np.testing.assert_array_equal(points,a)

    def test_front_drive_climbs_fallen_mpm_wall_with_free_pitch(self):
        initial,points=self.s.initialize(climb_project());pins=points[:,5]>.5;fixed=points[pins,:3].copy()
        max_front=max_rear=max_pitch=0.
        while self.s.time<6-1e-8:
            f,a=self.s.step(min(1/60,6-self.s.time));front=next(b for b in f['bodies'] if b['id']=='front-wheel');rear=next(b for b in f['bodies'] if b['id']=='rear-wheel');body=next(b for b in f['bodies'] if b['id']=='bike-frame')
            max_front=max(max_front,front['position'][1]);max_rear=max(max_rear,rear['position'][1]);max_pitch=max(max_pitch,abs(2*np.arctan2(body['rotation'][2],body['rotation'][3])))
            drive=next(j for j in f['joints'] if j['id']=='front-drive')
            self.assertLessEqual(abs(drive['transmittedTorque']),40+1e-6)
            self.assertLess(f['maxError'],.002);self.assertLess(abs(body['position'][2]),.001)
            self.assertTrue(np.isfinite(a).all())
        self.assertGreater(max_front,1.1);self.assertGreater(max_rear,.95);self.assertGreater(max_pitch,.2)
        self.assertGreater(front['position'][0],5.5);self.assertLess(float(a[:,1].max()),1.2)
        np.testing.assert_array_equal(a[pins,:3],fixed)

    def test_disabling_mechanical_coupling_removes_reaction(self):
        p=copy.deepcopy(self.project);p['couplings'][0]['mechanical']=False
        # A near wall is crossed in this interval; no contact impulse may appear.
        next(b for b in p['parts'] if b['method']=='mpm')['geometry']['center']=[2.4,1.2,0]
        self.s.initialize(p);peak=0
        while self.s.time<1.6-1e-8:
            f,_=self.s.step(min(1/60,1.6-self.s.time));wheel=next(b for b in f['bodies'] if b['id']=='front-wheel');peak=max(peak,np.linalg.norm(wheel['contactForce']))
        self.assertEqual(peak,0);self.assertGreater(wheel['displacement'][0],.8);self.assertGreater(wheel['velocity'][0],.8)

if __name__=='__main__':unittest.main()
