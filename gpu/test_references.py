"""Native CUDA verification of canonical references and region constraints."""
import json
import subprocess
import unittest
import numpy as np
import taichi as ti
from runtime import initialize
from project_solver import ProjectSolver
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class ReferenceTests(unittest.TestCase):
    def test_cuda_uses_same_material_selection_and_marker_joint_as_cpu(self):
        code="""
        import {referenceExample} from './src/simulation/reference-example.js';
        import {initialize} from './src/multibody/engine.js';
        import {CoupledSimulation} from './src/multibody/coupled.js';
        import {toLegacy} from './src/simulation/project.js';
        import {convertConnectionToReferences} from './src/simulation/references.js';
        await initialize();let project=referenceExample();
        project.parts.find(b=>b.id==='guide').geometry.rotation=[23,17,31];
        project.frames=[];delete project.connections[0].endpoints;
        project=convertConnectionToReferences(project,project.connections[0].id);
        const s=new CoupledSimulation(toLegacy(project));
        const pins=[];for(let i=0;i<s.particles.count;i++)if(s.particles.pinned[i])pins.push(i);
        console.log(JSON.stringify({project,pins}));s.free();
        """
        result=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
        data=json.loads(result.stdout.strip().splitlines()[-1])
        initialize('cuda')
        self.assertEqual(ti.lang.impl.current_cfg().arch,ti.cuda)
        solver=ProjectSolver()
        try:
            frame,points=solver.initialize(data['project'])
            pins=points[:,5]>.5
            self.assertEqual(np.flatnonzero(pins).tolist(),data['pins'])
            self.assertEqual(int(pins.sum()),48)
            original=points[pins,:3].copy()
            for _ in range(12):
                frame,points=solver.step(1/240)
            np.testing.assert_array_equal(points[pins,:3],original)
            self.assertTrue(np.isfinite(points).all())
            self.assertLess(frame['maxError'],.002)
            self.assertGreater(frame['time'],.049)
        finally:
            solver.close()

if __name__=='__main__':
    unittest.main()
