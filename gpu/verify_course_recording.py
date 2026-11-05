"""Check observable stage outcomes in the actual CUDA course recording."""
import json
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parent.parent
tape=json.loads((root/'artifacts/course-replay.json').read_text(encoding='utf-8'))
frames=tape['frames'];parts=tape['project']['parts'];wall=next(p for p in parts if p['id']=='breakable-wall')
face=wall['geometry']['center'][0]-wall['geometry']['size'][0]/2
counts=[p['values']['count'] for p in frames[0]['results']['parts'] if p['method']!='rigid']
pool=slice(counts[0],counts[0]+counts[1]);end=slice(counts[0]+counts[1],sum(counts))
mass=frames[0]['coupling']['mass'];first_failure=None;max_water=0.;max_wheel=0.;max_error=0.;preimpact_failed=0;final=None;contacted=False
initial=np.array(frames[0]['particles']).reshape(-1,8);initial_water=initial[pool,:3];water_shift=0.
# Compare with the settled pool, excluding its initial hydrostatic relaxation.
# A wheel can depress/displace water without making the tallest splash higher.
settled=np.array(min(frames,key=lambda f:abs(f['time']-5))['particles']).reshape(-1,8)[pool,:3]
water_horizontal=0.;water_vertical=0.
for f in frames:
    a=np.array(f['particles']).reshape(-1,8);assert np.isfinite(a).all()
    assert abs(f['coupling']['mass']-mass)<1e-6
    assert len(a)==sum(counts) and f['coupling']['liquids']==counts[1]
    np.testing.assert_array_equal(a[initial[:,5]>.5,:3],initial[initial[:,5]>.5,:3])
    front=next(b for b in f['bodies'] if b['id']=='front-wheel')
    failed=f['results']['parts'][-1]['values']['failed']
    contacted=contacted or front['position'][0]+.62>=face-.15
    if not contacted:preimpact_failed=max(preimpact_failed,failed)
    if failed and first_failure is None:first_failure=f['time']
    if f['time']>5:max_water=max(max_water,float(a[pool,1].max()));water_shift=max(water_shift,float(np.linalg.norm(a[pool,:3]-initial_water,axis=1).max()))
    if f['time']>6:
        moved=a[pool,:3]-settled
        water_horizontal=max(water_horizontal,float(np.linalg.norm(moved[:,[0,2]],axis=1).max()))
        water_vertical=max(water_vertical,float(np.abs(moved[:,1]).max()))
    max_wheel=max(max_wheel,front['position'][1]);max_error=max(max_error,f['maxError']);final=a
summary=dict(duration=frames[-1]['time'],particles=sum(counts),pool_particles=counts[1],wall_particles=counts[2],preimpact_failed=preimpact_failed,first_failure=first_failure,final_failed=frames[-1]['results']['parts'][-1]['values']['failed'],max_water_height=max_water,max_water_displacement=water_shift,water_motion_from_settled=dict(horizontal=water_horizontal,vertical=water_vertical),max_front_axle_height=max_wheel,final_wall_mean_height=float(final[end,1].mean()),max_constraint_error=max_error,mass=mass)
print(json.dumps(summary,indent=2))
assert preimpact_failed==0,'Wall fractured before bicycle contact'
assert max_wheel>1.1,'Bicycle did not climb the first wall'
assert water_horizontal>.1 and water_vertical>.05,'Wheels did not displace the settled water by a parcel spacing horizontally and half a spacing vertically'
assert first_failure is not None and summary['final_failed']>60,'Final wall did not fragment'
assert summary['final_wall_mean_height']<initial[end,1].mean()-.12,'Broken wall did not fall'
assert max_error<.002,'Rigid joints diverged'
(root/'artifacts/course-verification.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
