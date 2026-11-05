"""CUDA regressions for unified PBF transport and irreversible MPM damage."""
import json,subprocess,unittest
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver,ROOT

@ti.kernel
def fracture_trial(s:ti.template(),strain:ti.f32):
    F=ti.Matrix.identity(ti.f32,3);F[0,0]=ti.exp(strain)
    s.F[0]=s.project(0,F,1/480)

@ti.kernel
def compress_water(s:ti.template(),n:ti.i32):
    for i in range(n):
        s.x[i]*=.65
        s.old[i]=s.x[i]-ti.Vector([.03*ti.sin(i+1.)]*3)

@ti.kernel
def pressure_state(s:ti.template(),n:ti.i32,out:ti.types.ndarray(dtype=ti.f32,ndim=2)):
    for i in range(n):
        for a in ti.static(range(3)):
            out[i,a]=s.x[i][a];out[i,a+3]=s.old[i][a]

@ti.kernel
def tire_surface(s:ti.template(),out:ti.types.ndarray(dtype=ti.f32,ndim=1)):
    center=ti.Vector([0.,0.,0.]);q=ti.Vector([0.,0.,0.,1.]);half=ti.Vector([.62,.62,.06])
    d,n=s.surface(ti.Vector([0.,0.,0.]),4,center,q,half);out[0]=d
    d,n=s.surface(ti.Vector([.7,0.,0.]),4,center,q,half);out[1]=d
    d,n=s.surface(ti.Vector([.5,0.,0.]),4,center,q,half);out[2]=n[0]

class CourseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):initialize('cuda');cls.s=ProjectSolver()
    @classmethod
    def tearDownClass(cls):cls.s.close()
    def test_pbf_native_advection_and_unchanged_mass(self):
        code="import {fromLegacy} from './src/simulation/project.js'; console.log(JSON.stringify(fromLegacy({schema:'summer-mbd/1',gravity:[0,0,0],bodies:[{id:'floor',type:'fixed',shape:'box',size:[2,.1,2],position:[0,-1,0]}],joints:[],coupling:{enabled:true,thermal:false,parts:[{id:'water',method:'pbf',center:[0,1,0],size:[.4,.4,.4],density:500,model:0,velocity:[.2,0,0]}]}})));"
        p=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT,text=True,encoding='utf-8'))
        first,_=self.s.initialize(p)
        self.assertEqual(first['coupling']['mass'],32.)
        np.testing.assert_array_equal(self.s.s.fluid_transition.to_numpy()[:64],0)
        for _ in range(6):f,a=self.s.step(1/30)
        self.assertEqual(f['coupling']['liquids'],64);self.assertEqual(f['coupling']['solids'],0)
        self.assertEqual(f['coupling']['mass'],first['coupling']['mass']);self.assertTrue(np.isfinite(a).all())
        v=f['results']['parts'][-1]['values'];self.assertAlmostEqual(v['displacement'][0],.04,delta=.002)
        self.assertAlmostEqual(v['velocity'][0],.2,delta=.01)
    def test_damage_does_not_create_momentum_or_heal(self):
        s=self.s.s;s.reset('empty');s.create_geometry(dict(center=[0,0,0],size=[4,4,4],model=0))
        s.fracture_materials[1]=[1,.04,.1];s.v[0]=[2,3,4];m=float(s.mass[0])
        fracture_trial(s,.07);self.assertAlmostEqual(float(s.damage[0]),.5,delta=1e-4)
        fracture_trial(s,0.);self.assertAlmostEqual(float(s.damage[0]),.5,delta=1e-4)
        fracture_trial(s,.11);self.assertEqual(float(s.damage[0]),1.);self.assertEqual(int(s.model[0]),3)
        self.assertEqual(float(s.mass[0]),m);np.testing.assert_array_equal(s.v[0],[2,3,4])
        s.prepare(s.count,24);self.assertAlmostEqual(float(s.stress[0]),0,delta=1e-4)

    def test_rigid_coupling_density_repair_without_pressure_energy(self):
        s=self.s.s;s.reset('empty');s.create_geometry(dict(center=[0,0,0],size=[12]*3,material=2,sampling=dict(enabled=False)))
        compress_water(s,s.count);before=np.empty((s.count,6),np.float32);pressure_state(s,s.count,before)
        s.prepare(s.count,1);s.clear_neighbors();s.build_neighbors(s.count);s.density(s.count);s.corrections(s.count,1,1/480,3,1)
        self.s.stabilize_pressure(s.count,1/480);s.apply_corrections(s.count,1,0,0.,0)
        after=np.empty_like(before);pressure_state(s,s.count,after)
        a=(before[:,:3]-before[:,3:]).astype(float);b=(after[:,:3]-after[:,3:]).astype(float)
        self.assertLessEqual(np.sum(b*b),np.sum(a*a)+1e-5)
        np.testing.assert_allclose(a.sum(axis=0),b.sum(axis=0),atol=2e-5)
        self.assertGreater(np.ptp(after[:,0]),np.ptp(before[:,0]))

    def test_hollow_tire_native_contact(self):
        out=np.empty(3,np.float32);tire_surface(self.s,out)
        np.testing.assert_allclose(out,[.5,.08,-1.],atol=1e-6)

if __name__=='__main__':unittest.main()
