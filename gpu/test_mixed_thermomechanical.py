"""CUDA physics and time-program checks for v0.49 (no mesh refinement)."""
import copy,json,unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from benchmark_mixed import compile_project
from mixed_solver import MixedSolver
from mixed_program import DeviceCurve

@ti.kernel
def project_trial(s:ti.template(),F:ti.types.matrix(3,3,ti.f32),T:ti.f32,dt:ti.f32):
    for i in range(s.n):
        s.s.temp[i]=T;s.s.enthalpy[i]=ti.cast(T,ti.f64)*1800
        s.s.F[i]=s.s.project(i,F,dt)

@ti.kernel
def curve_samples(c:ti.template(),out:ti.types.ndarray(dtype=ti.f64,ndim=2)):
    for i in range(11):
        t=i*.2;out[i,0]=c.value(t);out[i,1]=c.integral(0,t)

class ThermomechanicalChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda')
        cls.base=json.loads((Path(__file__).resolve().parent.parent/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))
    def make(self,model=10):
        p=copy.deepcopy(self.base);m=p['parts'][1]['material'];m['model']=model
        m['thermomechanical']=dict(expansion=.0002,referenceTemperature=20,hotStiffnessRatio=.35)
        p['parts'][1]['initial'].update(temperature=20,velocity=[0,0,0]);p['parts'][0]['material']['expansion']=1e-5
        return MixedSolver(compile_project(project=p))

    def test_free_thermal_stretch_and_fixed_thermal_stress(self):
        s=self.make(1);a=np.exp(.0002*120)
        project_trial(s,np.eye(3,dtype=np.float32)*a,140.,0.);s.s.prepare(s.n,s.stiffness)
        self.assertLess(np.max(np.abs(s.s.tau.to_numpy())),.003)
        project_trial(s,np.eye(3,dtype=np.float32),140.,0.);s.s.prepare(s.n,s.stiffness)
        tau=s.s.tau.to_numpy();self.assertTrue(np.all(np.diagonal(tau,axis1=1,axis2=2)<0))
        E0=float(s.s.mass.to_numpy()[0]/(64*s.s.volume.to_numpy()[0])*16000*s.stiffness)
        ratio=1-(1-.35)*(140-20)/(180-20);expected=.4*E0*ratio*(1/a**2-1+np.log(1/a**3))
        np.testing.assert_allclose(np.diagonal(tau,axis1=1,axis2=2),expected,rtol=2e-5)
        project_trial(s,np.eye(3,dtype=np.float32),20.,0.);s.s.prepare(s.n,s.stiffness)
        self.assertLess(np.max(np.abs(s.s.tau.to_numpy())),.003)

    def test_hot_J2_plasticity_survives_cooling_and_failed_interval(self):
        s=self.make();F=np.diag([1.08,1/np.sqrt(1.08),1/np.sqrt(1.08)]).astype(np.float32)
        project_trial(s,F,20.,.001);cold=s.s.plastic.to_numpy().copy();s.s.plastic.fill(0)
        project_trial(s,F,180.,.001);hot=s.s.plastic.to_numpy().copy();self.assertGreater(float(hot.mean()),float(cold.mean()))
        oldF=s.s.F.to_numpy().copy();s.s.temp.fill(20);s.s.enthalpy.fill(20*1800);s.s.prepare(s.n,s.stiffness)
        np.testing.assert_array_equal(s.s.F.to_numpy(),oldF);np.testing.assert_array_equal(s.s.plastic.to_numpy(),hot)
        original=s.check_status
        def fail():raise ValueError('rollback')
        s.check_status=fail
        with self.assertRaisesRegex(ValueError,'rollback'):s.step(.001)
        np.testing.assert_array_equal(s.s.F.to_numpy(),oldF);np.testing.assert_array_equal(s.s.plastic.to_numpy(),hot)
        self.assertEqual(float(s.device_time[None]),0.);self.assertEqual(s.time,0.);s.check_status=original

    def test_hot_creep_increases_and_return_is_isochoric(self):
        s=self.make(11);F=np.diag([1.04,.98,1/(1.04*.98)]).astype(np.float32)
        project_trial(s,F,20.,.001);cold=float(s.s.plastic.to_numpy().mean());s.s.plastic.fill(0)
        project_trial(s,F,180.,.001);hot=float(s.s.plastic.to_numpy().mean())
        self.assertGreater(hot,cold);np.testing.assert_allclose(np.linalg.det(s.s.F.to_numpy()),1,atol=3e-6)

    def test_fem_thermal_force_matches_3d_free_expansion(self):
        s=self.make(0);s.temperature.fill(120);s.fem_thermal_force()
        # u=alpha*dT*X gives strain alpha*dT I; Ku equals the thermal force.
        s.u.from_numpy(s.nodes.to_numpy()*(1e-5*100));s.fem_force()
        np.testing.assert_allclose(s.internal.to_numpy(),s.fthermal.to_numpy(),atol=1e-8,rtol=1e-8)
        self.assertGreater(np.max(np.abs(s.fthermal.to_numpy())),0)
        s.temperature.fill(20);s.fem_thermal_force();np.testing.assert_array_equal(s.fthermal.to_numpy(),0)

    def test_device_curves_integrate_and_hold_endpoints(self):
        out=np.empty((11,2),np.float64)
        for kind in ['linear','smooth','step']:
            c=DeviceCurve(dict(type=kind,points=[[0,0],[1,2],[2,2]]));curve_samples(c,out)
            self.assertAlmostEqual(out[-1,1],2 if kind=='step' else 3,places=10)
            x=.4;expected=0 if kind=='step' else 2*x if kind=='linear' else 2*x*x*(3-2*x)
            self.assertAlmostEqual(out[2,0],expected,places=6);self.assertEqual(out[-1,0],2)

    def test_fixed_face_removes_initial_velocity_and_retains_position(self):
        p=copy.deepcopy(self.base);p['parts'][1]['boundary']['fixedFace']='minY';p['parts'][1]['initial']['velocity']=[.1,0,0]
        s=MixedSolver(compile_project(project=p));fixed=s.s.pinned.to_numpy().astype(bool);x=s.s.x.to_numpy().copy()
        self.assertTrue(np.any(fixed));self.assertTrue(np.any(~fixed))
        np.testing.assert_array_equal(s.s.v.to_numpy()[fixed],0);np.testing.assert_array_equal(s.s.inv_mass.to_numpy()[fixed],0)
        self.assertGreater(np.max(np.abs(s.s.v.to_numpy()[~fixed])),0)
        s.step(.0001);np.testing.assert_array_equal(s.s.x.to_numpy()[fixed],x[fixed]);np.testing.assert_array_equal(s.s.v.to_numpy()[fixed],0)

if __name__=='__main__':unittest.main()
