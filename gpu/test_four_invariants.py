"""CUDA regression checks, independent of browser display and color mapping."""
import json,copy
from pathlib import Path
import numpy as np
from runtime import initialize
from four_solver import FourSolver,L

def momentum(s):
    x=s.s.x.to_numpy().astype(float)*L;v=s.s.v.to_numpy().astype(float)*L;m=s.s.mass.to_numpy().astype(float)
    fx=s.c.nodes.to_numpy()+s.c.u.to_numpy();fv=s.c.v.to_numpy();fm=s.c.mass.to_numpy()
    rx=s.rx.to_numpy()[0];rv=s.rv.to_numpy()[0];rw=s.rw.to_numpy()[0];I=.4*s.rmass*s.rr**2
    P=(m[:,None]*v).sum(0)+(fm[:,None]*fv).sum(0)+s.rmass*rv
    A=np.cross(x,m[:,None]*v).sum(0)+np.cross(fx,fm[:,None]*fv).sum(0)+np.cross(rx,s.rmass*rv)+I*rw
    K=.5*(m[:,None]*v*v).sum()+.5*(fm[:,None]*fv*fv).sum()+.5*s.rmass*np.dot(rv,rv)+.5*I*np.dot(rw,rw)
    return P,A,K

if __name__=='__main__':
    backend=initialize('cuda');data=json.loads(Path('artifacts/four-compiled.json').read_text(encoding='utf8'));s=FourSolver(data);c=s.c
    # All supports are released only for this isolated contact-operator test.
    fixed=c.fixed.to_numpy();c.fixed.fill(0);velocity=s.s.v.to_numpy();velocity[:]=[8,-20,4];s.s.v.from_numpy(velocity)
    # Touch the sphere to both particle groups; no time integration in this test.
    s.rx.from_numpy(np.array([[-.0375,.72,0]],np.float64));s.rv.from_numpy(np.array([[0.,-3.,0.]],np.float64))
    c.prepare_surface();c.find_contacts();s.find();s.contact_bound()
    rigid_before=s.rv.to_numpy().copy();before=momentum(s);s.contact(0);s.contact(1);after=momentum(s)
    linear=float(np.linalg.norm(after[0]-before[0]));angular=float(np.linalg.norm(after[1]-before[1]));loss=before[2]-after[2]
    assert linear<2e-5,(linear,before,after)
    assert angular<2e-5,angular
    assert loss>=-1e-6,loss
    assert np.linalg.norm(s.rv.to_numpy()-rigid_before)>1e-6
    # Same operator with explicit contact disabled must leave every DOF alone.
    params=s.params.to_numpy();off=params.copy();off[:,0]=0;s.params.from_numpy(off)
    c.prepare_surface();c.find_contacts();s.find();s.contact_bound();before=momentum(s);s.contact(0);s.contact(1);after=momentum(s)
    assert all(np.array_equal(a,b) for a,b in zip(before,after));s.params.from_numpy(params)
    # Transmission is pairwise conservative for unequal capacities.
    c.prepare_surface();c.find_contacts();s.find();s.s.clear_neighbors();s.s.build_neighbors(s.n)
    E=s.thermal_energy();s.thermal_prepare();s.heat(0,10.);s.heat(1,10.);s.heat_apply();residual=s.thermal_energy()-E
    assert abs(residual)<1e-6,residual
    temperatures=np.concatenate([s.s.enthalpy.to_numpy()/s.particle_cps.to_numpy(),s.temperature.to_numpy(),s.rigid_temperature.to_numpy()])
    assert temperatures.min()>=20-1e-5 and temperatures.max()<=100+1e-5
    # A failed batch must restore particles, solid state, rigid state, heat book
    # and device clock; inject failure after a real physical substep.
    c.fixed.from_numpy(fixed);s.rx.from_numpy(np.array([data['fullProject']['parts'][3]['geometry']['center']],np.float64))
    arrays=[s.s.x,s.s.v,s.s.F,s.s.C,s.s.enthalpy,c.u,c.v,c.temperature,s.rx,s.rv,s.rw,s.rq,s.rigid_temperature,s.totals,c.device_time,s.thermal_loads.heat]
    saved=[a.to_numpy().copy() for a in arrays];substep=s.substep;controller=(s.next_dt,s.stable_intervals)
    def fail(h):substep(h);raise ValueError('injected batch failure')
    s.substep=fail
    try:s.step(.0002);raise AssertionError('failure was swallowed')
    except ValueError as e:assert 'injected' in str(e)
    assert s.time==0 and s.steps==0
    assert (s.next_dt,s.stable_intervals)==controller
    for a,b in zip(arrays,saved):assert np.array_equal(a.to_numpy(),b),str(a)
    result=dict(backend=backend,linearImpulseError=linear,angularImpulseError=angular,contactKineticLoss=loss,heatResidual=residual,disabledContactUnchanged=True,batchRollback=True)
    Path('artifacts/four-invariants.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
