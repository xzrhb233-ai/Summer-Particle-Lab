import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {planCommands,prepareAssistantPlan,executePlan,parseAssistantResponse} from '../src/simulation/assistant-commands.js';
import {applyPhysicsCommand} from '../src/simulation/assistant-physics.js';
import {buildAssistantContext} from '../src/simulation/assistant-context.js';
import {validateFEM} from '../src/fem/model.js';
const command=(command,args)=>({command,args}),response=(...commands)=>({reply:'物理设置预览',commands});
const project=()=>addProjectPart(emptyProject(),{id:'beam',method:'fem',divisions:[2,1,1]});
const set={id:'tip',name:'端面',part:'beam',region:{type:'surface',surface:'box:x+'}};

test('AI named selection, FEM load and time binding form an atomic declarative transaction',async()=>{
  const p=project(),before=JSON.stringify(p);
  const plan=planCommands(p,response(command('selection.create',set),command('load.create',{id:'force',type:'fem-force',target:'beam',selection:'tip',force:[0,-10,0]}),command('curve.create',{id:'ramp',type:'linear',points:[[0,0],[1,1]]}),command('binding.create',{id:'drive',kind:'fem-force',target:'beam',load:'force',curve:'ramp',component:1,scale:-10})));
  assert.equal(JSON.stringify(p),before);assert.equal(plan.project.selectionSets.find(s=>s.id==='tip').entity,'face');
  assert.equal(plan.project.loadBindings[0].scale,-10);assert.equal(validateFEM(plan.project).loads.find(l=>l.id==='force').force[1],-10);
  let loaded=0,current=p;await executePlan(plan,{getProject:()=>current,busy:()=>false,assertApplied(){},load:async p=>{loaded++;current=p;}});assert.equal(loaded,1);
  const edited=applyPhysicsCommand(current,'load.update',{id:'force',force:[1,-20,0]});assert.equal(edited.loads.find(l=>l.id==='force').selection,'tip');
  assert.throws(()=>applyPhysicsCommand(edited,'selection.delete',{id:'tip'}),/仍被/);
  assert.throws(()=>applyPhysicsCommand(edited,'load.delete',{id:'force'}),/仍被/);
  assert.throws(()=>applyPhysicsCommand(edited,'curve.delete',{id:'ramp'}),/仍被/);
  let q=applyPhysicsCommand(edited,'binding.delete',{id:'drive'});q=applyPhysicsCommand(q,'load.delete',{id:'force'});q=applyPhysicsCommand(q,'selection.delete',{id:'tip'});q=applyPhysicsCommand(q,'curve.delete',{id:'ramp'});
  assert.equal(q.loadBindings.length,0);assert.equal(q.curves.length,0);
});

test('all three thermal load types retain a named selection across selection updates',()=>{
  let p=applyPhysicsCommand(project(),'selection.create',set);
  for(const [type,extra] of [['thermal-power',{power:30}],['thermal-temperature',{temperature:70}],['thermal-convection',{temperature:20,coefficient:5}]])p=applyPhysicsCommand(p,'load.create',{id:type,type,target:'beam',selection:'tip',...extra});
  p=applyPhysicsCommand(p,'selection.update',{id:'tip',region:{type:'surface',surface:'box:y+'}});
  for(const l of p.loads.filter(l=>l.type.startsWith('thermal-'))){assert.equal(l.selection,'tip');assert.equal(l.region.surface,'box:y+');}
  p=applyPhysicsCommand(p,'load.update',{id:'thermal-power',program:{type:'smooth',points:[[0,0],[1,30]]}});
  assert.equal(p.loads.find(l=>l.id==='thermal-power').program.points[1][1],30);
  p=applyPhysicsCommand(p,'load.update',{id:'thermal-power',program:null});assert.equal(p.loads.find(l=>l.id==='thermal-power').program,undefined);
  assert.throws(()=>applyPhysicsCommand(p,'load.update',{id:'thermal-power',selection:'tip',region:{type:'whole'}}),/同时/);
});

