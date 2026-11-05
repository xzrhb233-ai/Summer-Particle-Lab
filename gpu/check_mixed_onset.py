"""Resolve the near-touch impulse mismatch at t=0.15 to the shared timestep."""
import json
from benchmark_mixed import compile_project,ROOT
from mixed_solver import MixedSolver
from runtime import initialize
p=json.loads((ROOT/'tests/fixtures/mixed-gpu-reference.json').read_text(encoding='utf-8'))
initialize('cuda');s=MixedSolver(compile_project(project=p));s.step(.149,emit=False);rows=[]
while s.time<.153-1e-9:
    f,_=s.step(.0002);rows.append(dict(time=f['time'],impulse=f['contactPairs'][0]['totalImpulse']))
(ROOT/'artifacts/mixed-v047-cuda-onset.json').write_text(json.dumps(dict(rows=rows),indent=2),encoding='utf-8')
print(rows)
