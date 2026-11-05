import json
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from solver import Solver
from materials import enthalpy_at

class SolidSamplingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize();cls.s=Solver()

    def setUp(self):
        self.s.reset('empty');self.s.settings.update(gravity=False,thermal=False,solidAntiClump=True)

    def seed(self,points):
        rows=np.array([[*p,11,10,enthalpy_at(11,20),0,.025,35] for p in points],np.float32)
        self.s.insert(0,rows);self.s.count=len(rows)

    def test_relaxation_preserves_velocity_mass_heat_and_histories(self):
        s=self.s;self.seed([[-.5,0,0],[.5,0,0]])
        s.mass[1]=3;s.inv_mass[1]=1/3;s.v[0]=[7,2,0];s.v[1]=[7,2,0];s.plastic[0]=.4
        center=float(s.mass[0])*s.x[0].to_numpy()+float(s.mass[1])*s.x[1].to_numpy()
        initial=s.snapshot()[0]
        for _ in range(60):s.regularize_solids(1/120)
        self.assertGreater(s.x[1][0]-s.x[0][0],2.79)
        np.testing.assert_allclose(float(s.mass[0])*s.x[0].to_numpy()+float(s.mass[1])*s.x[1].to_numpy(),center,atol=2e-5)
        np.testing.assert_allclose(s.v[0].to_numpy(),[7,2,0]);np.testing.assert_allclose(s.F[0].to_numpy(),np.eye(3))
        self.assertAlmostEqual(s.plastic[0],.4,places=6)
        final=s.snapshot()[0];self.assertEqual(final['mass'],initial['mass']);self.assertEqual(final['energy'],initial['energy'])

    def test_exclusions_pinning_compaction_and_coincident_pairs(self):
        s=self.s
        for kind in ['part','fluid','melted']:
            s.reset('empty');self.seed([[0,0,0],[1,0,0]])
            if kind=='part':s.lab.part[1]=1
            if kind=='fluid':s.material[1]=2
            if kind=='melted':s.melted[1]=1
            s.regularize_solids(1/60)
            self.assertEqual(s.x[0][0],0);self.assertEqual(s.x[1][0],1)
        s.reset('empty');self.seed([[0,0,0],[0,0,0]]);s.pinned[0]=1;s.inv_mass[0]=0
        s.regularize_solids(1/240);np.testing.assert_allclose(s.x[0].to_numpy(),0)
        self.assertGreater(s.x[1].norm(),0);self.assertLessEqual(s.x[1].norm(),8/240+1e-6)
        s.model[0]=9;s.F[0]=np.eye(3)*.5;s.jp[0]=.125;s.sampling_prepare(2)
        self.assertAlmostEqual(s.solid_spacing[0],.7,places=5)

    def test_cuda_six_second_drop_and_compression(self):
        s=self.s;results=[]
        for loading in ['drop','press']:
            for enabled in [False,True]:
                s.reset('empty');s.settings.update(gravity=True,thermal=False,solidAntiClump=enabled)
                s.box([-12,0 if loading=='drop' else -40,-12],[12,24 if loading=='drop' else 0,12],model=10,sampling=dict(enabled=True,strength=.2,seed=42))
                if loading=='press':s.press.update(enabled=True,y=12,target=-25,origin=12,speed=16)
                initial=s.snapshot()[0]
                for _ in range(360):s.step()
                state,data=s.snapshot();x=data[:,:3];d=np.linalg.norm(x[:,None]-x[None,:],axis=2);d[np.diag_indices(len(d))]=np.inf
                close=int(np.count_nonzero(np.triu(d<2,1)));minimum=float(d.min())
                results.append(dict(loading=loading,enabled=enabled,close=close,minimum=minimum))
                if enabled:self.assertEqual(close,0);self.assertGreater(minimum,2.6)
                else:self.assertGreater(close,100)
                self.assertGreater(state['minJ'],0);self.assertAlmostEqual(state['mass'],initial['mass'],places=4);self.assertAlmostEqual(state['energy'],initial['energy'],places=3)
                self.assertGreater(data[:,7].max(),.02)
                out=Path(__file__).parent.parent/'.diagnostics'/'solid-beading';out.mkdir(parents=True,exist_ok=True)
                (out/f'cuda-{loading}-{enabled}.json').write_text(json.dumps(dict(points=x.tolist(),**results[-1])),encoding='utf-8')
        print('CUDA solid sampling regression:',json.dumps(results),flush=True)

if __name__=='__main__':unittest.main()
