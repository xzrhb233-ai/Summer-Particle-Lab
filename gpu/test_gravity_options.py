import unittest
import numpy as np
from runtime import initialize
from solver import Solver, GRAVITY_DEFAULTS, DIRECTIONS

class GravityOptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize();cls.s=Solver()

    def setUp(self):
        self.s.reset('empty');self.s.settings.update(GRAVITY_DEFAULTS);self.s.settings.update(gravity=True,thermal=False)

    def seed(self,point=[20,0,0],pin=0):
        self.s.insert(0,np.array([[*point,2,0,417600,pin,.025,35]],np.float32));self.s.count=1

    def force(self,**values):
        self.s.command(dict(type='settings',value=values));mode=self.s.configure_gravity()
        self.s.forces(self.s.count,.01,mode,0,[0,0,0])
        return self.s.v[0].to_numpy()

    def test_direction_strength_and_fixed(self):
        for name,direction in DIRECTIONS.items():
            self.seed();v=self.force(gravityMode='uniform',gravityDirection=name,gravityStrength=2)
            np.testing.assert_allclose(v,np.array(direction)*.48,atol=1e-6)
        self.seed(pin=1);np.testing.assert_array_equal(self.force(gravityMode='uniform'),[0,0,0])
        self.seed();np.testing.assert_array_equal(self.force(gravityStrength=0),[0,0,0])

    def test_center_repulsion_softening(self):
        self.seed();a=self.force(gravityMode='attract',gravityCenter=[10,0,0]);self.assertLess(a[0],0)
        self.seed();r=self.force(gravityMode='repel');np.testing.assert_allclose(r,-a,atol=1e-6)
        self.seed();gentle=self.force(gravityMode='attract',gravitySoftening=32);self.assertLess(abs(gentle[0]),abs(a[0]))
        self.seed([10,0,0]);np.testing.assert_array_equal(self.force(),[0,0,0])

    def test_self_on_any_scene_and_softening(self):
        s=self.s;self.seed();s.insert(1,np.array([[-20,0,0,2,0,417600,0,.025,35]],np.float32));s.count=2
        s.command(dict(type='settings',value=dict(gravityMode='self',gravitySoftening=16,gravityStrength=2)))
        s.gravity.build(s);s.configure_gravity();s.forces(2,.01,2,0,[0,0,0])
        self.assertAlmostEqual(s.v[0][0],-.01*4*40/(40**2+16**2)**1.5,places=8)
        np.testing.assert_allclose(s.v[0].to_numpy(),-s.v[1].to_numpy(),atol=1e-9)
        self.assertTrue(s.snapshot()[0]['selfGravity'])

    def test_validation_and_scene_defaults(self):
        s=self.s;s.command(dict(type='settings',value=dict(gravityMode='bogus',gravityDirection=[],gravityCenter=[float('nan'),0,0],gravityStrength=float('inf'))))
        self.assertEqual(s.settings['gravityMode'],'scene');self.assertEqual(s.settings['gravityStrength'],1)
        s.reset('million');self.assertEqual(s.gravity_mode(),'none')
        s.command(dict(type='settings',value=dict(gravityMode='uniform',gravityDirection='up')));self.assertEqual(s.gravity_mode(),'uniform')
        s.reset('planet');self.assertEqual(s.gravity_mode(),'uniform')
        s.command(dict(type='settings',value=dict(gravityMode='scene')));self.assertEqual(s.gravity_mode(),'self')

if __name__=='__main__':unittest.main(verbosity=2)
