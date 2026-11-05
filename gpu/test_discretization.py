import json,subprocess,unittest
from pathlib import Path
import numpy as np
from solver import Solver
from runtime import initialize
from discretization import DEFAULT_DOMAIN,domain_parameters

class DiscretizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize();cls.s=Solver()
    def setUp(self):self.s.reset('empty');self.s.settings.update(gravity=False,thermal=False)
    def test_refinement_preserves_mass_volume_and_cell_counts(self):
        s=self.s
        for n in [2,3,4]:
            s.reset('empty');s.configure_domain(dict(DEFAULT_DOMAIN,particlesPerAxis=n));s.create_geometry(dict(center=[0,0,0],size=[16,16,16]))
            self.assertEqual(s.count,8*n**3);self.assertAlmostEqual(s.snapshot()[0]['mass'],4096/64*1.1,places=4)
            self.assertAlmostEqual(float(s.volume.to_numpy()[:s.count].sum())*64,4096,places=3)
            self.assertEqual(s.lab.snapshot()[0]['geometry']['particlesPerCell'],n**3)
    def test_cpu_cuda_rotated_geometry_and_dynamics_agree(self):
        r=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('discretization_reference.mjs'))],text=True));s=self.s
        s.configure_domain(dict(lower=[-120]*3,upper=[120]*3,cellSize=6,particlesPerAxis=3))
        s.create_geometry(dict(shape='cylinder',center=[80,20,-70],size=[12,20,16],rotation=[20,30,15],sampling=dict(enabled=True,strength=.2,seed=42),velocity=[3,-2,7]))
        np.testing.assert_allclose(s.x.to_numpy()[:s.count],r['initial'],atol=1e-5)
        for _ in range(6):s.step()
        np.testing.assert_allclose(s.x.to_numpy()[:s.count],r['positions'],atol=.005,rtol=.0001)
        self.assertAlmostEqual(s.snapshot()[0]['mass'],r['mass'],places=4)
    def test_invalid_configuration_atomic_and_safe_grid_change_keeps_history(self):
        s=self.s;s.create_geometry(dict(center=[0,0,0],size=[16,16,16]));s.plastic[0]=.4
        count=s.count
        self.assertFalse(s.command(dict(type='domain',value=dict(DEFAULT_DOMAIN,lower=[0,0,0])))['ok']);self.assertEqual(s.domain['cellSize'],8)
        self.assertFalse(s.command(dict(type='geometry',center=[60,0,0],size=[24,16,16],rotation=[0,20,0]))['ok']);self.assertEqual(s.count,count)
        s.configure_domain(dict(DEFAULT_DOMAIN,cellSize=4));self.assertAlmostEqual(s.plastic[0],.4,places=6)
        for h in [4,8,12,16]:
            d=domain_parameters(dict(lower=[-120]*3,upper=[120]*3,cellSize=h,particlesPerAxis=4));self.assertLessEqual(max(d['nodes']),67)
    def test_fine_melting_preserves_volume_and_finite_state(self):
        s=self.s;s.configure_domain(dict(DEFAULT_DOMAIN,cellSize=4,particlesPerAxis=4));s.create_geometry(dict(center=[0,0,0],size=[4,4,4],phaseChange=dict(enabled=True),temperature=180,model=10))
        volume=s.volume[0];mass=s.snapshot()[0]['mass'];self.assertAlmostEqual(volume,1/64,places=6);self.assertEqual(s.melted[0],1)
        s.step();self.assertAlmostEqual(s.volume[0],volume,places=6);self.assertAlmostEqual(s.snapshot()[0]['mass'],mass,places=6)

    def test_boundary_samples_reject_atomically_and_relocated_platen_stays_inside(self):
        s=self.s;s.configure_domain(dict(DEFAULT_DOMAIN,lower=[1.5,-48,-64],upper=[65.5,72,64]))
        result=s.command(dict(type='geometry',center=[5.5,0,0],size=[8,8,8]))
        self.assertFalse(result['ok']);self.assertEqual(s.count,0);self.assertEqual(s.lab.next_id,1)
        s.configure_domain(dict(lower=[0,100,0],upper=[8,108,8],cellSize=4,particlesPerAxis=2))
        self.assertEqual(s.press['y'],104);s.set_press(dict(enabled=True,target=0));self.assertEqual(s.press['target'],104)
        s.configure_domain(s.domain);s.set_press(dict(target=300));self.assertEqual(s.press['target'],108)

if __name__=='__main__':unittest.main()
