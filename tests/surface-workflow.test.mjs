import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCAD} from '../cad-server.mjs';
import {namedSurfaceExample} from '../src/simulation/surface-example.js';
import {resolveSurfaceSelection} from '../src/simulation/surface-selections.js';
import {FEMDynamicSimulation,faceMean} from '../src/fem/dynamic.js';
import {cantileverProject,dynamicCantileverProject} from '../src/fem/model.js';
import {beamReference,tipDisplacement} from '../src/fem/validation.js';
import {boxMesh} from '../src/fem/mesh.js';

const python=fileURLToPath(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const available=existsSync(python)&&spawnSync(python,['-c','import usd_brep, meshpy.tet'],{windowsHide:true}).status===0;
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('native named-surface example runs the public AI geometry path with initial 20°C, pressure, fixed support and local heating',{skip:!available},async t=>{
  let calls=0;
  const p=await namedSurfaceExample({buildMesh:(recipe,options)=>{calls++;assert.equal(options.kind,'volume');return runCAD({action:'mesh',recipe,options});}});
  assert.equal(calls,1);assert.equal(p.parts.length,1);assert.equal(p.parts[0].modeling.template,'four-hole-plate');
  assert.equal(p.solver.computeBackend,'cpu');assert.equal(p.solver.thermal,true);assert.equal(p.parts[0].initial.temperature,20);
  const sim=new FEMDynamicSimulation(JSON.parse(JSON.stringify(p))),state=sim.states[0],part=p.parts[0],mesh=state.mesh;
  assert.ok(mesh.nodes.length<=5000&&mesh.cells.length<=24000);state.thermal.temperature.forEach(T=>near(T,20,1e-12));
  const support=resolveSurfaceSelection(part,mesh,p.selectionSets.find(s=>s.id==='support'));
  const wall=resolveSurfaceSelection(part,mesh,p.selectionSets.find(s=>s.id==='heated-hole'));
  assert.equal(wall.key,'four-hole-plate:hole:x-:z-');assert.ok(wall.triangles.every(f=>f.face==='surface'));
  for(let n=0;n<mesh.nodes.length;n++)assert.equal(state.fixed[3*n],support.nodes.includes(n)?1:0);
  const pressure=p.loads.find(l=>l.id==='hole-pressure');assert.equal(pressure.selection,'heated-hole');assert.equal(pressure.pressure,1000);
  const expected=new Float64Array(state.f.length);
  for(const f of wall.triangles)for(const n of f.nodes)for(let k=0;k<3;k++)expected[3*n+k]-=pressure.pressure*f.area*f.normal[k]/3;
  expected.forEach((v,i)=>near(state.f[i],v));assert.ok(expected.some(v=>Math.abs(v)>0));
  const heat=sim.thermal.loads.items[0];assert.equal(heat.definition.selection,'heated-hole');
  assert.deepEqual(heat.entries.map(e=>e.index).sort((a,b)=>a-b),wall.nodes.slice().sort((a,b)=>a-b));
  const before=sim.thermal.energy(),duration=.002,frame=sim.step(duration),summary=frame.fem.parts[0].summary;
  near(sim.thermal.externalHeat,100000*duration,1e-7);near(sim.thermal.energy()-before,100000*duration,1e-6);near(frame.thermal.residual,0,1e-6);
  const wallMean=wall.nodes.reduce((v,n)=>v+state.thermal.temperature[n],0)/wall.nodes.length;
  assert.ok(wallMean>20);assert.ok(summary.maxTemperature>20);assert.ok(summary.maxDisplacement>0);
  assert.ok(state.u.every(Number.isFinite));assert.ok(state.thermal.temperature.every(Number.isFinite));
  assert.equal(summary.responseSurface.key,wall.key);assert.ok(summary.tip.every(Number.isFinite));
  const actual=[0,0,0];for(const f of wall.triangles)for(const n of f.nodes)for(let k=0;k<3;k++)actual[k]+=state.u[3*n+k]*f.area/(3*wall.area);
  summary.tip.forEach((v,k)=>near(v,actual[k],1e-15));assert.equal(beamReference(p),null);
  t.diagnostic(JSON.stringify({nodes:mesh.nodes.length,elements:mesh.cells.length,wallTriangles:wall.triangles.length,wallNodes:wall.nodes.length,wallArea:wall.area,time:sim.time,steps:sim.steps,heat:frame.thermal.externalHeat,heatResidual:frame.thermal.residual,wallMeanTemperature:wallMean,maxTemperature:summary.maxTemperature,maxDisplacement:summary.maxDisplacement,maxVonMises:summary.maxVonMises}));
});

test('derived surface means use named triangles, retain valid box beam theory and never substitute an absent face',()=>{
  const p=cantileverProject({divisions:[2,1,1]}),old=beamReference(p);
  p.selectionSets.forEach(s=>s.region={type:'surface',surface:'box:'+s.region.face});assert.deepEqual(beamReference(p),old);
  const mesh=boxMesh(p.parts[0]),values=Float64Array.from({length:3*mesh.nodes.length},(_,i)=>i+1);
  assert.deepEqual(faceMean(mesh,values,'box:x+'),faceMean(mesh,values,'x+'));
  assert.deepEqual(tipDisplacement({...mesh,displacement:values},'box:x+'),faceMean(mesh,values,'x+'));
  assert.deepEqual(faceMean(mesh,values,'missing'),[null,null,null]);
  assert.deepEqual(tipDisplacement({...mesh,displacement:values},'missing'),[null,null,null]);
  const cad=structuredClone(p);cad.parts[0].geometry.shape='cad';assert.equal(beamReference(cad),null);
});

test('dynamic response follows the first actual load even with mixed named and legacy surfaces; absent loads report no response surface',()=>{
  const p=dynamicCantileverProject({divisions:[2,1,1],force:[0,0,0]});p.curves=[];p.loadBindings=[];p.solver.initialState='rest';
  p.selectionSets[1].region={type:'surface',surface:'box:y+'};
  p.selectionSets.push({id:'legacy-tip',name:'Legacy tip',part:'beam',entity:'face',region:{type:'face',face:'x+'}});
  p.loads.push({id:'second-force',type:'fem-force',target:'beam',selection:'legacy-tip',force:[0,1,0]});
  const sim=new FEMDynamicSimulation(p),s=sim.states[0];s.u=Float64Array.from(s.u,(_,i)=>i*.001);
  const summary=sim.snapshot().fem.parts[0].summary;assert.equal(summary.responseSurface.key,'box:y+');
  assert.deepEqual(summary.tip,faceMean(s.mesh,s.u,'box:y+'));assert.notDeepEqual(summary.tip,faceMean(s.mesh,s.u,'x+'));
  p.loads=p.loads.filter(l=>l.type==='fem-fixed');const empty=new FEMDynamicSimulation(p).snapshot().fem.parts[0].summary;
  assert.equal(empty.responseSurface,null);assert.deepEqual(empty.tip,[null,null,null]);assert.deepEqual(empty.tipVelocity,[null,null,null]);
});
