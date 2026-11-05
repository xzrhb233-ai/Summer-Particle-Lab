"""CUDA acceptance tests for self-gravity, the planet, and actual million capacity."""
import json
import time
import unittest
import numpy as np
from runtime import initialize
from solver import Solver, CAPACITY, PREVIEW_LIMIT


class PlanetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize()
        cls.s=Solver()

    def test_a_fixed_body_keeps_gravitational_reaction(self):
        s=self.s;s.reset("planet")
        rows=np.array([[-20,0,0,2,0,417600,1,.025,35],[20,0,0,2,0,417600,0,.025,35]],np.float32)
        s.insert(0,rows);s.count=2;s.gravity.build(s)
        s.forces(2,.01,2,0,[0,0,0])
        self.assertEqual(s.v[0].norm(),0)
        self.assertLess(s.v[1][0],0)
        self.assertAlmostEqual(s.v[1][0],-.01*2*40/(40**2+64)**1.5,places=8)

    def test_a_tree_against_direct_forces(self):
        s=self.s;s.reset("empty")
        rng=np.random.default_rng(12)
        points=rng.uniform(-58,58,(256,3)).astype(np.float32)
        rows=np.zeros((len(points),9),np.float32);rows[:,:3]=points
        rows[:,3:]=[2,0,417600,0,.025,35]
        s.insert(0,rows);s.count=len(rows);s.gravity.build(s)
        got=s.gravity.acceleration.to_numpy()[:s.count]
        d=points[None,:,:]-points[:,None,:]
        expected=np.sum(2*d/(np.sum(d*d,axis=2)+64)[:,:,None]**1.5,axis=1)
        error=np.linalg.norm(got-expected)/np.linalg.norm(expected)
        print("gravity RMS relative error",float(error),flush=True)
        self.assertLess(error,.04)
        # Translation changes the spatial tree but not the physical force.
        rows[:,:3]+=np.array([44,53,-12]);s.insert(0,rows);s.gravity.build(s)
        shifted=s.gravity.acceleration.to_numpy()[:s.count]
        self.assertLess(np.linalg.norm(shifted-expected)/np.linalg.norm(expected),.04)
        s.count=1;s.gravity.build(s)
        np.testing.assert_array_equal(s.gravity.acceleration[0].to_numpy(),[0,0,0])

    def test_b_planet_stability(self):
        s=self.s;s.settings.update(gravity=True,thermal=True);s.reset("planet")
        initial,points=s.snapshot()
        self.assertEqual(s.count,20000);self.assertEqual(initial["liquids"],20000)
        self.assertEqual(initial["solids"],0);self.assertEqual(initial["renderCount"],20000)
        np.testing.assert_allclose(points[:,:3].mean(axis=0),0,atol=1e-6)
        radius=np.linalg.norm(points[:,:3],axis=1).max()
        timings=[]
        for frame in range(180):
            t=time.perf_counter();s.step();timings.append((time.perf_counter()-t)*1000)
        result,points=s.snapshot()
        self.assertEqual(result["count"],20000)
        self.assertEqual(result["mass"],initial["mass"])
        self.assertEqual(result["energy"],initial["energy"])
        self.assertTrue(result["selfGravity"])
        self.assertGreater(s.time,2.99)
        self.assertLess(np.linalg.norm(points[:,:3].mean(axis=0)),.05)
        radii=np.linalg.norm(points[:,:3],axis=1)
        self.assertLess(radii.max(),radius*1.2)
        self.assertGreater(radii.max(),radius*.7)
        print(json.dumps(dict(scene="planet",count=s.count,meanMs=np.mean(timings[10:]),
                              radius=float(radii.max()),center=points[:,:3].mean(axis=0).tolist(),profile=s.profile)),flush=True)
        # Disable gravity: scene remains a free-space PBF fluid, not downward gravity.
        s.settings["gravity"]=False;s.step();self.assertEqual(s.profile["gravity"],0)

    def test_c_actual_million(self):
        s=self.s;s.settings.update(gravity=False,thermal=False);s.reset("million")
        self.assertEqual(s.count,CAPACITY);self.assertEqual(CAPACITY,1_000_000)
        self.assertFalse(s.box([0,0,0],[4,4,4],2));self.assertEqual(s.count,CAPACITY)
        times=[]
        for _ in range(3):
            t=time.perf_counter();s.step();times.append((time.perf_counter()-t)*1000)
        t=time.perf_counter();result,data=s.snapshot();snapshot_ms=(time.perf_counter()-t)*1000
        self.assertEqual(result["count"],1_000_000)
        self.assertEqual(result["liquids"],1_000_000)
        self.assertEqual(result["mass"],1_000_000)
        self.assertEqual(result["solids"],0)
        self.assertEqual(result["sampleStride"],10)
        self.assertEqual(data.shape,(PREVIEW_LIMIT,8))
        self.assertTrue(np.isfinite(data).all())
        self.assertGreater(s.time,.049)
        print(json.dumps(dict(scene="million",count=s.count,stepMs=times,preview=len(data),
                              bytes=data.nbytes,snapshotMs=snapshot_ms,profile=s.profile)),flush=True)
        s.x[3]=[float("nan"),0,0]
        with self.assertRaisesRegex(RuntimeError,"Non-finite"):
            s.snapshot()
        s.reset("planet");self.assertEqual(s.count,20000)


if __name__=="__main__":
    unittest.main(verbosity=2)
