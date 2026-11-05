"""Regression for explicit contact deltas coexisting with APIC region constraints."""
import json
import subprocess
import unittest
from pathlib import Path
import numpy as np
from runtime import initialize
from project_solver import ProjectSolver

ROOT = Path(__file__).resolve().parent.parent

class PairRegionTests(unittest.TestCase):
    def test_attached_material_remains_bound(self):
        initialize('cuda')
        projects = json.loads(subprocess.check_output(
            ['node', 'tests/gpu-pair-fixtures.mjs', '--pair-projects'],
            cwd=ROOT, text=True, encoding='utf-8'))
        solver = ProjectSolver()
        try:
            solver.initialize(projects['attached'])
            for _ in range(6):
                frame, particles = solver.step(1/60)
                self.assertTrue(np.isfinite(particles).all())
                self.assertLess(frame['maxError'], .002)
            pair = frame['contactPairs'][0]
            self.assertEqual(pair['heat'], 0)
            self.assertTrue(all(np.isfinite(pair['force'])))
            regions = [j for j in frame['joints'] if j['id'] in ['left-grip', 'right-grip']]
            self.assertEqual(len(regions), 2)
            for region in regions:
                self.assertTrue(all(np.isfinite(region['force'])))
                self.assertLess(region['error'], .002)
        finally:
            solver.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