test('explicit CPU transient thermal enable precedes named heat loads and rejects unsupported solver switches',()=>{
  const p=project();p.solver.thermal=false;const original=structuredClone(p.solver);
  const plan=planCommands(p,response(command('solver.configure',{thermal:true}),command('selection.create',set),command('load.create',{id:'heat',type:'thermal-power',target:'beam',selection:'tip',power:5})));
  assert.equal(p.solver.thermal,false);assert.equal(plan.project.solver.thermal,true);assert.equal(plan.project.solver.adapter,original.adapter);assert.equal(plan.project.solver.dt,original.dt);validateFEM(plan.project);
  for(const bad of [{thermal:'yes'},{thermal:true,device:'gpu'}])assert.throws(()=>planCommands(p,response(command('solver.configure',bad))));
  const stat=structuredClone(p);stat.solver.adapter='cpu-fem-static';assert.throws(()=>planCommands(stat,response(command('solver.configure',{thermal:true}))),/仅支持/);
  assert.throws(()=>planCommands(emptyProject(),response(command('solver.configure',{thermal:true}))),/仅支持/);
});

test('FEM fixed and pressure, MPM region fixed use their existing solver schemas',()=>{
  let p=applyPhysicsCommand(project(),'selection.create',set);
  p=applyPhysicsCommand(p,'load.create',{id:'support2',type:'fem-fixed',target:'beam',selection:'tip'});
  p=applyPhysicsCommand(p,'load.create',{id:'pressure',type:'fem-pressure',target:'beam',selection:'tip',pressure:1200});validateFEM(p);
  let m=addProjectPart(emptyProject(),{id:'solid',method:'mpm'});
  m=applyPhysicsCommand(m,'selection.create',{id:'base',part:'solid',region:{type:'box',lower:[-.2,-.2,-.2],upper:[.2,0,.2]}});
  m=applyPhysicsCommand(m,'load.create',{id:'pin',type:'fixed-selection',target:'solid',selection:'base'});assert.equal(m.loads.find(l=>l.id==='pin').selection,'base');
});

test('unknown fields, executable payloads, impossible references and late invalid values never mutate input',async()=>{
  const p=project(),before=JSON.stringify(p);
  const bad=[command('selection.create',{...set,region:{...set.region,script:'alert(1)'}}),command('selection.create',{...set,region:{type:'surface',surface:'invented'}}),command('load.create',{id:'p',type:'fem-pressure',target:'beam',selection:'missing',pressure:2}),command('curve.create',{id:'c',type:'linear',points:[[0,0],[1,1]],path:'C:/private'}),command('load.create',{id:'q',type:'thermal-power',target:'beam',power:1,program:{type:'linear',points:[[0,0],[1,2]],eval:'code'}})];
  for(const c of bad){await assert.rejects(prepareAssistantPlan(p,response(command('selection.create',{...set,id:'safe'}),c)));assert.equal(JSON.stringify(p),before);}
  assert.throws(()=>parseAssistantResponse(JSON.stringify(response(command('selection.create',{...set,url:'https://example.test'})))),/不允许/);
  assert.throws(()=>applyPhysicsCommand(p,'load.create',{id:'unsafe',type:'body-force',target:'beam',force:[0,1,0]}));
});

test('compact AI context exposes actual named surface catalog without mesh arrays',()=>{
  const p=project(),c=buildAssistantContext(p,{}),part=c.project.parts[0];
  assert.equal(part.selectableSurfaces.length,6);assert.ok(part.selectableSurfaces.some(s=>s.key==='box:x+'));assert.equal(c.capabilities.resultQueries.maxSeriesPoints,100);
  assert.equal('triangles' in part.selectableSurfaces[0],false);
});

test('read-only queries execute while solving and never load, reset or accept mutation mixing',async()=>{
  const p=project(),plan=planCommands(p,response(command('result.query',{kind:'extrema',partId:'beam',field:'stress'})));
  const out=await executePlan(plan,{getProject:()=>p,busy:()=>true,assertApplied(){throw Error('not a mutation');},load(){throw Error('no load');},queryResults:args=>({available:true,field:args.field,max:42})});
  assert.equal(out.committed,false);assert.equal(out.results[0].max,42);
  assert.throws(()=>planCommands(p,response(command('result.query',{kind:'contacts'}),command('simulation.run',{}))),/不能混合/);
  assert.throws(()=>planCommands(p,response(command('result.query',{kind:'series',partId:'beam',field:'maxVonMises',limit:1000}))),/数量/);
});

test('physics application uses strict solver loading and does not stage failed validation as success',async()=>{
  const p=project(),before=JSON.stringify(p),plan=planCommands(p,response(command('selection.create',set),command('load.create',{id:'pressure',type:'fem-pressure',target:'beam',selection:'tip',pressure:1})));
  await assert.rejects(executePlan(plan,{getProject:()=>p,busy:()=>false,assertApplied(){},load(){throw Error('must not fall back');},loadStrict(){throw Error('no resolved surface triangles');}}),/no resolved/);
  assert.equal(JSON.stringify(p),before);
});
