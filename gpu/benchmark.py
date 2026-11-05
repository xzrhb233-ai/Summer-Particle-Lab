import json
import time
import sys
from runtime import initialize
from solver import Solver

print(json.dumps(initialize()),flush=True)
s=Solver()
for scene in (sys.argv[1:] or ("models","large","coupled","planet","million")):
    s.reset(scene)
    for _ in range(10):
        s.step()
    s.snapshot()  # Exclude first-time packing kernel compilation from readback timing.
    start=time.perf_counter();profiles=[]
    for _ in range(20):
        s.step();profiles.append(s.profile.copy())
    elapsed=(time.perf_counter()-start)*1000/20
    start=time.perf_counter();s.snapshot();readback=(time.perf_counter()-start)*1000
    print(json.dumps(dict(scene=scene,particles=s.count,warmup=10,samples=20,meanMs=round(elapsed,2),
                         readbackMs=round(readback,2),stagesMs={key:round(sum(p[key] for p in profiles)/20,2) for key in profiles[0]})),flush=True)
