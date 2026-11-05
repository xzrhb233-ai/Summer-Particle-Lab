"""Native CUDA checks and a reproducible CPU comparison; no mocked physics."""
import copy
import json
import subprocess
import time
import unittest
from pathlib import Path
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver, L

ROOT = Path(__file__).resolve().parent.parent

def fixtures(flag):
    return json.loads(subprocess.check_output(
        ['node', 'tests/gpu-region-fixtures.mjs', flag], cwd=ROOT, text=True, encoding='utf-8'))

class RegionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=initialize('cuda');cls.s=ProjectSolver();cls.projects=fixtures('--projects')
    @classmethod
    def tearDownClass(cls):cls.s.close()

    def test_01_actual_cuda_grid_momentum_and_work(self):
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        s=self.s;s.initialize(self.projects['bind']);r=s.regions;g=s.s;dt=1/480
        g.prepare(g.count,s.model['coupling']['stiffness'])
        g.clear_grid();g.p2g(g.count,dt);g.grid_step(0,0.,0.)
        def balance():
            mass=g.gmass.to_numpy().astype(float);idx=np.argwhere(mass>1e-12)
            m=mass[tuple(idx.T)];v=g.gv.to_numpy()[tuple(idx.T)].astype(float)*L
            pos=(np.array(g.mpm_origin[None])+idx*float(g.mpm_h[None]))*L
            P=np.sum(m[:,None]*v,axis=0);H=np.cross(pos,m[:,None]*v).sum(axis=0);K=.5*np.sum(m*np.sum(v*v,axis=1))
            b=r.body.to_numpy()[0].astype(float);I=np.linalg.inv(b[18:27].reshape(3,3))
            P+=b[11:14]/b[17];H+=np.cross(b[1:4],b[11:14]/b[17])+I@b[14:17]
            K+=.5*np.dot(b[11:14],b[11:14])/b[17]+.5*np.dot(b[14:17],I@b[14:17])
            return P,H,K
        before=balance();r.begin(1);r.prepare(r.count,len(r.definitions));r.solve(r.count,12,dt,g.domain['spacing']*L);after=balance()
        np.testing.assert_allclose(after[0],before[0],rtol=3e-5,atol=1e-5)
        np.testing.assert_allclose(after[1],before[1],rtol=3e-5,atol=1e-5)
        self.assertLessEqual(after[2],before[2]+1e-6)
        self.assertAlmostEqual(after[2]-before[2],r.stats.to_numpy()[0,6],delta=2e-5)
        self.assertGreater(r.body.to_numpy()[0,11],.01)

    def test_02_slide_and_high_stiffness_elastic(self):
        for name in ['slide','elastic']:
            with self.subTest(mode=name):
                s=self.s;s.initialize(self.projects[name])
                for _ in range(6):f,p=s.step(1/60)
                j=f['joints'][0]
                self.assertTrue(np.isfinite(p).all());self.assertLess(abs(j['work']),5)
                if name=='slide':
                    self.assertLess(abs(j['force'][0]),1e-5);self.assertLess(abs(f['bodies'][0]['velocity'][0]),1e-7)
                else:self.assertLess(j['error'],.002);self.assertTrue(np.isfinite(j['elasticEnergy']))

    def test_03_rejected_selection_preserves_state(self):
        s=self.s;s.initialize(self.projects['twist']);before,points=s.step(1/60)
        for kind in ['empty','overlap','fixed','phase','fracture']:
            p=copy.deepcopy(self.projects['twist'])
            if kind=='empty':p['selectionSets'][0]['region']={'type':'box','lower':[10,10,10],'upper':[11,11,11]}
            if kind=='overlap':p['connections'][2]['endpoints']['b']['selection']='left-end'
            if kind=='fixed':p['loads'].append(dict(id='pin',type='fixed-selection',target='specimen',selection='left-end'))
            if kind in ['phase','fracture']:
                part=next(b for b in p['parts'] if b['method']=='mpm')
                part['material']['phaseChange' if kind=='phase' else 'fracture']['enabled']=True
                if kind=='phase':part['initial']['temperature']=200
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError):s.initialize(p)
                after,a=s.snapshot();self.assertEqual(before['time'],after['time']);np.testing.assert_array_equal(a,points)

    def test_03b_contacts_exclude_own_members_only(self):
        p=copy.deepcopy(self.projects['bind']);p['couplings'][0]['mechanical']=True
        body=next(b for b in p['parts'] if b['method']=='rigid')
        body['geometry'].update(center=[0,1,0],rotation=[0,0,0],size=[1.4,.4,.4])
        intruder=copy.deepcopy(body);intruder['id']='intruder';intruder['geometry'].update(center=[0,1.8,0],size=[.2,.2,.2])
        p['parts'].append(intruder)
        s=self.s;s.initialize(p);g=s.s;r=s.regions
        g.prepare(g.count,2);g.clear_grid();g.p2g(g.count,1/480);g.grid_step(0,0.,0.)
        r.begin(1);r.mark_contacts(g.count,2,g.domain['spacing']*L*.6)
        self.assertEqual(r.contact_count[None],0)  # all points inside own clamp
        # Move the other collider into contact, as can occur after a physical step.
        bodies=r.body.to_numpy();bodies[1,1:4]=[0,1.17,0];bodies[1,11:14]=[0,-1,0]
        r.body.from_numpy(bodies);r.mark_contacts(g.count,2,g.domain['spacing']*L*.6)
        self.assertGreater(r.contact_count[None],0)
        r.contact(2,.5);reaction=r.reaction.to_numpy()
        self.assertGreater(np.linalg.norm(reaction[1,2]),.001)
        np.testing.assert_array_equal(reaction[0,2],np.zeros(3))

    def test_03c_mixed_fluid_packets_and_fixed_points(self):
        p=copy.deepcopy(self.projects['twist']);template=next(b for b in p['parts'] if b['method']=='mpm')
        fluid=copy.deepcopy(template);fluid.update(id='water',name='water',method='pbf')
        fluid['geometry'].update(center=[0,.4,.4],size=[.2,.2,.2]);fluid['material']['density']=1000
        fixed=copy.deepcopy(template);fixed.update(id='fixed',name='fixed')
        fixed['geometry'].update(center=[0,.4,-.4],size=[.2,.2,.2]);fixed['boundary']['fixedFace']='minY'
        p['parts'].extend([fluid,fixed])
        s=self.s;f,initial=s.initialize(p);pins=initial[:,5]>.5
        self.assertGreater(pins.sum(),0);self.assertEqual(s.regions.fluid_count,64)
        steps=0
        for _ in range(3):
            f,data=s.step(1/60);steps+=f['performance']['substeps']
        self.assertTrue(np.isfinite(data).all());np.testing.assert_array_equal(data[pins,:3],initial[pins,:3])
        self.assertEqual(f['coupling']['liquids'],64)
        self.assertEqual(f['performance']['ipcPayloadBytes'],steps*(3*40+64*14)*4)

    def test_04_cpu_alignment_and_payload(self):
        cpu=fixtures('--cpu');report=dict(backend=self.backend,dt=1/480,duration=.2,cases={})
        for name in ['stretch','twist','large']:
            with self.subTest(case=name):
                s=self.s;s.initialize(self.projects[name]);s.step(1/60)  # compile/warm up
                f,initial=s.initialize(self.projects[name]);trace=[];steps=0;start=time.perf_counter()
                for _ in range(12):
                    f,p=s.step(1/60);steps+=f['performance']['substeps']
                    trace.append(dict(time=f['time'],coordinate=f['joints'][0]['coordinate'],region=next(j for j in f['joints'] if j['id']=='right-grip')))
                ms=(time.perf_counter()-start)*1000;expected=cpu[name]
                self.assertTrue(np.isfinite(p).all());self.assertEqual(len(p),expected['count'])
                self.assertLess(max(t['region']['error'] for t in trace),.002)
                coord_error=max(abs(a['coordinate']-b['coordinate']) for a,b in zip(trace,expected['trace']))
                reference=np.array(expected['particles']).reshape(-1,8)
                position_error=float(np.linalg.norm(p[:,:3]-reference[:,:3],axis=1).max())
                self.assertLess(coord_error,.005);self.assertLess(position_error,.003)
                force_error=max(float(np.linalg.norm(np.array(a['region']['force'])-b['region']['force'])) for a,b in zip(trace,expected['trace']))
                torque_error=max(float(np.linalg.norm(np.array(a['region']['torque'])-b['region']['torque'])) for a,b in zip(trace,expected['trace']))
                # f32 GPU stress/transfer can amplify tiny position differences
                # into forces. Compare at the load scale, including an absolute
                # floor for near-zero components, not at relative zero.
                force_scale=max(np.linalg.norm(t['region']['force']) for t in expected['trace'])
                torque_scale=max(np.linalg.norm(t['region']['torque']) for t in expected['trace'])
                # Compare the whole wrench on a shared length scale (half the
                # specimen length); a tensile specimen has nearly zero torque.
                # Contact-node ordering and f32 accumulation differ from CPU.
                self.assertLess(force_error,.03+.01*max(force_scale,torque_scale/.6))
                self.assertLess(torque_error,.005+.01*max(torque_scale,force_scale*.6))
                self.assertGreater(np.linalg.norm(trace[-1]['region']['torque' if name!='stretch' else 'force']),.01)
                self.assertEqual(f['performance']['couplingPath'],'gpu-regions')
                self.assertEqual(f['performance']['ipcPayloadBytes'],steps*len(f['bodies'])*40*4)
                self.assertEqual(f['performance']['ipcRequests'],steps+13)
                report['cases'][name]=dict(count=len(p),cpuMs=expected['ms'],gpuMs=ms,speedup=expected['ms']/ms,
                    substeps=steps,coordinateMaxDifference=coord_error,particleMaxDifference=position_error,
                    forceMaxDifference=force_error,torqueMaxDifference=torque_error,
                    ipcPayloadBytes=f['performance']['ipcPayloadBytes'],trace=trace,cpuTrace=expected['trace'])
                print(name,report['cases'][name]|{'trace':'omitted','cpuTrace':'omitted'},flush=True)
        (ROOT/'artifacts/gpu-regions-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':unittest.main(verbosity=2)
