import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {archiveProjectSnapshot,compactRunSummary,createProjectArchive,createMemoryArchiveStorage,createIndexedDBArchiveStorage} from '../src/simulation/project-archive.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {configurationId} from '../src/simulation/workspace-context.js';
import {createParametricSpec,compileParametricRecipe} from '../src/simulation/cad-parametric.js';
import {cadFEMOptions} from '../src/simulation/cad-mesh-model.js';
import {validateFEM} from '../src/fem/model.js';
import {runCAD} from '../cad-server.mjs';

function fixture(options={}){
  let count=0;const storage=options.storage??createMemoryArchiveStorage();
  return {storage,archive:createProjectArchive({storage,now:()=>new Date('2026-11-03T12:00:00.000Z'),idFactory:()=>String(++count),...options})};
}
const run=(project,extra={})=>({project,outcome:'paused',time:.2,targetTime:1,backend:'cpu',summary:{maxDisplacement:.004,minTemperature:20,maxTemperature:23},...extra});

test('saved project versions survive a new archive instance and are detached immutable snapshots',async()=>{
  const {archive,storage}=fixture(),project=addProjectPart(emptyProject(),{id:'solid',method:'mpm'}),original=structuredClone(project);
  const save=archive.saveRevision(project,{label:'初始设计',reason:'manual'});project.parts[0].name='later change';const stored=await save;
  assert.equal(stored.created,true);assert.equal(stored.label,'初始设计');
  const reopened=fixture({storage}).archive,revision=await reopened.getRevision(stored.id);
  assert.equal(revision.project.parts[0].name,original.parts[0].name);
  assert.equal(revision.configurationId,configurationId(revision.project));
  revision.project.parts[0].name='read mutation';assert.notEqual((await reopened.getRevision(stored.id)).project.parts[0].name,'read mutation');
  const list=await reopened.list();assert.equal(list.revisions.length,1);assert.equal(list.revisions[0].project,undefined);
});

test('automatic edits deduplicate canonical content while named manual versions remain available',async()=>{
  const {archive}=fixture(),p=emptyProject(),first=await archive.saveRevision(p);
  const reordered=Object.fromEntries(Object.entries(p).reverse()),same=await archive.saveRevision(reordered,{reason:'reset'});
  assert.equal(same.id,first.id);assert.equal(same.created,false);
  p.name='第二版';const changed=await archive.saveRevision(p,{reason:'edit'});assert.notEqual(changed.id,first.id);
  const named=await archive.saveRevision(p,{label:'试验基准',reason:'manual'});assert.notEqual(named.id,changed.id);
  assert.equal((await archive.saveRevision(p,{label:'试验基准',reason:'manual'})).id,named.id);
  assert.equal((await archive.list()).revisions.length,3);
});

test('project archive never copies API settings, chats, credentials or getter values',async()=>{
  const project=addProjectPart(emptyProject(),{method:'rigid'});
  project.apiKey='do-not-store';project.chat={messages:['do-not-store']};project.assistant={baseURL:'private'};
  project.solver.apiKey='do-not-store';project.solver.headers={authorization:'do-not-store'};
  project.parts[0].apiKey='do-not-store';project.parts[0].material.credentials={password:'do-not-store'};
  Object.defineProperty(project,'apiConfig',{enumerable:true,get(){assert.fail('unknown top-level getter must not run');}});
  Object.defineProperty(project.solver,'api_key',{enumerable:true,get(){assert.fail('credential getter must not run');}});
  const {archive,storage}=fixture();await archive.saveRevision(project);
  assert.doesNotMatch(JSON.stringify(await storage.read()),/do-not-store|apiKey|api_key|headers|messages|credentials|private/);
  const invalid=emptyProject();Object.defineProperty(invalid.solver,'dt',{enumerable:true,get(){assert.fail('schema getter must not run');}});
  assert.throws(()=>archiveProjectSnapshot(invalid),/动态属性/);
});

test('run record is compact and tied to its exact immutable project version, never a restart state',async()=>{
  const {archive,storage}=fixture(),project=emptyProject(),input=run(project,{summary:{maxDisplacement:.002,kineticEnergy:3.2,particleCount:20000,thermalResidual:0,frame:{nodes:[1,2,3]},apiKey:'do-not-store',unknown:42,maxSpeed:Infinity}});
  const save=archive.recordRun(input);project.name='edited after run';input.summary.maxDisplacement=999;const record=await save;
  assert.deepEqual(record.summary,{particleCount:20000,maxDisplacement:.002,kineticEnergy:3.2,thermalResidual:0});
  assert.equal(record.restartable,false);assert.equal(record.outcome,'paused');assert.equal(record.backend,'cpu');
  const source=await archive.getRevision(record.revisionId);assert.notEqual(source.project.name,project.name);assert.equal(record.configurationId,source.configurationId);
  assert.doesNotMatch(JSON.stringify(await storage.read()),/do-not-store|"frame"|"nodes"/);
  record.summary.thermalResidual=100;assert.equal((await archive.list()).runs[0].summary.thermalResidual,0);
  assert.deepEqual(compactRunSummary({maxTemperature:NaN,minTemperature:0,steps:2}),{steps:2,minTemperature:0});
});

