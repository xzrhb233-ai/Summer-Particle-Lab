import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicCantileverProject} from '../src/fem/model.js';
import {FEMDynamicSimulation,FEMHistory} from '../src/fem/dynamic.js';
import {simulationSeries,VV_OBSERVABLES} from '../src/simulation/vv-observables.js';
import {configurationId} from '../src/simulation/workspace-context.js';

// These are result-wiring checks against actual solver snapshots, not an
// experimental validation of the mechanics or thermal model.
function recordedRun(){
  const project=dynamicCantileverProject({divisions:[2,1,1],force:[0,-1,0],damping:0});
  Object.assign(project.solver,{initialState:'rest',thermal:true});
  project.curves=[];project.loadBindings=[];
  const solver=new FEMDynamicSimulation(project),history=new FEMHistory();
  history.limit=1; // Retain scalar samples after older visualization eviction.
  history.record(solver.snapshot(),true);
  history.record(solver.step(.0001),true);
  const frame=solver.step(.0001);history.record(frame,true);
  return {project,resultProject:structuredClone(project),frame,history:history.samples,recording:history,solver};
}
const sample=(time,values)=>({time,fem:{parts:[{id:'beam',summary:values}]}});

test('observables use actual retained FEM history, explicit quantities and units without uncertainty fabrication',()=>{
  const run=recordedRun(),before=structuredClone(run.history);
  assert.equal(run.recording.frames.length,2);assert.equal(run.history.length,3);
  for(const definition of VV_OBSERVABLES){
    const series=simulationSeries(run,'beam',definition.id);
    assert.equal(series.kind,'simulation');assert.equal(series.quantity,definition.quantity);
    assert.equal(series.unit,definition.unit);assert.equal(series.timeUnit,'s');
    assert.equal(series.configurationId,configurationId(run.resultProject));
    assert.equal(series.uncertaintyKind,null);assert.equal(series.omittedSamples,0);
    assert.deepEqual(series.points,run.history.map(f=>({time:f.time,value:definition.id==='tipY'?f.fem.parts[0].summary.tip[1]:f.fem.parts[0].summary[definition.id]})));
    assert.ok(series.points.every(p=>!Object.hasOwn(p,'uncertainty')));
  }
  const displacement=simulationSeries(run,'beam','maxDisplacement');
  assert.equal(displacement.points[0].value,0);assert.ok(displacement.points.at(-1).value>0);
  assert.ok(simulationSeries(run,'beam','tipY').points.at(-1).value<0);
  assert.equal(simulationSeries(run,'beam','temperature').unit,'degC');
  assert.equal(simulationSeries(run,'beam','maxDisplacement').unit,'m');
  assert.deepEqual(run.history,before);
});

test('configuration identity is required and cloned identical documents preserve provenance',()=>{
  const run=recordedRun();
  assert.equal(simulationSeries({...run,project:structuredClone(run.project)},'beam','tipY').points.length,3);
  const changed=structuredClone(run.project);changed.parts[0].material.young*=2;
  assert.throws(()=>simulationSeries({...run,project:changed},'beam','tipY'),/旧配置/);
  assert.throws(()=>simulationSeries({...run,resultProject:null},'beam','tipY'),/先求解/);
});

test('mixed origins, future, preview, missing and repeated samples are omitted without invented measurements',()=>{
  const run=recordedRun(),other=structuredClone(run.resultProject);other.parts[0].material.density*=2;
  const first=run.history[0],last=run.history.at(-1);
  const history=[last,
    {frame:sample(.00005,{maxDisplacement:900}),resultProject:other},first,last,
    {frame:sample(1,{maxDisplacement:901}),resultProject:run.resultProject},
    {frame:{...sample(.00005,{maxDisplacement:902}),preview:true},resultProject:run.resultProject},
    {frame:sample(.00005,{maxDisplacement:903})},
    sample(NaN,{maxDisplacement:904}),sample(.00005,{maxDisplacement:NaN}),
    {time:.00005,fem:{parts:[{id:'absent',summary:{maxDisplacement:905}}]}}];
  const result=simulationSeries({...run,history},'beam','maxDisplacement');
  assert.deepEqual(result.points,[first,last].map(f=>({time:f.time,value:f.fem.parts[0].summary.maxDisplacement})));
  assert.equal(result.omittedSamples,8);
});

test('unsolved static history cannot become a comparison sample after a solved frame arrives',()=>{
  const run=recordedRun(),unsolved=sample(.00005,{maxDisplacement:999});
  Object.assign(unsolved.fem,{analysis:'linear-static',solved:false});
  const result=simulationSeries({...run,history:[...run.history,unsolved]},'beam','maxDisplacement');
  assert.equal(result.points.length,3);assert.equal(result.omittedSamples,1);
  assert.ok(result.points.every(p=>p.value!==999));
});

test('missing results and fewer than two valid recorded times reject rather than interpolate or pad',()=>{
  const run=recordedRun();
  for(const patch of [{project:null},{frame:null},{frame:{...run.frame,preview:true}},
    {frame:{...run.frame,fem:{...run.frame.fem,analysis:'linear-static',solved:false}}}]){
    assert.throws(()=>simulationSeries({...run,...patch},'beam','maxDisplacement'),/先求解/);
  }
  for(const history of [undefined,[],[run.history[0]],[run.history[0],run.history[0]],
    [sample(0,{}),sample(.0001,{maxDisplacement:null})]]){
    assert.throws(()=>simulationSeries({...run,history},'beam','maxDisplacement'),/不足两个/);
  }
});

test('FEM observable definitions do not silently accept another solver or substitute a body pose',()=>{
  const run=recordedRun();
  assert.throws(()=>simulationSeries(run,'beam','stress'),/未知/);
  assert.throws(()=>simulationSeries(run,'absent','temperature'),/部件不存在/);
  const project=structuredClone(run.project);project.parts[0].method='mpm';
  assert.throws(()=>simulationSeries({...run,project,resultProject:project},'beam','temperature'),/限定 FEM/);
  const history=[0,.0001].map(time=>({time,results:{parts:[{id:'beam',values:{displacement:[1,2,3],maxDisplacement:4}}]}}));
  assert.throws(()=>simulationSeries({...run,history},'beam','tipY'),/不足两个/);
});

test('unified FEM result summaries remain usable while each returned point owns its values',()=>{
  const run=recordedRun(),history=run.history.map(f=>({time:f.time,results:{parts:f.fem.parts.map(p=>({id:p.id,method:'fem',values:p.summary}))}}));
  const before=structuredClone(history),result=simulationSeries({...run,history},'beam','maxTemperature');
  assert.deepEqual(result.points,run.history.map(f=>({time:f.time,value:f.fem.parts[0].summary.maxTemperature})));
  result.points[0].value=-999;result.points.push({time:2,value:999});
  assert.deepEqual(history,before);
});
