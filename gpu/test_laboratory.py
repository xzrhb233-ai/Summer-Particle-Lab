import unittest
import numpy as np
from solver import Solver
from runtime import initialize
from run_control import RunControl

class LaboratoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize();cls.s=Solver()
    def setUp(self):self.s.reset('empty');self.s.settings.update(gravity=False,thermal=False,timeStepScale=1,pbfIterations=3)
    def test_shapes_ids_and_deletion(self):
        s=self.s
        for shape in ('box','ellipsoid','cylinder'):self.assertTrue(s.box([-8,0,-8],[8,16,8],shape=shape,name=shape))
        parts=s.lab.snapshot();self.assertEqual(len(parts),3);self.assertEqual(parts[0]['count'],125);self.assertLess(parts[1]['count'],parts[2]['count']);self.assertLess(parts[2]['count'],125)
        s.command(dict(type='brush',tool='erase',point=[-8,0,-8],radius=1))
        self.assertEqual(s.lab.part[0],3);self.assertEqual(s.lab.snapshot()[0]['count'],124)
        self.assertEqual(s.lab.snapshot()[2]['displacement'],0)
    def test_rigid_rotation_and_fixed_parts(self):
        s=self.s;s.box([-4,-4,-4],[4,4,4],2);s.box([20,-4,-4],[28,4,4],2)
        self.assertTrue(s.lab.command(dict(id=1,action='velocity',velocity=[3,0,0],angular=[0,0,.2])))
        parts=s.lab.snapshot();self.assertAlmostEqual(parts[0]['velocity'][0],3,places=5);self.assertEqual(parts[1]['kinetic'],0);self.assertGreater(parts[0]['kinetic'],.5*parts[0]['mass']*9)
        s.lab.command(dict(id=1,action='pin'));s.lab.command(dict(id=1,action='velocity',velocity=[10,0,0]));self.assertEqual(s.lab.snapshot()[0]['kinetic'],0)
        s.lab.command(dict(id=1,action='release'));self.assertEqual(s.lab.snapshot()[0]['pinned'],0)
    def test_exact_run_control(self):
        r=RunControl();self.assertTrue(r.start(.023,0));t=r.dt(0);r.advanced(t);r.pause(True,t);self.assertEqual(r.dt(t),0);r.pause(False,t);t+=r.dt(t);r.advanced(t)
        self.assertAlmostEqual(t,.023);self.assertTrue(r.paused);self.assertEqual(r.snapshot()['status'],'completed');self.assertTrue(r.single());self.assertEqual(r.dt(t),1/60);self.assertEqual(r.dt(t),0)
    def test_capacity_validation_and_solver_controls(self):
        s=self.s;self.assertFalse(s.box([0,0,0],[8,8,8],shape='bad'));self.assertEqual(s.count,0);self.assertEqual(s.lab.next_id,1)
        self.assertFalse(s.command(dict(type='geometry',a=[-100,0,0],b=[0,8,8]))['ok']);self.assertEqual(s.count,0)
        s.box([0,0,0],[8,8,8],2);s.command(dict(type='settings',value=dict(timeStepScale=.5,pbfIterations=5)));s.step();self.assertEqual(s.substeps,4)
        self.assertEqual(s.snapshot()[0]['parts'][0]['count'],27)

if __name__=='__main__':unittest.main(verbosity=2)
