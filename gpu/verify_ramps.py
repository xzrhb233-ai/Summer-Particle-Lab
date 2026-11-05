"""Verify an actual CUDA recording, including exit, water depth and fixed banks."""
import json
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parent.parent
tape=json.loads((root/'artifacts/ramps-replay.json').read_text(encoding='utf-8'))
frames=tape['frames'];first=frames[0];mass=first['coupling']['mass']
assert tape['backend']['arch']=='cuda'
def body(f,id):return next(b for b in f['bodies'] if b['id']==id)
floor=body(first,'pool-floor')['position'][1]+.12
exit_road=body(first,'road-1');exit_x=exit_road['position'][0]-exit_road['size'][0]/2
depths=[];minimum_y=100.;error=0.
for f in frames:
    a=np.asarray(f['particles']).reshape(-1,8)
    assert np.isfinite(a).all() and len(a)==first['coupling']['count']
    assert abs(f['coupling']['mass']-mass)<1e-5
    for id in ['pool-ramp-entry','pool-ramp-exit','pool-floor']:
        np.testing.assert_allclose(body(f,id)['position'],body(first,id)['position'],atol=1e-6)
    minimum_y=min(minimum_y,body(f,'front-wheel')['position'][1]);error=max(error,f['maxError'])
    if f['time']>=1:depths.append(float(np.quantile(a[:,1],.95)-floor))
last=frames[-1];rear=body(last,'rear-wheel');front=body(last,'front-wheel')
assert body(first,'front-wheel')['position'][1]-minimum_y>.5,'front wheel never descended into the basin'
assert rear['position'][0]>exit_x+.6,'rear wheel did not leave the exit bank'
assert abs(rear['position'][1]-.62)<.08 and abs(front['position'][1]-.62)<.08,'bicycle has not settled on the exit road'
assert min(depths)>.62,'water fell below half a wheel'
assert error<.002
report=dict(duration=last['time'],particles=len(a),mass=mass,exitX=exit_x,rearX=rear['position'][0],frontX=front['position'][0],minimumFrontY=minimum_y,minimumWaterDepth95=min(depths),maximumJointError=error)
(root/'artifacts/ramps-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
