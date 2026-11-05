"""Reproduce request-partition sensitivity with the current CUDA integrator."""
import json
import argparse
import numpy as np
import subprocess
from pathlib import Path
from runtime import initialize
from project_solver import ProjectSolver

ROOT = Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--stage',choices=['before','after'],default='after')
args=parser.parse_args()
project = json.loads(subprocess.check_output(
    ['node', 'tests/material-contact-fixtures.mjs', '--projects'],
    cwd=ROOT, text=True, encoding='utf-8'))['demo']
backend = initialize('cuda')
solver = ProjectSolver()
rows = []
first_positions=None
try:
    for batch in [1/60, 1/60, 1/120]:
        solver.initialize(project)
        steps = []
        original = solver.native_substep
        def capture(h, *args):
            steps.append(h)
            return original(h, *args)
        solver.native_substep = capture
        while solver.time < 3-1e-9:
            frame, data = solver.step(min(batch, 3-solver.time))
        solver.native_substep = original
        if first_positions is None:first_positions=data[:,:3].copy()
        row = dict(batch=batch, steps=len(steps), min=min(steps), max=max(steps),
                   first=steps[:16], heat=frame['contactPairs'][0]['accumulatedHeat'],
                   position=data[0, :3].tolist(),clock=frame.get('clock'),
                   maxPositionDifferenceFromFirst=float(np.max(np.abs(data[:,:3]-first_positions))))
        rows.append(row)
        print(json.dumps(row), flush=True)
finally:
    solver.close()
    (ROOT/f'artifacts/v039-clock-gpu-{args.stage}.json').write_text(
        json.dumps(dict(backend=backend, rows=rows), indent=2), encoding='utf-8')
if args.stage=='after':
    assert len(rows)==3
    for row in rows[1:]:
        assert row['maxPositionDifferenceFromFirst']<1e-5
        assert abs(row['heat']-rows[0]['heat'])<.05
        assert row['steps']==rows[0]['steps'] and row['clock']['requestCuts']==0
