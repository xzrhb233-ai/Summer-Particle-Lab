import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicCantileverProject} from '../src/fem/model.js';
import {FEMDynamicSimulation,FEMHistory} from '../src/fem/dynamic.js';
import {queryProjectResults,validateResultQuery} from '../src/simulation/result-query.js';
import {parseAssistantResponse,planCommands,executePlan} from '../src/simulation/assistant-commands.js';

const quality=()=>({kind:'quality'});
const command=(args=quality())=>({command:'result.query',args});
const response=(...commands)=>({reply:'读取已有结果的可信度筛查。',commands});
const check=(report,id)=>report.checks.find(c=>c.id===id);
function recordedRun(){
  const project=dynamicCantileverProject({divisions:[2,1,1],force:[0,-1,0],damping:0});
  Object.assign(project.solver,{initialState:'rest',thermal:true});project.curves=[];project.loadBindings=[];
  const solver=new FEMDynamicSimulation(project),history=new FEMHistory();history.record(solver.snapshot(),true);
  history.record(solver.step(.0001),true);const frame=solver.step(.0001);history.record(frame,true);
  return {project,resultProject:structuredClone(project),frame,frames:history.samples,solver};
}

test('quality accepts only its exact read-only argument schema, including in assistant parsing',()=>{
  assert.deepEqual(validateResultQuery(quality()),quality());
  assert.deepEqual(parseAssistantResponse(JSON.stringify(response(command()))).commands,[command()]);
  for(const args of [null,[],new Date(),Object.create({kind:'quality'}),
    {kind:'quality',partId:'beam'},{kind:'quality',contactId:'contact'},{kind:'quality',field:'stress'},
    {kind:'quality',limit:2},{kind:'quality',thresholds:{relativeEnergy:1}},
    {kind:'quality',relativeEnergy:1},{kind:'quality',physicalValidation:'passed'}]){
    assert.throws(()=>validateResultQuery(args));
    if(args&&Object.getPrototypeOf(args)===Object.prototype)assert.throws(()=>parseAssistantResponse(JSON.stringify(response(command(args)))));
  }
});

test('quality has an explicit unavailable report for missing, preview, unsolved or unknown-origin results',()=>{
  const run=recordedRun();
  for(const patch of [{frame:null},{frame:{...run.frame,preview:true}},{resultProject:null},
    {frame:{...run.frame,fem:{...run.frame.fem,analysis:'linear-static',solved:false}}}]){
    const result=queryProjectResults({...run,...patch},quality());
    assert.equal(result.available,false);assert.equal(result.data.physicalValidation,'not-established');
    assert.equal(result.data.overall,'insufficient-evidence');
    assert.equal(check(result.data,'availability').status,'not-assessed');
    assert.equal(check(result.data,'energy'),undefined);
  }
});

test('quality reports actual FEM measurements with units and retains unassessed mechanisms',()=>{
  const run=recordedRun(),result=queryProjectResults(run,quality()),report=result.data;
  assert.equal(result.available,true);assert.equal(result.matchesCurrentConfiguration,true);
  assert.equal(report.schema,'summer-vv-diagnostics/1');assert.equal(report.time,run.frame.time);
  assert.equal(report.historySamples,run.frames.length);assert.equal(report.backend,'cpu');
  assert.equal(check(report,'state').status,'within-threshold');
  const energy=check(report,'energy').observations.find(x=>x.name==='unexplained-residual');
  assert.equal(energy.value,run.frame.fem.dynamics.energyResidual);assert.equal(energy.unit,'J');
  const dt=check(report,'timestep').observations.find(x=>x.name==='actual-recorded-dt');
  assert.equal(dt.value,run.frame.fem.dynamics.lastDt);assert.equal(dt.unit,'s');
  for(const id of ['locking','cell-crossing','numerical-fracture'])assert.equal(check(report,id).status,'not-assessed');
  assert.equal(report.physicalValidation,'not-established');assert.notEqual(report.overall,'passed');
  for(const key of ['nodes','cells','displacement','velocity','temperature','vonMises'])assert.equal(JSON.stringify(result).includes('"'+key+'":'),false);
});

