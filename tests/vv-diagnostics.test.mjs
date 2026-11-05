import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSimulation} from '../src/simulation/vv-diagnostics.js';
import {dynamicCantileverProject} from '../src/fem/model.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
const project=()=>dynamicCantileverProject({divisions:[2,1,1]});
const check=(r,id)=>r.checks.find(c=>c.id===id);
test('absence, preview and unknown provenance do not certify correctness',()=>{
  const p=project();for(const args of [{},{project:p,frame:{time:1}},{project:p,resultProject:p,frame:{preview:true,time:0}}]){
    const r=assessSimulation(args);assert.equal(r.overall,'insufficient-evidence');assert.equal(r.physicalValidation,'not-established');
  }
});
test('actual FEM results have finite state evidence and separately retain untested failure mechanisms',()=>{
  const p=project(),sim=new FEMDynamicSimulation(p),f=sim.step(.001),before=f.fem.parts[0].displacement.slice();
  const r=assessSimulation({project:p,resultProject:p,frame:f});
  assert.equal(check(r,'state').status,'within-threshold');assert.equal(check(r,'energy').status,'within-threshold');
  for(const id of ['cell-crossing','numerical-fracture','locking'])assert.equal(check(r,id).status,'not-assessed');
  assert.deepEqual(f.fem.parts[0].displacement,before);assert.equal(r.physicalValidation,'not-established');
});
test('inverted elements and nonfinite fields are invalid; high Poisson is risk not a locking diagnosis',()=>{
  const p=project();p.parts[0].material.poisson=.48;const f=new FEMDynamicSimulation(p).snapshot(),b=f.fem.parts[0];
  for(let i=0;i<b.nodes.length;i++)b.displacement[i*3]=-2*b.nodes[i][0];
  b.temperature[0]=NaN;const r=assessSimulation({project:p,resultProject:p,frame:f});
  assert.equal(r.overall,'invalid-state');assert.equal(check(r,'locking').status,'risk');assert.ok(check(r,'state').observations.find(x=>x.name==='nonpositive-J').value>0);
});
test('unsupported mixed energy never masquerades as closed energy; completed CPU ledger need not have enabled flag',()=>{
  const p=project(),base={time:.1,mixed:{energy:{complete:false,unexplainedResidual:100,knownMechanical:1,reasons:['unsupported-material-energy']}}};
  let r=assessSimulation({project:p,resultProject:p,frame:base});assert.equal(check(r,'energy').status,'not-assessed');
  base.mixed.energy={complete:true,unexplainedResidual:2,rawResidual:3,initial:10,mechanical:12,numerical:{p2g:1,total:1}};
  r=assessSimulation({project:p,resultProject:p,frame:base});assert.equal(check(r,'energy').status,'observed');assert.equal(check(r,'numerical-work').status,'observed');
  base.mixed.energy.enabled=false;assert.equal(check(assessSimulation({project:p,resultProject:p,frame:base}),'energy').status,'not-assessed');
});
test('small adaptive steps are not called unstable; expired configurations and thresholds are explicit',()=>{
  const p=project(),other=structuredClone(p);other.name+=' new';const f={time:1,mixed:{clock:{maxDt:1e-7,requestedDt:.001}}};
  const r=assessSimulation({project:other,resultProject:p,frame:f});assert.equal(r.matchesCurrentConfiguration,false);assert.equal(check(r,'timestep').status,'not-assessed');assert.notEqual(r.overall,'invalid-state');
  assert.throws(()=>assessSimulation({thresholds:{relativeEnergy:-1}}));assert.throws(()=>assessSimulation({thresholds:{fake:1}}));
});
test('missing strain is not zero and mixed cumulative dt is not compared with a FEM local limit',()=>{
  const p=project(),f={time:.1,fem:{parts:[{displacement:[0,0,0]}],dynamics:{lastDt:.0001,criticalDt:.0002}},mixed:{clock:{maxDt:.01}}};
  const r=assessSimulation({project:p,resultProject:p,frame:f});assert.equal(check(r,'small-strain').status,'not-assessed');assert.equal(check(r,'timestep').status,'not-assessed');
  assert.equal(check(r,'timestep').observations.find(x=>x.name==='comparable-FEM-critical-dt').value,null);
  assert.equal(assessSimulation({project:p,resultProject:p,frame:f,history:[f,{...f,preview:true},{...f,fem:{analysis:'linear-static',solved:false}}]}).historySamples,1);
});
test('CPU health exposes invalid stored F and preserves incomplete GPU coverage',()=>{
  const p=project(),f={time:1,diagnostics:{particleHealth:{inspectedParticles:100,solidParticles:100,nonfiniteParticles:0,invalidJCount:2,minJ:-.1,maxJ:1.1}}};
  assert.equal(check(assessSimulation({project:p,resultProject:p,frame:f}),'state').severity,'error');
  assert.equal(check(assessSimulation({project:p,resultProject:p,frame:{time:1,mixed:{backend:{arch:'cuda'}}}}),'state').status,'not-assessed');
});
