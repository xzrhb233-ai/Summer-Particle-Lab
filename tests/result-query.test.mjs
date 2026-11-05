import test from 'node:test';
import assert from 'node:assert/strict';
import {queryProjectResults} from '../src/simulation/result-query.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {FEMSimulation} from '../src/fem/solver.js';
const project=()=>addProjectPart(emptyProject(),{id:'beam',method:'fem',divisions:[2,1,1]});
const frame=()=>({time:1,fem:{analysis:'linear-dynamic',solved:true,parts:[{id:'beam',nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],cells:[[0,1,2,3]],displacement:new Float64Array([0,0,0,0,3,4,0,0,0,0,0,0]),temperature:new Float64Array([20,25,30,40]),vonMises:[12],summary:{maxDisplacement:5,maxTemperature:40,temperature:28,maxVonMises:12}}]},results:{parts:[{id:'beam',method:'fem',values:{maxDisplacement:5,maxTemperature:40,temperature:28,maxVonMises:12}}]},contactPairs:[{id:'contact',a:'beam',b:'body',force:[3,4,0],normalForce:4,heatRate:10,maxPenetration:null}]});

test('queries report real FEM extrema and locations without arrays or invented zeros',()=>{
  const p=project(),f=frame(),query=field=>queryProjectResults({project:p,frame:f,resultProject:p},{kind:'extrema',partId:'beam',field}).data[0];
  assert.equal(query('displacement').max,5);assert.deepEqual(query('displacement').maxLocation,[1,0,0]);
  assert.equal(query('temperature').min,20);assert.equal(query('temperature').max,40);
  assert.equal(query('stress').max,12);assert.deepEqual(query('stress').maxLocation,[.25,.25,.25]);
  const missing=queryProjectResults({project:p,frame:f,resultProject:p},{kind:'extrema',partId:'absent',field:'stress'});assert.equal(missing.available,false);assert.equal(missing.data[0].max,null);
  assert.equal(JSON.stringify(query('stress')).includes('nodes'),false);
});

test('preview, unsolved and unknown-origin results are unavailable; older origins are explicit',()=>{
  const p=project(),f=frame(),args={kind:'extrema',field:'stress'};
  for(const state of [{frame:null,resultProject:p},{frame:{...f,preview:true},resultProject:p},{frame:{...f,fem:{...f.fem,analysis:'linear-static',solved:false}},resultProject:p},{frame:f}])assert.equal(queryProjectResults({project:p,...state},args).available,false);
  const changed=structuredClone(p);changed.name='new configuration';const q=queryProjectResults({project:changed,frame:f,resultProject:p},args);
  assert.equal(q.available,true);assert.equal(q.matchesCurrentConfiguration,false);assert.notEqual(q.currentConfigurationId,q.resultConfigurationId);
});

test('series are bounded with endpoints and reject mixed run origins and future playback samples',()=>{
  const p=project(),other=structuredClone(p);other.name='other run';
  const frames=Array.from({length:101},(_,i)=>({frame:{time:i/100,results:{parts:[{id:'beam',values:{maxDisplacement:i}}]}},resultProject:p}));
  frames.push({frame:{time:.5,results:{parts:[{id:'beam',values:{maxDisplacement:9999}}]}},resultProject:other});
  frames.push({frame:{time:2,results:{parts:[{id:'beam',values:{maxDisplacement:10000}}]}},resultProject:p});
  const q=queryProjectResults({project:p,frame:frame(),frames,resultProject:p},{kind:'series',partId:'beam',field:'maxDisplacement',limit:10});
  assert.equal(q.data.length,10);assert.equal(q.data[0].value,0);assert.equal(q.data.at(-1).value,100);assert.equal(q.omittedSamples,2);assert.equal(q.downsampled,true);
  const empty=queryProjectResults({project:p,frame:frame(),frames:[],resultProject:p},{kind:'series',partId:'beam',field:'maxVonMises'});assert.equal(empty.available,false);assert.deepEqual(empty.data,[]);
});

test('contact queries retain missing values and explicit units',()=>{
  const p=project(),q=queryProjectResults({project:p,frame:frame(),resultProject:p},{kind:'contacts'});
  assert.equal(q.data[0].normalForce,4);assert.equal(q.data[0].maxPenetration,null);assert.equal(q.data[0].tangentialForce,null);assert.equal(q.units.heatRate,'W');
});

test('actual small FEM solution agrees with query stress and displacement extrema',()=>{
  const p=project();Object.assign(p.solver,{adapter:'cpu-fem-static',analysis:'linear-static'});const sim=new FEMSimulation(p),f=sim.step();
  for(const [field,key] of [['stress','maxVonMises'],['displacement','maxDisplacement']]){
    const q=queryProjectResults({project:p,frame:f,resultProject:p},{kind:'extrema',partId:'beam',field});assert.equal(q.available,true);assert.equal(q.data[0].max,f.fem.parts[0].summary[key]);
  }
});