test('shared storage serializes cross-instance writes without losing versions or aliasing run IDs',async()=>{
  let counter=0;const storage=createMemoryArchiveStorage(),make=()=>createProjectArchive({storage,idFactory:()=>String(++counter)}),a=make(),b=make(),p=emptyProject();
  const [first,second]=await Promise.all([a.saveRevision(p),b.saveRevision(p)]);assert.equal(first.id,second.id);
  const [r1,r2]=await Promise.all([a.recordRun(run(p)),b.recordRun(run(p,{backend:'gpu',time:.3}))]);
  assert.notEqual(r1.id,r2.id);const state=await a.list();assert.equal(state.revisions.length,1);assert.equal(state.runs.length,2);
});

test('capacity limits reject atomically without silently evicting versions or orphaning run records',async()=>{
  const {archive}=fixture({limits:{revisions:1,runs:1}}),p=emptyProject(),saved=await archive.saveRevision(p);
  const changed=structuredClone(p);changed.name='needs another version';
  await assert.rejects(archive.recordRun(run(changed)),/容量已满/);assert.equal((await archive.list()).runs.length,0);
  const recorded=await archive.recordRun(run(p));await assert.rejects(archive.recordRun(run(p,{time:.4})),/容量已满/);
  assert.equal((await archive.getRevision(saved.id)).project.name,p.name);assert.equal((await archive.list()).runs[0].id,recorded.id);
  await archive.deleteRun(recorded.id);assert.equal((await archive.list()).revisions.length,1);assert.equal((await archive.list()).runs.length,0);
  await archive.recordRun(run(p));await archive.deleteRevision(saved.id);assert.equal((await archive.list()).revisions.length,0);assert.equal((await archive.list()).runs.length,0);
  await archive.saveRevision(changed);await archive.clear();assert.equal((await archive.list()).revisions.length,0);
  const small=fixture({limits:{bytes:20}}).archive;await assert.rejects(small.saveRevision(p),/容量已满/);assert.equal((await small.list()).revisions.length,0);
});

test('malformed persisted data stays hidden and never becomes a restore candidate',async()=>{
  const {archive,storage}=fixture();const good=await archive.saveRevision(emptyProject());const rows=await storage.read();
  const corrupt=structuredClone(rows[0]);corrupt.id='revision-corrupt';corrupt.project.name='tampered hash';
  const damaged=createMemoryArchiveStorage([...rows,corrupt,{id:'bad',schema:'unknown'}, {id:'run-bad',schema:'summer-run-record/1',revisionId:'missing'}]);
  const reopened=fixture({storage:damaged}).archive,state=await reopened.list();assert.equal(state.revisions.length,1);assert.equal(state.invalidCount,3);
  assert.equal(state.revisions[0].id,good.id);await assert.rejects(reopened.getRevision('revision-corrupt'),/不存在或已损坏/);
  await reopened.clear();assert.equal((await reopened.list()).invalidCount,0);
});

test('validation and storage failure leave previous durable data unchanged',async()=>{
  const {archive,storage}=fixture();await archive.saveRevision(emptyProject());const before=await storage.read();
  for(const bad of [{},{...emptyProject(),units:{length:'mm'}},{...emptyProject(),parts:[{id:'broken'}]}])assert.throws(()=>archive.saveRevision(bad));
  for(const bad of [{time:-1},{time:NaN},{outcome:'running'},{backend:'imaginary'},{targetTime:Infinity}])assert.throws(()=>archive.recordRun(run(emptyProject(),bad)));
  assert.deepEqual(await storage.read(),before);
  const unavailable=fixture({storage:{read:async()=>{throw Error('IndexedDB unavailable');},mutate:async()=>{throw Error('QuotaExceededError');}}}).archive;
  await assert.rejects(unavailable.list(),/unavailable/);await assert.rejects(unavailable.saveRevision(emptyProject()),/QuotaExceeded/);
  await assert.rejects(createIndexedDBArchiveStorage({indexedDB:null}).read(),/不支持本地归档/);
});

const native=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
test('real parametric CAD and explicit Tet4 topology survive durable revision restore',{skip:!native},async()=>{
  const modeling=createParametricSpec('l-bracket'),mesh=await runCAD({action:'mesh',recipe:compileParametricRecipe(modeling),options:{kind:'volume',targetSize:.2}});
  const project=addProjectPart(emptyProject(),{...cadFEMOptions(mesh,{id:'bracket',name:'参数支架',young:2e5}),modeling}),{archive,storage}=fixture();
  const revision=await archive.saveRevision(project,{label:'FEM 基准'}),reopened=fixture({storage}).archive,restored=(await reopened.getRevision(revision.id)).project;
  assert.deepEqual(restored.parts[0].modeling,modeling);
  assert.deepEqual(restored.parts[0].discretization.mesh.nodes,mesh.nodes);assert.deepEqual(restored.parts[0].discretization.mesh.elements,mesh.elements);
  assert.deepEqual(restored.parts[0].geometry.cad,project.parts[0].geometry.cad);assert.equal(restored.parts[0].material.young,2e5);
  assert.doesNotThrow(()=>validateFEM(restored));
  const recorded=await reopened.recordRun(run(restored,{summary:{nodeCount:mesh.nodes.length,elementCount:mesh.elements.length}}));assert.equal(recorded.revisionId,revision.id);
});
