"""CUDA functional/energy checks for boundaries; no convergence study."""
import ast,copy,inspect,json,textwrap,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver
from mixed_thermal import MixedThermalLoads

ROOT=Path(__file__).resolve().parent.parent

def load(kind,target='hot-block',**values):
    return {**dict(id=kind+'-'+target,type='thermal-'+kind,target=target,region=dict(type='whole'),enabled=True),**values}

class ThermalChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda')
        cls.project=json.loads((ROOT/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))

    def make(self,loads,contact=False,conductivity=0):
        p=copy.deepcopy(self.project);p['parts'][1]['initial']['velocity']=[0,0,0]
        p['parts'][0]['material']['conductivity']=conductivity
        p['contactPairs'][0]['thermal']=contact;p['contactPairs'][0]['mechanical']=contact
        if contact:p['parts'][1]['geometry']['center'][1]=.7;p['parts'][0]['geometry']['center'][1]=.525
        p['loads']+=loads
        return MixedSolver(compile_project(project=p))

    def test_power_and_negative_power_reach_both_domains(self):
        s=self.make([load('power',power=1200),load('power','beam',power=-600)])
        frame,_=s.step(.01)
        self.assertEqual(self.backend['arch'],'cuda')
        np.testing.assert_allclose([l['heat'] for l in frame['thermalLoads']],[12,-6],atol=1e-7)
        self.assertGreater(frame['part']['temperature'],160)
        self.assertLess(np.array(frame['state']['temperature']).mean(),20)
        self.assertAlmostEqual(frame['thermal']['externalHeat'],6,places=6)
        self.assertLess(abs(frame['thermal']['residual']),1e-6)

    def test_convection_matches_capacity_and_area_on_both_domains(self):
        s=self.make([load('convection',temperature=20,coefficient=300),load('convection','beam',temperature=80,coefficient=100)])
        initial=[s.s.enthalpy.to_numpy()/1800,s.temperature.to_numpy()];dt=.02
        frame,_=s.step(dt)
        for slot,domain in enumerate(['mpm','fem']):
            d=s.c['thermalLoads'][slot];indices=np.array([e['index'] for e in d['entries']]);area=np.array([e['area'] for e in d['entries']])
            cap=s.s.mass.to_numpy().astype(float)*1800 if domain=='mpm' else s.capacity.to_numpy()
            target=d['definition']['temperature'];h=d['definition']['coefficient']
            expected=target+(initial[slot][indices]-target)*np.exp(-h*area*dt/cap[indices])
            actual=s.s.enthalpy.to_numpy()/1800 if domain=='mpm' else s.temperature.to_numpy()
            np.testing.assert_allclose(actual[indices],expected,rtol=0,atol=1e-7)
        self.assertLess(abs(frame['thermal']['residual']),1e-6)

    def test_thermostats_include_initial_and_contact_replenishment(self):
        s=self.make([load('temperature',temperature=100),load('temperature','beam',temperature=30)],contact=True,conductivity=50)
        initial,_=s.snapshot();self.assertLess(initial['thermalLoads'][0]['heat'],0);self.assertGreater(initial['thermalLoads'][1]['heat'],0)
        self.assertLess(abs(initial['thermal']['residual']),1e-7)
        frame,_=s.step(.01)
        np.testing.assert_allclose(s.s.enthalpy.to_numpy()/1800,100,atol=1e-10)
        np.testing.assert_allclose(s.temperature.to_numpy(),30,atol=1e-10)
        self.assertLess(frame['contactPairs'][0]['accumulatedHeat'],0)
        self.assertGreater(frame['thermalLoads'][0]['intervalHeat'],0)
        self.assertLess(frame['thermalLoads'][1]['intervalHeat'],0)
        self.assertLess(abs(frame['thermal']['residual']),1e-6)

    def test_material_faces_and_disabled_load(self):
        a=load('power',power=300);a['region']=dict(type='face',face='x+')
        b=load('power','beam',power=-300);b['region']=dict(type='face',face='y-')
        disabled=load('temperature',temperature=1000,enabled=False)
        s=self.make([a,b,disabled]);s.thermal_loads.step(.01)
        actual=[s.s.enthalpy.to_numpy()/1800,s.temperature.to_numpy()]
        for k,d in enumerate(s.c['thermalLoads'][:2]):
            selected={e['index'] for e in d['entries']};self.assertTrue(selected)
            for i,T in enumerate(actual[k]):
                if i in selected:self.assertNotEqual(T,[160,20][k])
                else:self.assertAlmostEqual(T,[160,20][k],places=10)
        frame,_=s.snapshot(.01);self.assertEqual(frame['thermalLoads'][2]['heat'],0)
        self.assertLess(abs(frame['thermal']['residual']),1e-6)

    def test_absolute_zero_clips_delivery_not_requested_heat(self):
        s=self.make([load('power',power=-1e7),load('power','beam',power=-1e7)])
        s.s.enthalpy.fill(-273.149*1800);s.temperature.fill(-273.149)
        before=s.thermal_energy();s.thermal_loads.step(.01);frame,_=s.snapshot(.01)
        self.assertGreaterEqual((s.s.enthalpy.to_numpy()/1800).min(),-273.1500001)
        self.assertGreaterEqual(s.temperature.to_numpy().min(),-273.1500001)
        for l in frame['thermalLoads']:self.assertGreater(l['heat'],l['requestedHeat'])
        self.assertAlmostEqual(s.thermal_energy()-before,frame['thermal']['externalHeat'],places=6)

    def test_failed_interval_restores_reservoir_ledgers_and_temperatures(self):
        s=self.make([load('power',power=5000),load('temperature','beam',temperature=100)])
        before,_=s.snapshot();fields=[s.s.enthalpy,s.temperature,s.thermal_loads.heat,s.thermal_loads.requested];old=[a.to_numpy() for a in fields]
        check=s.check_status
        def fail():raise ValueError('injected failure')
        s.check_status=fail
        with self.assertRaisesRegex(ValueError,'injected'):s.step(.002)
        for a,b in zip(fields,old):np.testing.assert_array_equal(a.to_numpy(),b)
        self.assertEqual(s.time,0);s.check_status=check
        after,_=s.snapshot();self.assertEqual(after['thermal']['externalHeat'],before['thermal']['externalHeat'])
        self.assertTrue(all(l['intervalHeat']==0 for l in after['thermalLoads']))

    def test_resident_boundary_dispatch_has_no_device_reads(self):
        tree=ast.parse(textwrap.dedent(inspect.getsource(MixedThermalLoads.step)))
        calls={n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)}
        self.assertFalse(calls&{'to_numpy','from_numpy','sync','results'})

if __name__=='__main__':unittest.main(verbosity=2)
