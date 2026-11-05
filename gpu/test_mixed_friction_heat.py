"""Discrete CUDA friction-energy tests; no continuum convergence claim."""
import ast,copy,inspect,json,textwrap,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver,L


class FrictionHeatChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize('cuda')
        cls.base=json.loads((Path(__file__).resolve().parent.parent/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))

    def make(self,thermal=True,beta=.8,to_a=.25,thermostat=False,touch=False):
        p=copy.deepcopy(self.base)
        p['parts'][1]['initial'].update(temperature=20,velocity=[1,-1,0])
        p['contactPairs'][0].update(thermal=False,contactConductance=0,friction=.4)
        p['solver']['thermal']=thermal
        if touch:
            p['parts'][1]['geometry']['center'][1]=.7;p['parts'][0]['geometry']['center'][1]=.525
        if thermostat:
            p['loads'].append(dict(id='hold-mpm',type='thermal-temperature',target='hot-block',temperature=20,region=dict(type='whole'),enabled=True))
        compiled=compile_project(project=p)
        # Exercise the solver's SI boundary directly, independently of UI parsing.
        compiled['project']['contactPairs'][0].update(frictionHeatFraction=beta,frictionHeatToA=to_a)
        return MixedSolver(compiled)

    def controlled_contacts(self,s,velocities,weights=None,pinned=False,free_fem=False):
        """Freeze a known flat contact stencil; test the actual production kernel."""
        count=len(velocities);s.s.v.fill(0);s.s.C.fill(0);s.v.fill(0);s.fixed.fill(0 if free_fem else 1)
        hits=np.full(s.n,-1,np.int32);hits[:count]=0;s.hit.from_numpy(hits)
        normals=np.zeros((s.n,3));normals[:count,1]=1;s.normal.from_numpy(normals)
        arms=np.zeros((s.n,3));arms[:count,1]=-s.radius;s.arm.from_numpy(arms)
        bary=np.zeros((s.n,3));bary[:count]=weights if weights is not None else [.2,.3,.5];s.weights.from_numpy(bary)
        sums=np.zeros(s.nn);ids=s.tris.to_numpy()[0]
        for i in range(count):
            for a,n in enumerate(ids):sums[n]+=bary[i,a]
        s.weight_sum.from_numpy(sums);s.depth.fill(0)
        velocity=np.zeros((s.n,3),np.float32);velocity[:count]=np.asarray(velocities)/L;s.s.v.from_numpy(velocity)
        flags=np.zeros(s.n,np.int32)
        if pinned:flags[:count]=1;s.s.v.fill(0)
        s.s.pinned.from_numpy(flags)
        return ids

    def kinetic(self,s,tangent_only=False):
        velocity=s.s.v.to_numpy().astype(float)*L;fem=s.v.to_numpy();C=s.s.C.to_numpy().astype(float)
        omega=np.stack((C[:,2,1]-C[:,1,2],C[:,0,2]-C[:,2,0],C[:,1,0]-C[:,0,1]),axis=1)/2
        mass=s.s.mass.to_numpy().astype(float);mobile=~s.s.pinned.to_numpy().astype(bool)
        inertia=2*mass*(float(s.s.mpm_h[None])*L)**2/4
        if tangent_only:velocity[:,1]=0;fem[:,1]=0
        return float(.5*np.sum(mass[mobile,None]*velocity[mobile]**2)+.5*np.sum(inertia[mobile,None]*omega[mobile]**2)+.5*np.sum(s.mass.to_numpy()[:,None]*fem**2))

    def test_single_contact_matches_analytic_spin_work_and_heat_partition(self):
        s=self.make();self.controlled_contacts(s,[[1,-1,0]])
        m=float(s.s.mass.to_numpy()[0]);inertia=2*m*(float(s.s.mpm_h[None])*L)**2/4
        inverse=1/m+s.radius**2/inertia;jt=min(.4*m,1/inverse);expected=jt-.5*jt*jt*inverse
        E=s.thermal_energy();kinetic=self.kinetic(s);Tp=s.s.enthalpy.to_numpy().copy();Tf=s.temperature.to_numpy().copy()
        s.contact_iteration();s.check_status();ledger=s.friction_totals.to_numpy()
        self.assertAlmostEqual(ledger[0],expected,delta=2e-8)
        self.assertAlmostEqual(kinetic-self.kinetic(s),.5*m+ledger[0],delta=2e-8)
        self.assertAlmostEqual(s.thermal_energy()-E,.8*ledger[0],delta=2e-8)
        qp=np.sum(s.s.mass.to_numpy()*(s.s.enthalpy.to_numpy()-Tp));qf=np.sum(s.capacity.to_numpy()*(s.temperature.to_numpy()-Tf))
        self.assertAlmostEqual(qp,.25*.8*ledger[0],delta=2e-10);self.assertAlmostEqual(qf,.75*.8*ledger[0],delta=2e-10)
        self.assertGreater(np.linalg.norm(s.s.C.to_numpy()[0]),0)
        self.assertFalse(s.contact['thermal']);self.assertEqual(s.conductance,0)
        # No remaining approach impulse: another Jacobi pass cannot heat twice.
        s.contact_iteration();np.testing.assert_allclose(s.friction_totals.to_numpy(),ledger,atol=1e-10)

    def test_shared_fem_nodes_use_assembled_work_and_heat_fixed_nodes(self):
        s=self.make();ids=self.controlled_contacts(s,[[2,-1,0],[-.7,-.25,0]],weights=[[.2,.3,.5],[.6,.3,.1]],free_fem=True)
        fixed=s.fixed.to_numpy();fixed[ids[0],0]=1;s.fixed.from_numpy(fixed)
        E=s.thermal_energy();before=self.kinetic(s,True);T=s.temperature.to_numpy().copy()
        s.contact_iteration();s.check_status();ledger=s.friction_totals.to_numpy()
        self.assertGreater(ledger[0],0);self.assertAlmostEqual(before-self.kinetic(s,True),ledger[0],delta=3e-8)
        self.assertAlmostEqual(s.thermal_energy()-E,ledger[1],delta=2e-8)
        self.assertGreater(s.temperature.to_numpy()[ids[0]],T[ids[0]])
        self.assertEqual(s.v.to_numpy()[ids[0],0],0)
        self.assertTrue(np.all(s.friction_weights.to_numpy()>=0))
        momentum=np.sum(s.s.mass.to_numpy()[:,None]*s.s.v.to_numpy()*L,axis=0)+np.sum(s.mass.to_numpy()[:,None]*s.v.to_numpy(),axis=0)
        initial=np.asarray([2-.7,-1-.25,0])*float(s.s.mass.to_numpy()[0])
        np.testing.assert_allclose(momentum+s.stats.to_numpy()[6:9],initial,atol=2e-7)

    def test_mechanical_particle_anchor_still_accepts_friction_heat(self):
        s=self.make();ids=self.controlled_contacts(s,[[0,0,0]],pinned=True,free_fem=True)
        velocity=np.zeros((s.nn,3));velocity[ids]=[-1,1,0];s.v.from_numpy(velocity)
        H=s.s.enthalpy.to_numpy().copy();E=s.thermal_energy();before=self.kinetic(s,True)
        s.contact_iteration();s.check_status()
        self.assertGreater(s.friction_totals.to_numpy()[0],0)
        self.assertAlmostEqual(before-self.kinetic(s,True),s.friction_totals.to_numpy()[0],delta=1e-10)
        np.testing.assert_array_equal(s.s.v.to_numpy()[0],0);np.testing.assert_array_equal(s.s.C.to_numpy()[0],0)
        self.assertGreater(s.s.enthalpy.to_numpy()[0],H[0])
        self.assertAlmostEqual(s.thermal_energy()-E,s.friction_totals.to_numpy()[1],delta=2e-8)

    def test_thermal_disable_keeps_loss_but_generates_no_heat(self):
        s=self.make(thermal=False);self.controlled_contacts(s,[[1,-1,0]])
        H=s.s.enthalpy.to_numpy().copy();T=s.temperature.to_numpy().copy()
        s.contact_iteration();s.check_status()
        self.assertGreater(s.friction_totals.to_numpy()[0],0);np.testing.assert_array_equal(s.friction_totals.to_numpy()[1:],0)
        np.testing.assert_array_equal(s.s.enthalpy.to_numpy(),H);np.testing.assert_array_equal(s.temperature.to_numpy(),T)

    def test_zero_conversion_is_backward_compatible(self):
        s=self.make(beta=0);self.controlled_contacts(s,[[1,-1,0]])
        E=s.thermal_energy();s.contact_iteration();s.check_status()
        self.assertGreater(s.friction_totals.to_numpy()[0],0);np.testing.assert_array_equal(s.friction_totals.to_numpy()[1:],0)
        self.assertEqual(s.thermal_energy(),E)

    def test_no_heat_without_friction_or_without_compressive_sliding(self):
        for case,velocity in [('zero-friction',[1,-1,0]),('separating',[1,1,0]),('co-moving',[1,0,0])]:
            with self.subTest(case=case):
                s=self.make();ids=self.controlled_contacts(s,[velocity],free_fem=case=='co-moving')
                if case=='zero-friction':s.contact['friction']=0.
                if case=='co-moving':
                    fem_velocity=np.zeros((s.nn,3));fem_velocity[ids]=[1,0,0];s.v.from_numpy(fem_velocity)
                H=s.s.enthalpy.to_numpy().copy();T=s.temperature.to_numpy().copy()
                s.contact_iteration();s.check_status()
                np.testing.assert_array_equal(s.friction_totals.to_numpy(),0)
                np.testing.assert_array_equal(s.s.enthalpy.to_numpy(),H);np.testing.assert_array_equal(s.temperature.to_numpy(),T)

    def test_thermostat_books_generated_heat_removal_and_snapshot_budget(self):
        s=self.make(thermostat=True);self.controlled_contacts(s,[[1,-1,0]])
        s.contact_iteration();s.thermal_loads.step(.0001);frame,_=s.snapshot(.0001)
        t=frame['thermal'];self.assertGreater(t['generatedHeat'],0)
        self.assertAlmostEqual(t['externalHeat'],-t['generated']['mpm'],delta=2e-9)
        self.assertAlmostEqual(t['residual'],0,delta=2e-8)
        self.assertAlmostEqual(sum(t['generated'][k] for k in ['mpm','fem']),t['generatedHeat'],delta=1e-12)
        self.assertEqual(frame['contactPairs'][0]['frictionLossScope'],'cumulative-from-start')
        self.assertAlmostEqual(frame['contactPairs'][0]['accumulatedFrictionHeat'],t['generated']['friction'],delta=1e-12)

    def test_failed_step_rolls_back_heat_losses_plastic_ledgers_and_clock(self):
        s=self.make(touch=True)
        s.s.plastic_work[None]=.12;s.s.plastic_heat[None]=.03
        fields=[s.s.x,s.s.v,s.s.C,s.s.enthalpy,s.temperature,s.friction_totals,s.s.plastic_work,s.s.plastic_heat,s.device_time]
        before=[a.to_numpy().copy() for a in fields]
        def fail():
            self.assertGreater(s.friction_totals.to_numpy()[0],0)
            raise ValueError('injected after dissipative heat')
        original=s.check_status;s.check_status=fail
        with self.assertRaisesRegex(ValueError,'injected'):s.step(.0001)
        s.check_status=original
        for a,b in zip(fields,before):np.testing.assert_array_equal(a.to_numpy(),b)
        self.assertEqual(s.time,0);self.assertEqual(s.steps,0)

    def test_resident_contact_has_no_host_transfers(self):
        for method in [MixedSolver.substep,MixedSolver.contact_iteration]:
            tree=ast.parse(textwrap.dedent(inspect.getsource(method)))
            names={n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)}
            self.assertFalse(names&{'to_numpy','from_numpy','sync','request','send','receive','check_status'})


if __name__=='__main__':unittest.main()
