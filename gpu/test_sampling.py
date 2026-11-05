import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from solver import Solver
from sampling import sampling_options

class SamplingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize();cls.s=Solver()

    def test_cpu_gpu_geometry_agreement_and_invariants(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('sampling_reference.mjs'))],text=True))
        s=self.s
        for c in cases:
            s.reset('empty');s.box([-8,0,-8],[8,16,8],shape=c['shape'],fixed=c['fixed'])
            before=s.snapshot()[0];base=s.x.to_numpy()[:s.count]
            s.reset('empty');s.box([-8,0,-8],[8,16,8],shape=c['shape'],fixed=c['fixed'],sampling=dict(enabled=True,strength=.35,seed=123))
            after=s.snapshot()[0];actual=s.x.to_numpy()[:s.count]
            np.testing.assert_allclose(actual,c['positions'],atol=2e-6,rtol=0)
            np.testing.assert_array_equal(s.pinned.to_numpy()[:s.count],c['pinned'])
            self.assertEqual(before['count'],after['count']);self.assertEqual(before['mass'],after['mass']);self.assertEqual(before['energy'],after['energy'])
            self.assertEqual(after['parts'][0]['displacement'],0)
            self.assertLessEqual(np.linalg.norm(actual-base,axis=1).max(),1.400002)
            delta=actual[:,None,:]-actual[None,:,:];dist=np.linalg.norm(delta,axis=2);np.fill_diagonal(dist,np.inf)
            self.assertGreater(dist.min(),1.19999)

    def test_protocol_validation_and_disabled_noise(self):
        s=self.s;s.reset('empty')
        for bad in [None,[],dict(enabled=1),dict(strength=float('nan')),dict(strength=.36),dict(seed=1.5),dict(seed=True),dict(seed=2147483648)]:
            self.assertIsNone(sampling_options(bad))
            self.assertFalse(s.command(dict(type='geometry',a=[0,0,0],b=[8,8,8],sampling=bad))['ok'])
            self.assertEqual(s.count,0)
        for setting in [{},dict(enabled=True,strength=0),dict(enabled=False,strength=.35)]:
            s.reset('empty');self.assertTrue(s.command(dict(type='box',a=[0,0,0],b=[8,8,8],sampling=setting))['ok'])
            self.assertEqual(s.count,8)
            np.testing.assert_array_equal((s.x.to_numpy()[:s.count]-2)%4,0)

if __name__=='__main__':unittest.main(verbosity=2)
