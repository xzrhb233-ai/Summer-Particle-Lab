import math
import time
import subprocess
import json
from pathlib import Path
import unittest
import numpy as np
import taichi as ti
from runtime import initialize
from solver import Solver, CAPACITY
from materials import enthalpy_at


class GpuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize()
        cls.s=Solver()

    def setUp(self):
        self.s.reset("empty")
        self.s.settings.update(gravity=False,thermal=False,stiffness=1.0,heatRate=20.0,ambient=False,pbfAntiClump=True)

    def seed(self,points,mat=11,model=0,temp=20):
        rows=np.array([[*p,mat,model,enthalpy_at(mat,temp),0,.025,35] for p in points],dtype=np.float32)
        self.s.insert(self.s.count,rows);self.s.count+=len(rows)

    def test_actual_cuda_backend(self):
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        self.assertEqual(self.backend["arch"],"cuda")

    def test_cpu_reference_agreement(self):
        reference=json.loads(subprocess.check_output(["node",str(Path(__file__).with_name("reference.mjs"))],text=True))
        self.s.settings["gravity"]=True
        for model in range(4):
            x,z=(-24 if model%2==0 else 24),(-24 if model<2 else 24)
            self.s.box([x-4,0,z-4],[x+4,8,z+4],model=model)
        for i in range(self.s.count):
            self.s.F[i]=[[.98,.1,0],[0,.95,0],[0,0,1.02]]
        for _ in range(12):
            self.s.step()
        np.testing.assert_allclose(self.s.x.to_numpy()[:self.s.count],reference["positions"],atol=.003,rtol=.001)
        np.testing.assert_allclose(self.s.jp.to_numpy()[:self.s.count],reference["jp"],atol=.002,rtol=.001)

    def test_empty_snapshot_and_profile(self):
        self.s.heat_total[None]=42;self.s.reset('empty')
        self.assertEqual(self.s.heat_total[None],0)
        self.s.step();meta,data=self.s.snapshot()
        self.assertEqual(meta["count"],0);self.assertEqual(data.shape,(0,8))
        self.assertEqual(meta["mass"],0);self.assertEqual(meta["heat"],0)
        p=meta["profile"]
        self.assertAlmostEqual(sum(v for k,v in p.items() if k!="total"),p["total"],places=4)

    def test_objective_stress_all_laws(self):
        c,s=math.cos(.7),math.sin(.7)
        R=np.array([[c,0,s],[0,1,0],[-s,0,c]],dtype=np.float32)
        F=np.array([[1.03,.02,0],[0,.97,0],[0,0,.99]],dtype=np.float32)
        self.seed([[0,0,0]])
        for model in range(12):
            self.s.model[0]=model;self.s.F[0]=R
            self.s.prepare(1,1)
            self.assertLess(np.max(np.abs(self.s.tau[0].to_numpy())),.003)
            self.s.F[0]=F;self.s.prepare(1,1);a=self.s.tau[0].to_numpy()
            self.s.F[0]=R@F;self.s.prepare(1,1);b=self.s.tau[0].to_numpy()
            np.testing.assert_allclose(b,R@a@R.T,atol=.003,rtol=.003)

    def test_uniform_translation_and_fluid_exclusion(self):
        self.s.box([-8,-8,-8],[8,8,8]);n=self.s.count
        velocity=np.zeros((CAPACITY,3),np.float32);velocity[:n]=[3,-2,7]
        self.s.v.from_numpy(velocity)
        self.seed([[35,0,0]],mat=2);self.s.v[n]=[0,0,13]
        self.s.prepare(self.s.count,1);self.s.clear_grid();self.s.p2g(self.s.count,.001)
        self.s.grid_step(0,64,0);self.s.g2p(self.s.count,.001)
        np.testing.assert_allclose(self.s.v.to_numpy()[:n],np.tile([3,-2,7],(n,1)),atol=2e-5)
        np.testing.assert_allclose(self.s.x[n].to_numpy(),[35,0,0])
        self.assertEqual(self.s.v[n][2],13)

    def test_heat_distance_conservation_and_phase(self):
        self.seed([[0,0,0]],mat=2,temp=80);self.seed([[0,0,20]],mat=2,temp=20)
        self.s.settings["thermal"]=True;self.s.nonuniform_heat=True
        initial=self.s.snapshot()[0]["energy"];self.s.step()
        self.assertEqual(self.s.temp[0],80);self.assertEqual(self.s.temp[1],20)
        self.s.x[1]=[0,0,5]
        for _ in range(30):
            self.s.step()
        self.assertLess(self.s.temp[0],80);self.assertGreater(self.s.temp[1],20)
        self.assertAlmostEqual(self.s.snapshot()[0]["energy"],initial,places=5)
        self.s.enthalpy[0]=enthalpy_at(4,-10)
        self.s.heat.fill(0);self.s.heat_apply(2,0,0)
        self.assertEqual(self.s.material[0],4)
        self.s.F[0]=np.eye(3,dtype=np.float32)*.8
        self.s.enthalpy[0]=enthalpy_at(2,20);self.s.heat_apply(2,0,0)
        self.assertEqual(self.s.material[0],2)
        np.testing.assert_allclose(self.s.F[0].to_numpy(),np.eye(3))

    def test_pbf_pressure_along_z(self):
        self.seed([[x,y,z] for z in range(-3,4,2) for y in [-1,1] for x in [-1,1]],mat=2)
        self.s.step();x=self.s.x.to_numpy()[:self.s.count]
        self.assertGreater(x[:,2].max(),3);self.assertGreater(x[:,0].max(),1)
        self.assertLess(abs(x[:,0].sum()),1e-4)

    def test_edit_history_capacity_and_reset(self):
        self.seed([[0,0,0],[8,0,0]],model=2)
        self.s.plastic[1]=.3;self.s.jp[1]=.8
        self.s.command(dict(type="brush",tool="erase",point=[0,0,0],radius=2))
        self.assertEqual(self.s.count,1);self.assertAlmostEqual(self.s.plastic[0],.3,places=6)
        self.assertAlmostEqual(self.s.jp[0],.8,places=6)
        self.s.command(dict(type="brush",tool="anchor",point=[8,0,0],radius=2))
        self.assertEqual(self.s.pinned[0],1)
        self.s.command(dict(type="brush",tool="release",point=[8,0,0],radius=2))
        self.assertEqual(self.s.pinned[0],0)
        self.s.count=CAPACITY-1;self.assertFalse(self.s.box([0,0,0],[8,8,8]));self.assertEqual(self.s.count,CAPACITY-1)
        self.s.reset();self.assertEqual(self.s.count,1807)

    def test_press_cycle_and_plastic_history(self):
        self.s.settings["gravity"]=True;self.s.reset("compression")
        initial=self.s.snapshot()[0]
        self.s.set_press(dict(target=-20,speed=16))
        peak=0
        for _ in range(180):
            self.s.step();peak=max(peak,self.s.press["force"])
        compressed,data=self.s.snapshot();self.assertGreater(peak,0);self.assertGreater(compressed["minJ"],0)
        self.assertLessEqual(data[:,1].max(),self.s.press["y"]-1.8+1e-4)
        self.assertGreater(data[:,7].max(),.02)
        self.assertTrue((data[:1078,7]==0).all())
        top=data[:539,1].max();plastic=data[:,7].copy();rebound=False
        self.s.set_press(dict(target=40,speed=20))
        for _ in range(180):
            self.s.step()
            if self.s.x.to_numpy()[:539,1].max()>top+1:
                rebound=True
        after,data=self.s.snapshot();self.assertTrue(rebound)
        self.assertTrue((data[:,7]>=plastic-1e-6).all())
        self.assertAlmostEqual(after["mass"],initial["mass"],places=4)
        self.assertAlmostEqual(after["energy"],initial["energy"],places=3)
        self.assertGreater(self.s.time,5.99);self.assertGreater(after["minJ"],0)

    def test_large_and_mixed_remain_finite(self):
        self.s.settings.update(gravity=True,thermal=True)
        for scene,frames in [("large",120),("coupled",180)]:
            self.s.reset(scene);initial=self.s.snapshot()[0]
            for _ in range(frames):
                self.s.step()
            final,data=self.s.snapshot()
            self.assertEqual(final["count"],initial["count"])
            self.assertGreater(final["minJ"],0)
            self.assertLess(abs(final["mass"]-initial["mass"]),.01)
            self.assertLess(abs(final["energy"]-initial["energy"]),.1)
            self.assertTrue(np.isfinite(data).all())


    def test_custom_phase_brush_cycle(self):
        s=self.s;phase=dict(enabled=True,meltingPoint=120,latentHeat=120000)
        self.assertTrue(s.box([-4,0,-4],[4,8,4],temperature=110,model=10,phaseChange=phase))
        point=s.x[0].to_numpy().tolist();m=float(s.mass[0]);h=float(s.enthalpy[0]);s.pinned[0]=1;s.inv_mass[0]=0
        s.F[0]=[[1.2,0,0],[0,1,0],[0,0,1]];s.C[0]=np.ones((3,3));s.plastic[0]=.4
        strokes=0
        while not s.melted[0] and strokes<20:
            s.command(dict(type='brush',tool='heat',point=point,radius=.01));strokes+=1
        self.assertEqual(s.melted[0],1);self.assertEqual(s.model[0],10);self.assertEqual(s.pinned[0],0)
        np.testing.assert_allclose(s.F[0].to_numpy(),np.eye(3));np.testing.assert_allclose(s.C[0].to_numpy(),0)
        self.assertEqual(s.plastic[0],0);self.assertAlmostEqual(m*(float(s.enthalpy[0])-h),strokes*500000/30,places=4)
        strokes=0
        while s.melted[0] and strokes<30:
            s.command(dict(type='brush',tool='cool',point=point,radius=.01));strokes+=1
        self.assertEqual(s.melted[0],0);self.assertEqual(s.model[0],10);self.assertEqual(float(s.mass[0]),m)
        np.testing.assert_allclose(s.F[0].to_numpy(),np.eye(3))

    def test_pbf_anti_clumping_pair_and_exclusions(self):
        s=self.s
        for second,temp in [(1,1250),(2,20),(3,130),(4,-12),(11,20)]:
            s.reset('empty');self.seed([[-1,0,0]],mat=2);self.seed([[1,0,0]],mat=second,temp=temp)
            before=s.snapshot()[0];s.step();after,data=s.snapshot()
            if second in (1,2):self.assertGreater(float(data[1,0]-data[0,0]),2.05)
            else:self.assertAlmostEqual(float(data[1,0]-data[0,0]),2,places=5)
            momentum=s.mass[0]*s.v[0][0]+s.mass[1]*s.v[1][0]
            self.assertLess(abs(momentum),1e-4);self.assertEqual(before['energy'],after['energy'])
        s.reset('empty');self.seed([[-1,0,0],[1,0,0]],mat=2);s.command(dict(type='settings',value=dict(pbfAntiClump=False)));s.step()
        self.assertAlmostEqual(float(s.x[1][0]-s.x[0][0]),2,places=6)

    def test_custom_liquid_pbf_and_cpu_agreement(self):
        s=self.s;s.box([-4,0,-4],[4,8,4],temperature=180,model=11,phaseChange=dict(enabled=True))
        self.assertEqual(s.snapshot()[0]['liquids'],27)
        for i in range(s.count):
            x=s.x[i].to_numpy();x[0]*=.4;x[2]*=.4;x[1]=4+(x[1]-4)*.4;s.x[i]=x
        s.prepare(s.count,1);s.clear_grid();s.p2g(s.count,.001)
        self.assertEqual(float(s.gmass.to_numpy().sum()),0)
        before=s.snapshot()[0];s.step();after,data=s.snapshot()
        self.assertTrue(np.isfinite(data).all());self.assertTrue((data[:,3]==23).all());self.assertTrue((data[:,6:]==0).all())
        self.assertGreater(float(np.ptp(data[:,0])),3.2);self.assertAlmostEqual(before['energy'],after['energy'],places=5)
        script="""import {Simulation3} from './src/three/simulation.js';const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;s.box([-4,0,-4],[4,8,4],11,false,180,11,.025,35,'box','',[0,0,0],{},{},{},{},{enabled:true});for(let i=0;i<s.count;i++){s.x[i]*=.4;s.z[i]*=.4;s.y[i]=4+(s.y[i]-4)*.4;}s.step();console.log(JSON.stringify(Array.from(s.snapshot().data)));"""
        reference=np.array(json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=Path(__file__).resolve().parent.parent,text=True))).reshape(-1,8)
        np.testing.assert_allclose(data[:,:3],reference[:,:3],atol=.003,rtol=.001)

    def test_custom_phase_contact_heat_conservation(self):
        s=self.s
        for x,temp in [(0,110),(5,500)]:s.box([x,0,0],[x+4,4,4],temperature=temp,phaseChange=dict(enabled=True))
        before=s.snapshot()[0]
        for _ in range(30):
            s.clear_neighbors();s.build_neighbors(s.count);s.heat_budget(s.count,1,1000);s.heat_exchange(s.count,1,1000);s.heat_apply(s.count,1,0)
        after,_=s.snapshot();self.assertEqual(after['liquids'],s.count)
        self.assertAlmostEqual(after['energy'],before['energy'],places=4);self.assertEqual(after['mass'],before['mass'])

    def compact_melt(self,velocity=(0,0,0),partial=False):
        s=self.s
        s.box([-8,-8,-8],[8,8,8],temperature=20,model=10,velocity=list(velocity),sampling=dict(enabled=True,strength=.2,seed=42),phaseChange=dict(enabled=True))
        for i in range(s.count):s.x[i]=s.x[i].to_numpy()*.65
        s.initialize_phase(0,s.count//2 if partial else s.count,180)

    def test_phase_handoff_no_kinetic_kick_and_cpu_agreement(self):
        s=self.s
        for dt in [1/120,1/240,1/1200]:
            s.reset('empty');self.compact_melt((3,-2,1));before=s.snapshot()[0]
            x=s.x.to_numpy()[:s.count].copy()
            for _ in range(round(.1/dt)):s.step(dt)
            v=s.v.to_numpy()[:s.count]
            self.assertLess(np.linalg.norm(v-[3,-2,1],axis=1).max(),.03)
            displacement=s.x.to_numpy()[:s.count]-x-[.3,-.2,.1]
            self.assertLess(np.linalg.norm(displacement,axis=1).max(),.801)
            np.testing.assert_allclose(displacement.mean(axis=0),0,atol=.001)
            self.assertEqual(s.snapshot()[0]['energy'],before['energy'])
            self.assertEqual(s.snapshot()[0]['mass'],before['mass'])
        # Same pre-advection baseline and bounded relaxation on CPU and CUDA.
        s.reset('empty');self.compact_melt((3,-2,1));s.step(.1)
        script="""import {Simulation3} from './src/three/simulation.js';const s=new Simulation3();s.setSettings({gravity:false,thermal:false});s.box([-8,-8,-8],[8,8,8],11,false,20,10,.025,35,'box','',[3,-2,1],{},{enabled:true,strength:.2,seed:42},{},{},{enabled:true});for(let i=0;i<s.count;i++){s.x[i]*=.65;s.y[i]*=.65;s.z[i]*=.65;s.enthalpy[i]=444000;s.phaseTransition(i);}s.step(.1);console.log(JSON.stringify(Array.from(s.snapshot().data)));"""
        reference=np.array(json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=Path(__file__).resolve().parent.parent,text=True))).reshape(-1,8)
        np.testing.assert_allclose(s.snapshot()[1][:,:3],reference[:,:3],atol=.003,rtol=.001)

    def test_phase_handoff_opposes_new_compression_without_energy_overshoot(self):
        s=self.s;self.compact_melt()
        for i in range(s.count):s.v[i]=-2*s.x[i].to_numpy()
        masses=s.mass.to_numpy()[:s.count,None];v=s.v.to_numpy()[:s.count]
        energy=float((masses*v*v).sum());momentum=(masses*v).sum(axis=0)
        s.step(1/240);v=s.v.to_numpy()[:s.count]
        self.assertLess(float((masses*v*v).sum()),energy*.5)
        np.testing.assert_allclose((masses*v).sum(axis=0),momentum,atol=.01)

    def test_phase_handoff_partial_melt_and_wall(self):
        s=self.s;self.compact_melt((3,-2,1),partial=True);s.step(1/240)
        self.assertGreater(s.snapshot()[0]['solids'],0)
        self.assertLess(np.linalg.norm(s.v.to_numpy()[:s.count]-[3,-2,1],axis=1).max(),.01)
        s.reset('empty');self.compact_melt()
        for i in range(s.count):
            x=s.x[i].to_numpy();x[1]=-47+(x[1]+5.2)*.1;s.x[i]=x
        s.step(1/240)
        self.assertLess(np.linalg.norm(s.v.to_numpy()[:s.count],axis=1).max(),.01)
        self.assertGreaterEqual(s.x.to_numpy()[:s.count,1].min(),-47)

    def test_custom_phase_validation_and_preset(self):
        s=self.s
        for invalid in [[],dict(enabled=1),dict(latentHeat=0),dict(meltingPoint=float('nan')),dict(unknown=1)]:
            self.assertFalse(s.box([0,0,0],[4,4,4],phaseChange=invalid));self.assertEqual(s.count,0);self.assertEqual(s.lab.next_id,1)
        s.reset('melting');state,_=s.snapshot();self.assertEqual(state['solids'],1078);self.assertEqual(state['liquids'],1078)
        self.assertEqual(state['models'][10],539);self.assertEqual(state['models'][11],539)
        s.reset('empty');s.box([0,0,0],[4,4,4],temperature=180,model=11,phaseChange=dict(enabled=True))
        s.box([20,0,0],[24,4,4],temperature=20,model=10,phaseChange=dict(enabled=True,meltingPoint=80))
        s.count=s.erase_kernel(s.count,[0,0,0],.01);self.assertEqual(s.melted[0],0);self.assertEqual(s.model[0],10);self.assertEqual(s.lab.part[0],2)
        s.reset('empty');self.seed([[0,0,0]],temp=180);self.assertEqual(s.melted[0],0)


if __name__=="__main__":
    unittest.main(verbosity=2)