test('quality preserves stale-result provenance and excludes other runs and future samples from history count',()=>{
  const run=recordedRun(),changed=structuredClone(run.project);changed.parts[0].material.young*=2;
  const frames=[...run.frames,{frame:run.frames[0],resultProject:changed},{frame:run.frames[0]},
    {frame:{...run.frames[0],time:1},resultProject:run.resultProject}];
  const result=queryProjectResults({...run,project:changed,frames},quality());
  assert.equal(result.available,true);assert.equal(result.matchesCurrentConfiguration,false);
  assert.notEqual(result.currentConfigurationId,result.resultConfigurationId);
  assert.equal(result.data.currentConfigurationId,result.currentConfigurationId);
  assert.equal(result.data.resultConfigurationId,result.resultConfigurationId);
  assert.equal(check(result.data,'provenance').status,'observed');assert.equal(result.data.overall,'review');
  assert.equal(result.data.historySamples,run.frames.length);assert.equal(result.data.physicalValidation,'not-established');
});

test('assistant quality queries cannot mix model changes or run controls and are bounded to four',()=>{
  const project=recordedRun().project;
  for(const extra of [{command:'part.update',args:{id:'beam',young:1000}},
    ...['run','step','pause','reset'].map(action=>({command:'simulation.'+action,args:{}}))]){
    assert.throws(()=>planCommands(project,response(command(),extra)),/只读结果查询/);
  }
  assert.throws(()=>planCommands(project,response(...Array.from({length:5},()=>command()))),/最多 4/);
  const plan=planCommands(project,response({command:'project.inspect',args:{}},...Array.from({length:4},()=>command())));
  assert.equal(plan.changed,false);assert.equal(plan.action,null);assert.equal(plan.queries.length,4);
});

test('executing quality while busy reads the exact report without loading, resetting, stepping or mutating state',async()=>{
  const run=recordedRun(),before=structuredClone({project:run.project,resultProject:run.resultProject,frame:run.frame,frames:run.frames}),time=run.solver.time;
  const expected=queryProjectResults(run,quality()),plan=planCommands(run.project,response(command()));
  const calls=[],forbidden=name=>()=>{calls.push(name);throw Error(name+' must not run for a read-only query');};
  const result=await executePlan(plan,{getProject:()=>run.project,busy:forbidden('busy'),assertApplied:forbidden('assertApplied'),
    load:forbidden('load'),loadStrict:forbidden('loadStrict'),control:forbidden('control'),
    queryResults:args=>{calls.push('queryResults');return queryProjectResults(run,args);}});
  assert.equal(result.committed,false);assert.equal(result.action,null);assert.deepEqual(result.results,[expected]);
  assert.deepEqual(calls,['queryResults']);assert.equal(run.solver.time,time);
  assert.deepEqual({project:run.project,resultProject:run.resultProject,frame:run.frame,frames:run.frames},before);
});

test('a changed project invalidates a prepared quality request before the query executes',async()=>{
  const run=recordedRun(),plan=planCommands(run.project,response(command())),changed=structuredClone(run.project);
  changed.parts[0].material.density*=2;let called=false;
  await assert.rejects(executePlan(plan,{getProject:()=>changed,queryResults(){called=true;}}),/项目已变化/);
  assert.equal(called,false);
});

test('missing query support remains unavailable and a query error never commits a change',async()=>{
  const run=recordedRun(),plan=planCommands(run.project,response(command()));
  const missing=await executePlan(plan,{getProject:()=>run.project});
  assert.equal(missing.committed,false);assert.equal(missing.results[0].available,false);assert.equal(missing.results[0].data,null);
  const failure=Error('query failure');
  await assert.rejects(executePlan(plan,{getProject:()=>run.project,queryResults(){throw failure;}}),error=>error===failure&&error.committed===false);
});
