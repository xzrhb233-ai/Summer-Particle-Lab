import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunRecord} from '../src/simulation/run-record.js';
import {FEMSimulation} from '../src/fem/solver.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {cantileverProject,dynamicCantileverProject} from '../src/fem/model.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {createProjectArchive,createMemoryArchiveStorage} from '../src/simulation/project-archive.js';

test('real solved static FEM at t=0 records measured fields and exact source configuration',async()=>{
  const origin=cantileverProject({divisions:[3,1,1]}),sim=new FEMSimulation(origin),frame=sim.step(),project=structuredClone(origin);project.name='当前已修改模型';
  const record=createRunRecord({project,frame,resultProject:origin,outcome:'completed',targetTime:0}),part=frame.fem.parts[0];
  assert.equal(record.time,0);assert.equal(record.backend,'cpu');assert.equal(record.project.name,origin.name);assert.notEqual(record.project,origin);
  assert.equal(record.summary.nodeCount,part.nodes.length);assert.equal(record.summary.elementCount,part.cells.length);assert.equal(record.summary.maxDisplacement,part.summary.maxDisplacement);assert.equal(record.summary.maxVonMises,part.summary.maxVonMises);assert.equal(record.summary.strainEnergy,part.summary.energy);
  assert.equal(record.summary.minTemperature,undefined);assert.equal(record.summary.computeSeconds,undefined);assert.equal(record.summary.kineticEnergy,undefined);
  record.project.name='detached';assert.notEqual(origin.name,'detached');
  const archive=createProjectArchive({storage:createMemoryArchiveStorage()}),saved=await archive.recordRun({...record,project:origin});assert.equal((await archive.getRevision(saved.revisionId)).project.name,origin.name);sim.free();
});

test('previews, absent provenance, unsolved static meshes and dynamic t=0 are not run results',()=>{
  const project=cantileverProject({divisions:[2,1,1]}),sim=new FEMSimulation(project),frame=sim.snapshot(),input={project,frame,resultProject:project,outcome:'paused'};
  assert.equal(createRunRecord(input),null);assert.equal(createRunRecord({...input,frame:{...frame,time:.1,preview:true}}),null);
  const solved=sim.step();assert.equal(createRunRecord({...input,frame:solved,resultProject:null}),null);
  assert.equal(createRunRecord({...input,frame:{time:0,results:{parts:[]}}}),null);assert.equal(createRunRecord({...input,frame:{time:NaN}}),null);sim.free();
});

test('real dynamic FEM capture uses current computed energies and thermal fields without inventing full-run timing',()=>{
  const project=dynamicCantileverProject({divisions:[2,1,1]}),sim=new FEMDynamicSimulation(project),initial=sim.snapshot();
  assert.equal(createRunRecord({project,frame:initial,resultProject:project,outcome:'paused'}),null);
  const frame=sim.step(sim.dt),record=createRunRecord({project,frame,resultProject:project,outcome:'paused',targetTime:1});
  assert.ok(record.time>0);assert.equal(record.summary.steps,frame.fem.dynamics.steps);assert.equal(record.summary.kineticEnergy,frame.results.balance.kinetic);assert.equal(record.summary.energyResidual,frame.results.balance.energyResidual);
  assert.equal(record.summary.minTemperature,frame.fem.parts[0].summary.minTemperature);assert.equal(record.summary.maxTemperature,frame.fem.parts[0].summary.maxTemperature);
  assert.equal(record.summary.computeSeconds,undefined);assert.equal(record.targetTime,1);sim.free();
});

test('GPU recording uses confirmed frame backend, full particle counts and explicitly reported heat',()=>{
  const project=addProjectPart(emptyProject(),{method:'mpm'});project.solver.computeBackend='gpu';const id=project.parts[0].id;
  const frame={time:.3,mixed:{backend:{arch:'cuda'},clock:{steps:50,minDt:.00001,maxDt:.0001}},coupling:{count:50000},particles:new Float32Array(80),thermal:{energy:20,residual:0,generated:{friction:.02,plastic:.03}},results:{parts:[{id,values:{minTemperature:20,maxTemperature:30}}],balance:{energyComplete:false,energyResidual:99,kinetic:2}}};
  const record=createRunRecord({project,frame,resultProject:project,outcome:'error'});
  assert.equal(record.backend,'gpu');assert.equal(record.summary.particleCount,50000);assert.equal(record.summary.frictionHeat,.02);assert.equal(record.summary.plasticHeat,.03);assert.equal(record.summary.thermalResidual,0);assert.equal(record.summary.energyResidual,undefined);
  assert.equal(record.summary.nodeCount,undefined);assert.equal(record.summary.maxDisplacement,undefined);assert.equal(record.summary.minDt,.00001);
  assert.equal(createRunRecord({project,frame:{...frame,mixed:undefined},resultProject:project,outcome:'paused'}).backend,'unconfirmed');
  assert.equal(createRunRecord({project,frame:{...frame,mixed:undefined,backend:{arch:'cuda'}},resultProject:project,outcome:'paused'}).backend,'gpu+cpu');
  assert.throws(()=>createRunRecord({project,frame,resultProject:project,outcome:'running'}),/状态无效/);
});
