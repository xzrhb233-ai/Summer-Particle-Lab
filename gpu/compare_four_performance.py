"""Compare same-clock CUDA trajectories and warmed timing artifacts."""
import json
from pathlib import Path
import numpy as np

results=[]
for tag in ['small','dense']:
    paths=[Path(f'artifacts/v058-{tag}-{kind}') for kind in ['reference','optimized']]
    a,b=[np.load(str(p)+'.npz') for p in paths]
    ref,opt=[json.loads(p.with_suffix('.json').read_text(encoding='utf8')) for p in paths]
    assert ref['particles']==opt['particles']
    assert ref['interval']==opt['interval'] and ref['simulated']==opt['simulated']
    assert [r['steps'] for r in ref['rows']]==[r['steps'] for r in opt['rows']]
    assert [r['retries'] for r in ref['rows']]==[r['retries'] for r in opt['rows']]
    errors={}
    # Different atomic scatter orders perturb f32 positions. PBF reconstructs
    # velocity from position differences / dt, amplifying that roundoff. Allow
    # 2 micrometres and 0.5 mm/s, and report actual errors (no bitwise claim).
    for key,scale,tolerance in [('x',.025,2e-6),('v',.025,5e-4),('F',1,1e-4),('u',1,2e-6),('fv',1,2e-4),('T',1,2e-5),('rx',1,2e-6),('rv',1,2e-4),('rT',1,2e-5),('H',1,2e-3)]:
        error=float(np.max(np.abs(a[key].astype(float)-b[key].astype(float)))*scale)
        assert error<tolerance,(tag,key,error,tolerance)
        errors[key]=error
    for name,columns,tol in [('impulse',slice(0,3),1e-4),('heat',slice(3,4),1e-7),('torqueImpulse',slice(12,15),1e-4)]:
        av,bv=a['totals'][:,columns],b['totals'][:,columns]
        assert np.allclose(av,bv,rtol=1e-5,atol=tol),(tag,name,av,bv)
        errors[name]=float(np.max(np.abs(av-bv)))
    row=dict(case=tag,particles=ref['particles'],interval=opt['interval'],referenceMs=ref['medianMs'],optimizedMs=opt['medianMs'],speedup=ref['medianMs']/opt['medianMs'],maxAbsDifferences=errors)
    results.append(row)
Path('artifacts/v058-performance-comparison.json').write_text(json.dumps(results,indent=2),encoding='utf8');print(json.dumps(results),flush=True)
