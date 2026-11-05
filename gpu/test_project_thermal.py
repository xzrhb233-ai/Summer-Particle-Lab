import copy
import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver

ROOT=Path(__file__).resolve().parent.parent
def fixture(flag):
    return json.loads(subprocess.check_output(['node','tests/gpu-thermal-fixtures.mjs',flag],cwd=ROOT,text=True,encoding='utf-8'))

class ThermalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixture('--projects');cls.report={}
    @classmethod
    def tearDownClass(cls):
        cls.s.close()
        (ROOT/'artifacts/gpu-thermal-validation.json').write_text(json.dumps(dict(backend=cls.backend,cases=cls.report),indent=2),encoding='utf-8')

    def test_01_closed_exchange_matches_cpu_and_density(self):
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        s=self.s;f,p=s.initialize(self.projects['exchange']);volume=s.s.volume.to_numpy()[:s.s.count].copy()
        for _ in range(48):s.thermal.step(1/480,False)
        f,p=s.snapshot();cpu=fixture('--cpu')
        np.testing.assert_allclose(p[:,4],cpu['temperatures'],rtol=2e-5,atol=.002)
        np.testing.assert_allclose(s.s.volume.to_numpy()[:s.s.count],volume,rtol=1e-6)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-6)
        self.assertEqual(f['coupling']['externalHeat'],0)
        self.assertGreater(f['coupling']['exchangedHeat'],100)
        self.assertLess(f['bodies'][0]['temperature'],160)
        self.assertGreater(p[:64,4].max(),20)
        self.report['closedExchange']=dict(**f['coupling'],bodyTemperature=f['bodies'][0]['temperature'],cpuMaxTemperatureDifference=float(np.max(np.abs(p[:,4]-cpu['temperatures']))))

    def test_02_live_sources_preserve_state_and_report_actual_work(self):
        s=self.s;s.initialize(self.projects['exchange']);before,p=s.step(1/60)
        s.command(dict(type='region-heat',value=dict(center=[0,.5,0],radius=1,power=10000)))
        s.command(dict(type='body-heat',id='hot',power=500))
        f,a=s.snapshot();self.assertEqual(f['time'],before['time']);np.testing.assert_array_equal(a,p)
        f,a=s.step(1/60);self.assertAlmostEqual(f['coupling']['externalHeat'],175,delta=1e-6)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-6)
        before=copy.deepcopy(f)
        with self.assertRaises(ValueError):s.command(dict(type='body-heat',id='missing',power=3))
        with self.assertRaises(ValueError):s.command(dict(type='region-heat',value=dict(radius=-1)))
        f,b=s.snapshot();self.assertEqual(f['time'],before['time']);np.testing.assert_array_equal(a,b)
        s.command(dict(type='region-heat',value=dict(power=0)))
        s.command(dict(type='body-heat',id='hot',power=0))
        f,_=s.step(1/60);self.assertAlmostEqual(f['coupling']['externalHeat'],175,delta=1e-6)
        self.report['onlineSources']=f['coupling']

    def test_03_phase_plateau_release_and_refreeze(self):
        s=self.s;p=copy.deepcopy(self.projects['release']);p['couplings'][0]['thermal']=False
        s.initialize(p);g=s.s;mass=float(g.mass.to_numpy()[:g.count].sum(dtype=float))
        # Mid-latent-heat plateau: solid retains constraints; source adds energy only.
        s.command(dict(type='region-heat',value=dict(power=mass*(1800*5+1000)/.1)))
        v=g.v.to_numpy()[:g.count].copy();s.thermal.step(.1,True);s.regions.update_phases(g.count,s.regions.count)
        f,a=s.snapshot();np.testing.assert_allclose(a[:,4],60,atol=1e-5);self.assertEqual(f['coupling']['liquids'],0)
        self.assertTrue(all(j['releasedCount']==0 for j in f['joints'] if j['type']=='region'))
        s.command(dict(type='region-heat',value=dict(power=mass*2000/.1)))
        s.thermal.step(.1,False);s.regions.update_phases(g.count,s.regions.count)
        s.regions.fluid_count=int(s.regions.fluid_size[None]);s.has_fluid=True
        f,a=s.snapshot();self.assertEqual(f['coupling']['liquids'],g.count)
        self.assertTrue(all(j['state']=='released' and j['count']==0 for j in f['joints'] if j['type']=='region'))
        np.testing.assert_array_equal(g.v.to_numpy()[:g.count],v)
        s.command(dict(type='region-heat',value=dict(power=0)))
        peak=0.
        for _ in range(12):
            f,a=s.step(1/60);self.assertTrue(np.isfinite(a).all())
            peak=max(peak,float(np.linalg.norm(g.v.to_numpy()[:g.count],axis=1).max()*.025))
        self.assertLess(peak,8)
        s.command(dict(type='region-heat',value=dict(power=-1e7)))
        for _ in range(80):
            s.thermal.step(1/480,False);s.regions.update_phases(g.count,s.regions.count)
        f,a=s.snapshot();self.assertEqual(f['coupling']['solids'],g.count)
        self.assertTrue(all(j['state']=='released' for j in f['joints'] if j['type']=='region'))
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
        self.report['phaseRelease']=dict(peakSpeed=peak,mass=mass,connections=[j for j in f['joints'] if j['type']=='region'],balance=f['coupling'])

    def test_04_hot_grip_real_coupled_steps(self):
        s=self.s;s.initialize(self.projects['hot'])
        for _ in range(120):f,a=s.step(1/60)
        self.assertTrue(np.isfinite(a).all());self.assertGreater(f['coupling']['maxTemperature'],25)
        self.assertLess(f['bodies'][0]['temperature'],180)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
        self.assertGreater(f['coupling']['maxPlastic'],0)
        self.report['hotGrip']=dict(time=f['time'],coupling=f['coupling'],bodies=f['bodies'],joints=f['joints'])

    def test_05_shared_capacity_budget_and_cooling_floor(self):
        s=self.s;p=copy.deepcopy(self.projects['exchange'])
        # Very small hot-body capacity with many simultaneous contacts.
        body=p['parts'][0];body['material']['mass']=.001;body['material']['cp']=1
        s.initialize(p)
        for _ in range(12):s.thermal.step(.1,False)
        f,a=s.snapshot()
        self.assertGreaterEqual(a[:,4].min(),20-1e-5);self.assertLessEqual(a[:,4].max(),160+1e-5)
        self.assertGreaterEqual(f['bodies'][0]['temperature'],20-1e-5)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-6)
        s.model['coupling']['thermal']=False
        s.command(dict(type='region-heat',value=dict(center=[0,.5,0],radius=1,power=-1e7)))
        s.command(dict(type='body-heat',id='hot',power=-1e7))
        s.thermal.step(10,False);f,a=s.snapshot()
        np.testing.assert_allclose(a[:,4],-273.15,atol=2e-5)
        self.assertAlmostEqual(f['bodies'][0]['temperature'],-273.15,places=8)
        self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
        self.report['capacityAndFloor']=f['coupling']

    def test_06_partial_release_and_pbf_freeze_thaw(self):
        s=self.s;p=copy.deepcopy(self.projects['release']);p['couplings'][0]['thermal']=False
        s.initialize(p)
        s.command(dict(type='region-heat',value=dict(center=[-.55,1,0],radius=.07,power=1e7)))
        s.thermal.step(.01,False);s.regions.update_phases(s.s.count,s.regions.count)
        f,a=s.snapshot();regions=[j for j in f['joints'] if j['type']=='region']
        self.assertEqual(regions[0]['state'],'partial');self.assertEqual(regions[1]['state'],'active')
        p=copy.deepcopy(self.projects['exchange']);p['couplings'][0]['thermal']=False
        p['parts'][1]['method']='pbf';p['parts'][1]['material']['density']=1000
        s.initialize(p);s.command(dict(type='region-heat',value=dict(center=[0,.5,0],radius=1,power=-1e7)))
        for _ in range(36):f,a=s.step(1/60)
        self.assertEqual(f['coupling']['liquids'],0);self.assertEqual(s.regions.fluid_count,0)
        self.assertTrue(np.any(a[:,3]==4))
        s.command(dict(type='region-heat',value=dict(power=1e7)))
        for _ in range(36):f,a=s.step(1/60)
        self.assertEqual(f['coupling']['liquids'],64);self.assertEqual(s.regions.fluid_count,64)
        self.assertTrue(np.isfinite(a).all());self.assertLess(abs(f['coupling']['thermalResidual']),1e-5)
        self.report['freezeThaw']=f['coupling']

if __name__=='__main__':unittest.main(verbosity=2)
