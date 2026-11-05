import copy,json,unittest,inspect,ast
from pathlib import Path
import numpy as np
import taichi as ti
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver

class MixedChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ti.init(arch=ti.cpu,default_fp=ti.f32,fast_math=False,cpu_max_num_threads=8,offline_cache=False,offline_cache_file_path=str(Path(__file__).resolve().parent.parent/'.taichi-cache'))
        cls.project=json.loads((Path(__file__).resolve().parent.parent/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))
    def make(self,touch=False):
        p=copy.deepcopy(self.project)
        if touch:p['parts'][1]['geometry']['center'][1]=.7;p['parts'][0]['geometry']['center'][1]=.525
        return MixedSolver(compile_project(project=p))
    def test_no_substep_host_transfers(self):
        import textwrap
        tree=ast.parse(textwrap.dedent(inspect.getsource(MixedSolver.substep)))
        calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
        self.assertFalse(set(calls)&{'to_numpy','from_numpy','sync','request','send','receive','check_status'})
    def test_impulses_balance_with_fixed_support_and_heat_is_conservative(self):
        s=self.make(True)
        before=np.sum(s.s.mass.to_numpy()[:,None]*s.s.v.to_numpy()*.025,axis=0)+np.sum(s.mass.to_numpy()[:,None]*s.v.to_numpy(),axis=0)
        s.contact_iteration()
        after=np.sum(s.s.mass.to_numpy()[:,None]*s.s.v.to_numpy()*.025,axis=0)+np.sum(s.mass.to_numpy()[:,None]*s.v.to_numpy(),axis=0)
        np.testing.assert_allclose(after+s.stats.to_numpy()[6:9],before,atol=2e-6)
        E=s.thermal_energy();s.prepare_surface();s.find_contacts();s.heat_budget(.001);s.heat_exchange(.001);s.check_status()
        self.assertLess(s.stats.to_numpy()[4],0);self.assertAlmostEqual(s.thermal_energy(),E,places=7)
        self.assertGreaterEqual(s.temperature.to_numpy().min(),20);self.assertLessEqual(s.temperature.to_numpy().max(),160)
    def test_failed_step_restores_gpu_state_and_does_not_commit_clock(self):
        s=self.make();before=[s.s.x.to_numpy(),s.s.F.to_numpy(),s.u.to_numpy(),s.temperature.to_numpy(),s.stats.to_numpy()]
        check=s.check_status
        def fail():raise ValueError('injected')
        s.check_status=fail
        with self.assertRaisesRegex(ValueError,'injected'):s.step(.001)
        for a,b in zip(before,[s.s.x.to_numpy(),s.s.F.to_numpy(),s.u.to_numpy(),s.temperature.to_numpy(),s.stats.to_numpy()]):np.testing.assert_array_equal(a,b)
        self.assertEqual(s.time,0);self.assertEqual(s.steps,0);s.check_status=check
        frame,_=s.step(.001);self.assertEqual(frame['contactPairs'][0]['accumulatedHeat'],0)
    def test_deep_initial_overlap_is_rejected_before_device_publication(self):
        p=copy.deepcopy(self.project);p['parts'][1]['geometry']['center']=p['parts'][0]['geometry']['center'][:]
        with self.assertRaisesRegex(ValueError,'内部'):compile_project(project=p)

if __name__=='__main__':unittest.main()
