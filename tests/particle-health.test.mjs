import test from 'node:test';
import assert from 'node:assert/strict';
import {particleMechanics,MechanicalDiagnostics} from '../src/simulation/mechanical-diagnostics.js';
import {MixedEnergy} from '../src/mixed/energy.js';

function particles(){
  const s={count:3,settings:{stiffness:1},model:new Uint8Array(3),damage:new Float64Array(3),pinned:new Uint8Array(3),
    mpm:{H:8,F:new Float64Array(27),C:new Float64Array(27),stress:new Float64Array([0,.2,.1]),plastic:new Float64Array(3)},isSolid:()=>true};
  for(const key of ['mass','x','y','z','vx','vy','vz','temperature','enthalpy'])s[key]=new Float64Array(3);
  s.mass.fill(1);for(let i=0;i<3;i++)s.mpm.F.set([1,0,0,0,1,0,0,0,1],i*9);
  return s;
}
const arrays=s=>Object.fromEntries([...Object.entries(s),...Object.entries(s.mpm).map(([k,v])=>['mpm.'+k,v])].filter(([,v])=>ArrayBuffer.isView(v)).map(([k,v])=>[k,v.slice()]));

test('particle health observes every solid and preserves finite expansion above J=1 without mutation',()=>{
  const s=particles();s.mpm.F[0]=1.1;s.mpm.F[9]=1.2;s.mpm.F[18]=1.3;
  const before=arrays(s),p=particleMechanics(s,[0,0,0]),h=p.particleHealth;
  assert.equal(h.inspectedParticles,3);assert.equal(h.solidParticles,3);assert.equal(h.nonfiniteParticles,0);assert.equal(h.invalidJCount,0);
  assert.equal(h.minJ,1.1);assert.equal(h.maxJ,1.3);assert.equal(h.maxNormalizedStress,.2);
  assert.match(h.determinantMeaning,/stored-F.*not total/);assert.match(h.stressUnits,/dimensionless/);assert.deepEqual(arrays(s),before);
});
test('particle health distinguishes inverted, singular and nonfinite stored F without repairing them',()=>{
  const s=particles();s.mpm.F[0]=-1;s.mpm.F[9]=0;s.mpm.F[18]=NaN;s.vx[2]=Infinity;s.mpm.C[18]=NaN;
  const before=arrays(s),h=particleMechanics(s,[0,0,0]).particleHealth;
  assert.equal(h.nonfiniteParticles,1);assert.equal(h.invalidJCount,2);assert.equal(h.minJ,-1);assert.equal(h.maxJ,0);assert.deepEqual(arrays(s),before);
});
test('particle health reports missing solid determinant coverage as null and still checks fluid state',()=>{
  const s=particles();s.isSolid=()=>false;s.temperature[1]=NaN;
  const h=particleMechanics(s,[0,0,0]).particleHealth;
  assert.equal(h.inspectedParticles,3);assert.equal(h.solidParticles,0);assert.equal(h.nonfiniteParticles,1);
  assert.equal(h.minJ,null);assert.equal(h.maxJ,null);assert.equal(h.maxNormalizedStress,null);
});
test('existing mechanics and mixed-energy observers expose the same particle health schema',()=>{
  const s=particles(),engine={particles:s,model:{gravity:[0,0,0],joints:[],bodies:[]},bodies:new Map(),joints:new Map()},observer=new MechanicalDiagnostics(engine);
  const frame={time:0,joints:[],energy:0,maxError:0},h=observer.sample(frame).particleHealth;
  const p=particleMechanics(s,[0,0,0]),ledger=MixedEnergy.prototype.snapshot.call({observer:{incomplete:false,values:{p2g:0,g2p:0,gridBoundary:0,postprocess:0,regularization:0,phase:0,stressStrain:0}},initial:0},
    {mechanicalEnergy:0,dissipated:0,externalWork:0,thermalWork:0,kinetic:0,energy:0},p,[],{residual:0},{pairs:[]});
  assert.deepEqual(h,p.particleHealth);assert.deepEqual(ledger.particleHealth,h);assert.equal(frame.diagnostics.particleHealth,h);
});
