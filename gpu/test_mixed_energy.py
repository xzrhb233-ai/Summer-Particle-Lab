"""Analytic/operator checks for the opt-in resident recoverable-energy ledger."""
import ast,copy,inspect,json,math,textwrap,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver
from mixed_energy import MixedEnergy,DAMPING,EXTERNAL,GRAVITY_KICK,NORMAL,POSITION,THERMAL
from runtime import initialize


@ti.kernel
def advect_for_gravity_test(s:ti.template(),dt:ti.f32):
    for i in range(s.n):s.s.x[i]+=dt*s.s.v[i]


class EnergyChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        initialize('cuda')
        cls.base=json.loads((Path(__file__).resolve().parent.parent/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))

    def make(self,diagnostics=True,gravity=(0,0,0),thermal=False,damping=0,expansion=0):
        p=copy.deepcopy(self.base);p['parts'][1]['initial'].update(temperature=20,velocity=[0,0,0]);p['parts'][1]['material']['model']=1
        p['parts'][1]['material']['thermomechanical']=dict(expansion=expansion,referenceTemperature=20,hotStiffnessRatio=.5 if expansion else 1)
        p['parts'][0]['material']['expansion']=expansion;p['environment']['gravity']=list(gravity)
        p['solver'].update(thermal=thermal,damping=damping);p['contactPairs'][0].update(mechanical=False,thermal=False,friction=0)
        compiled=compile_project(project=p);compiled['project']['solver']['diagnostics']=diagnostics
        return MixedSolver(compiled)

    def rebase(self,s):
        s.energy.measure_storage();s.energy.initial=float(s.energy.storage.to_numpy().sum())

    def observed(self,s):
        return s.energy.snapshot(dict(residual=0),s.friction_totals.to_numpy())

    def dense_stiffness(self,s):
        a=s.c['fem']['A'];K=np.zeros((3*s.nn,3*s.nn))
        for row in range(3*s.nn):
            for q in range(a['offsets'][row],a['offsets'][row+1]):K[row,a['indices'][q]]=a['values'][q]
        return K

    def fem_operator(self,s,h):
        s.fem_thermal_force();s.fem_force();s.energy.before_fem_drift(h);s.fem_drift(h);s.fem_force()
        s.energy.before_fem_kick(h);s.fem_kick(h);s.energy.after_fem()

    def test_si_storage_full_affine_and_analytic_gravity_kick(self):
        s=self.make(gravity=(0,-9.81,0));mass=s.s.mass.to_numpy().astype(float);M=float(mass.sum())
        velocities=np.zeros((s.n,3),np.float32);velocities[:,0]=2/.025;s.s.v.from_numpy(velocities)
        C=np.tile(np.diag([1.,2.,3.]),(s.n,1,1)).astype(np.float32);s.s.C.from_numpy(C)
        e=self.observed(s);D=(float(s.s.mpm_h[None])*.025)**2/4
        self.assertAlmostEqual(e['storage']['mpmKinetic'],.5*M*4,delta=1e-10)
        self.assertAlmostEqual(e['storage']['mpmAffine'],.5*M*D*14,delta=1e-10)
        expected=np.sum(mass*9.81*s.s.x.to_numpy()[:,1].astype(float)*.025)
        self.assertAlmostEqual(e['storage']['mpmPotential'],expected,delta=1e-10)
        self.assertAlmostEqual(e['storage']['mpmElastic'],0,delta=1e-10)
        # The full affine matrix, including its symmetric part, is stored energy.
        self.assertGreater(e['storage']['mpmAffine'],0)
        s.s.v.fill(0);s.s.C.fill(0);h=.01;s.energy.begin_mpm();s.particle_gravity(h);s.energy.after_gravity()
        self.assertAlmostEqual(s.energy.values.to_numpy()[GRAVITY_KICK],.5*M*(9.81*h)**2,delta=2e-8)
        advect_for_gravity_test(s,h);s.energy.after_g2p();r=self.observed(s)['gravityIntegrationResidual']
        self.assertAlmostEqual(r,-.5*M*(9.81*h)**2,delta=1e-5)

    def test_fem_uniform_translation_constant_force_and_exact_split_damping(self):
        s=self.make(damping=1);s.fixed.fill(0);M=float(s.mass.to_numpy().sum());h=.01;d=math.exp(-h/2);v0=.3
        for acceleration in [0.,2.]:
            with self.subTest(acceleration=acceleration):
                s.energy.values.fill(0);s.u.fill(0);v=np.zeros((s.nn,3));v[:,0]=v0;s.v.from_numpy(v)
                force=np.zeros((s.nn,3));force[:,0]=s.mass.to_numpy()*acceleration;s.force.from_numpy(force);self.rebase(s)
                self.fem_operator(s,h);e=self.observed(s);half=d*v0+.5*h*acceleration;before_last=half+.5*h*acceleration
                expected_loss=.5*M*(1-d*d)*(v0*v0+before_last*before_last)
                self.assertAlmostEqual(e['physical']['femDamping'],expected_loss,delta=2e-10)
                self.assertAlmostEqual(e['externalWork'],M*acceleration*h*half,delta=2e-10)
                np.testing.assert_allclose(s.v.to_numpy()[:,0],d*before_last,atol=1e-10)
                self.assertAlmostEqual(e['unexplainedResidual'],0,delta=2e-9)
                self.assertAlmostEqual(e['femIntegrationResidual'],0,delta=2e-9)

    def test_normal_impulse_and_position_cleanup_are_separate_measured_operators(self):
        s=self.make(gravity=(0,-9.81,0));s.fixed.fill(0);s.v.fill(0);s.s.v.fill(0);s.s.C.fill(0)
        hit=np.full(s.n,-1,np.int32);hit[0]=0;s.hit.from_numpy(hit)
        normal=np.zeros((s.n,3));normal[0,1]=1;s.normal.from_numpy(normal)
        arms=np.zeros((s.n,3));arms[0,1]=-s.radius;s.arm.from_numpy(arms)
        weights=np.zeros((s.n,3));weights[0]=[.2,.3,.5];s.weights.from_numpy(weights)
        ids=s.tris.to_numpy()[0];sums=np.zeros(s.nn);sums[ids]=weights[0];s.weight_sum.from_numpy(sums)
        depth=np.zeros(s.n);depth[0]=.0001;s.depth.from_numpy(depth)
        velocity=np.zeros((s.n,3),np.float32);velocity[0,1]=-1/.025;s.s.v.from_numpy(velocity)
        mass=float(s.s.mass.to_numpy()[0]);inverse=1/mass+np.sum(weights[0]**2/s.mass.to_numpy()[ids])
        x=s.s.x.to_numpy().astype(float)*.025;K=self.dense_stiffness(s);self.rebase(s)
        s.energy.before_contact();s.contact_iteration();s.energy.after_contact();e=self.observed(s)
        self.assertAlmostEqual(e['physical']['normal'],.5/inverse,delta=2e-8)
        self.assertEqual(e['physical']['friction'],0)
        u=s.u.to_numpy().ravel();dx=s.s.x.to_numpy().astype(float)*.025-x
        position=.5*u@(K@u)+np.sum(s.s.mass.to_numpy()*9.81*dx[:,1])
        self.assertGreater(position,0);self.assertAlmostEqual(e['numerical']['positionCorrection'],position,delta=2e-10)
        self.assertAlmostEqual(e['unexplainedResidual'],0,delta=2e-8)

    def test_fixed_configuration_temperature_change_is_stored_energy_work_not_heat(self):
        s=self.make(thermal=True,expansion=1e-4)
        F=np.tile(np.diag([1.02,1.,1.]),(s.n,1,1)).astype(np.float32);s.s.F.from_numpy(F)
        u=s.nodes.to_numpy()*.002;s.u.from_numpy(u);self.rebase(s);before=self.observed(s)['mechanical']
        s.energy.before_heat();s.s.temp.fill(100);s.s.enthalpy.fill(100*s.particle_cp);s.temperature.fill(80);s.energy.after_heat()
        e=self.observed(s)
        self.assertNotEqual(e['thermalWork'],0);self.assertAlmostEqual(e['thermalWork'],e['mechanical']-before,delta=2e-8)
        self.assertAlmostEqual(e['unexplainedResidual'],0,delta=2e-8)
        self.assertEqual(e['physical']['total'],0);self.assertEqual(float(s.s.plastic_heat[None]),0)
        np.testing.assert_array_equal(s.s.F.to_numpy(),F);np.testing.assert_array_equal(s.u.to_numpy(),u)
        self.assertFalse(e['coverage']['totalThermodynamic']);self.assertTrue(e['complete'])

    def test_enabled_observer_preserves_trajectory_and_snapshots_do_not_accumulate(self):
        a=self.make(diagnostics=True,gravity=(0,-1,0));b=self.make(diagnostics=False,gravity=(0,-1,0))
        for s in [a,b]:
            velocity=np.tile(np.asarray([.1,-.2,.05])/.025,(s.n,1)).astype(np.float32);s.s.v.from_numpy(velocity)
            if s.energy:self.rebase(s)
            s.step(.0004)
        for key in ['x','v','F','C','enthalpy']:
            np.testing.assert_allclose(getattr(a.s,key).to_numpy(),getattr(b.s,key).to_numpy(),rtol=2e-5,atol=2e-6,err_msg=key)
        np.testing.assert_allclose(a.u.to_numpy(),b.u.to_numpy(),atol=1e-12);np.testing.assert_allclose(a.v.to_numpy(),b.v.to_numpy(),atol=1e-12)
        frame,_=a.snapshot();again,_=a.snapshot()
        self.assertEqual(frame['energy']['physical'],again['energy']['physical']);self.assertEqual(frame['energy']['numerical'],again['energy']['numerical'])
        self.assertEqual(frame['energy']['thermalWork'],again['energy']['thermalWork'])
        e=frame['energy'];self.assertTrue(e['complete']);self.assertAlmostEqual(e['unexplainedResidual'],e['mpmStressStrainError']+e['gravityIntegrationResidual']+e['femIntegrationResidual'],delta=2e-7)
        off,_=b.snapshot();self.assertIsNone(b.energy);self.assertFalse(off['energy']['enabled']);self.assertIsNone(off['energy']['unexplainedResidual'])

    def test_failed_step_restores_every_energy_counter_and_coverage_flag(self):
        s=self.make(thermal=True,expansion=1e-4);s.step(.0001)
        fields=[s.energy.values,s.energy.issues,s.s.plastic_return_work,s.s.plastic_thermal_work,s.s.plastic_trial_work,s.s.energy_clamped,s.s.x,s.s.v,s.s.F,s.s.enthalpy,s.device_time]
        before=[a.to_numpy().copy() for a in fields];initial=s.energy.initial;time=s.time;steps=s.steps;original=s.check_status
        def fail():raise ValueError('injected energy observer rollback')
        s.check_status=fail
        with self.assertRaisesRegex(ValueError,'observer rollback'):s.step(.0001)
        s.check_status=original
        for a,b in zip(fields,before):np.testing.assert_array_equal(a.to_numpy(),b)
        self.assertEqual(s.energy.initial,initial);self.assertEqual(s.time,time);self.assertEqual(s.steps,steps)

    def test_observer_kernels_do_not_transfer_or_mutate_live_force_arrays(self):
        methods=['begin_mpm','after_gravity','after_p2g','after_grid','after_g2p','before_fem_drift','before_fem_kick','after_fem','before_contact','after_contact','before_heat','after_heat']
        for name in methods:
            tree=ast.parse(textwrap.dedent(inspect.getsource(getattr(MixedEnergy,name))))
            calls={n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)}
            self.assertFalse(calls&{'to_numpy','from_numpy','sync','request','send','receive','fem_force','fem_thermal_force'})


if __name__=='__main__':unittest.main()
