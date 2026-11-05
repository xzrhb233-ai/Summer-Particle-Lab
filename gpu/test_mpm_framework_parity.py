"""Frozen v0.58.7 operator sequence versus the new MPM-led native-domain path."""
import importlib.util,json,sys,time
from pathlib import Path
import numpy as np
from benchmark_mixed import compile_project
from runtime import initialize
from mpm_unified_solver import UnifiedMPMSolver

spec=importlib.util.spec_from_file_location('v0587_reference',Path('artifacts/v0587-four-solver-reference.py'))
reference=importlib.util.module_from_spec(spec);sys.modules[spec.name]=reference;spec.loader.exec_module(reference)
source=json.loads(Path('artifacts/v0585-impact-compiled.json').read_text(encoding='utf8'))['fullProject'];source['solver']['dt']=.002
data=compile_project(project=source);initialize('cuda');runs=[]
for cls in [reference.FourSolver,UnifiedMPMSolver]:
    s=cls(data);start=time.perf_counter()
    for _ in range(5):frame,_=s.step(.004)
    values=dict(x=s.s.x.to_numpy(),v=s.s.v.to_numpy(),F=s.s.F.to_numpy(),C=s.s.C.to_numpy(),enthalpy=s.s.enthalpy.to_numpy(),femU=s.c.u.to_numpy(),femV=s.c.v.to_numpy(),femT=s.temperature.to_numpy(),rigidX=s.rx.to_numpy(),rigidV=s.rv.to_numpy(),rigidRotation=s.rq.to_numpy(),rigidT=s.rigid_temperature.to_numpy(),pairs=s.totals.to_numpy())
    assert abs(frame['thermal']['residual'])<1e-5
    if cls is UnifiedMPMSolver:
        assert frame['framework']['schema']=='mpm-unified-framework/1'
        assert {d['method'] for d in frame['framework']['domains']}=={'mpm','fem','pbf','rigid'}
        assert s.framework.domains.domains['solid'].fields['position'] is s.s.x
        assert s.framework.domains.domains['water'].fields['position'] is s.s.x
        assert s.framework.clock is s.c.device_time
    runs.append((values,frame));print(json.dumps(dict(solver=cls.__name__,time=s.time,steps=s.steps,wallSeconds=time.perf_counter()-start)),flush=True)
errors={}
for name,expected in runs[0][0].items():
    actual=runs[1][0][name];errors[name]=float(np.max(np.abs(actual-expected)))
    np.testing.assert_allclose(actual,expected,rtol=2e-5,atol=2e-5,err_msg=name)
result=dict(time=runs[1][1]['time'],steps=runs[1][1]['clock']['steps'],maxAbsoluteErrors=errors,framework=runs[1][1]['framework'],heatResidual=runs[1][1]['thermal']['residual'])
Path('artifacts/v0590-framework-parity.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
