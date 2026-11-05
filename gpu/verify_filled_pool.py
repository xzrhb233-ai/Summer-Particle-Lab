"""Validate settled water height and stability in a native filled-pool run."""
import json
import sys
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parent.parent
path=Path(sys.argv[1]) if len(sys.argv)>1 else root/'artifacts/filled-pool-check.json'
tape=json.loads(path.read_text(encoding='utf-8'));frames=tape['frames']
assert frames[-1]['time']>=3-1e-8
counts=[p['values']['count'] for p in frames[0]['results']['parts'] if p['method']!='rigid']
water=slice(counts[0],counts[0]+counts[1]);initial=np.array(frames[0]['particles']).reshape(-1,8)
mass=frames[0]['coupling']['mass'];min_height=float('inf');max_error=0
for f in frames:
    a=np.array(f['particles']).reshape(-1,8)
    assert a.shape==initial.shape and np.isfinite(a).all()
    assert abs(f['coupling']['mass']-mass)<1e-6
    np.testing.assert_array_equal(a[initial[:,5]>.5,:3],initial[initial[:,5]>.5,:3])
    assert f['coupling']['liquids']==counts[1]
    assert f['results']['parts'][-1]['values']['failed']==0,'End wall failed under water loading'
    if f['time']>=1-1e-8:
        height=float(np.quantile(a[water,1],.95));min_height=min(min_height,height)
        assert height>.62,'Settled water dropped below half-wheel height'
    max_error=max(max_error,f['maxError'])
assert max_error<.002
summary=dict(duration=frames[-1]['time'],particles=sum(counts),water_particles=counts[1],
             minimum_settled_water_y95=min_height,wheel_axle_height=.62,
             end_wall_failed=0,max_constraint_error=max_error,mass=mass)
print(json.dumps(summary,indent=2))
(root/'artifacts/filled-water-verification.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
