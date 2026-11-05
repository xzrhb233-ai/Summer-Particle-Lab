"""Contact-only heating, separation and configurable material heat capacity."""
import copy,json,unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver

class ContactHeatingChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda')
        cls.base=json.loads((Path(__file__).resolve().parent.parent/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))

    def make(self,cp=900,k=205,power=None):
        p=copy.deepcopy(self.base);b=p['parts'][1];f=p['parts'][0]
        b['material'].update(cp=cp,conductivity=k);b['initial'].update(temperature=20,velocity=[0,0,0]);b['geometry']['center'][1]=.7
        f['geometry']['center'][1]=.52500001;f['initial']['temperature']=140;f['material']['conductivity']=205
        p['contactPairs'][0].update(thermal=power is None,thermalToleranceRatio=0,contactConductance=10000)
        p['loads'].append(dict(id='bath',type='thermal-temperature',target=f['id'],temperature=140,region=dict(type='whole'),enabled=True))
        if power is not None:p['loads'].append(dict(id='source',type='thermal-power',target=b['id'],power=power,region=dict(type='whole'),enabled=True))
        return MixedSolver(compile_project(project=p))

    @staticmethod
    def thermal_steps(s,count):
        # Isolate heat operators from mechanics for boundary and conservation checks.
        s.prepare_surface();s.find_contacts()
        for _ in range(count):
            s.heat_budget(.0002);s.heat_exchange(.0002);s.thermal_loads.step(.0002);s.advance_clock(.0002)
        s.check_status()

    def test_power_uses_material_cp_and_zero_k_insulates_contact(self):
        s=self.make(cp=900,k=0,power=900);mass=s.s.mass.to_numpy().astype(float).sum()
        f,_=s.step(.001)
        self.assertAlmostEqual(f['part']['temperature'],20+.9/(mass*900),places=7)
        self.assertLess(abs(f['thermal']['residual']),1e-6)
        s=self.make(cp=900,k=0);self.thermal_steps(s,20)
        np.testing.assert_allclose(s.s.temp.to_numpy(),20,atol=1e-6)

    def test_contact_heats_surface_then_interior_and_separation_stops_exchange(self):
        s=self.make();self.assertEqual(self.backend['arch'],'cuda')
        y=s.s.x.to_numpy()[:,1];surface=y==y.min();far=y==y.max();next_layer=y==np.unique(y)[1]
        mass=s.s.mass.to_numpy().astype(float);initial=np.dot(mass,s.s.enthalpy.to_numpy())
        self.thermal_steps(s,1000);T=s.s.enthalpy.to_numpy()/s.particle_cp
        self.assertGreater(T[surface].mean(),T[far].mean()+.1)
        self.assertGreater(T[next_layer].mean(),20)
        exchanged=float(s.stats.to_numpy()[4]);self.assertGreater(exchanged,0)
        self.assertAlmostEqual(np.dot(mass,s.s.enthalpy.to_numpy())-initial,exchanged,places=6)
        # Move the hot platen away. Internal diffusion may continue, total MPM heat cannot change.
        u=s.u.to_numpy();u[:,1]-=.1;s.u.from_numpy(u)
        self.thermal_steps(s,100)
        self.assertEqual(float(s.stats.to_numpy()[4]),exchanged)
        self.assertAlmostEqual(np.dot(mass,s.s.enthalpy.to_numpy())-initial,exchanged,places=6)

if __name__=='__main__':unittest.main()
