import test from 'node:test';
import assert from 'node:assert/strict';
import {temperatureScale,temperatureColor,temperatureExtent} from '../src/simulation/temperature-display.js';

const frame=(fem=[20,20.002],particle=160)=>({fem:{parts:[{temperature:new Float64Array(fem)}]},particles:new Float32Array([0,0,0,11,particle,0,0,0]),bodies:[]});
test('hot MPM and almost isothermal FEM share one scale; 0.002°C cannot become red',()=>{
  const f=frame(),range=temperatureScale(f);assert.equal(range.min,20);assert.equal(range.max,160);
  const cold=temperatureColor(20,range),warm=temperatureColor(20.002,range),hot=temperatureColor(160,range);
  assert.ok(Math.hypot(...warm.map((v,k)=>v-cold[k]))<.0001);assert.ok(Math.hypot(...hot.map((v,k)=>v-cold[k]))>1);
  const before=structuredClone(f);temperatureScale(f,{temperatureMode:'fem'});assert.deepEqual(f,before);
});
test('local amplification is explicit and rigid/PBF temperatures participate in global range',()=>{
  const f=frame();f.bodies=[{temperature:-10},{temperature:300}];const global=temperatureScale(f),local=temperatureScale(f,{temperatureMode:'fem'});
  assert.deepEqual([global.min,global.max],[-10,300]);assert.deepEqual([local.min,local.max],[20,20.002]);
  assert.ok(temperatureColor(20.002,local)[0]>.99);assert.ok(temperatureExtent(f,'fem').span<.003);
});
test('fixed ranges survive frame changes; uniform/invalid ranges never divide by zero',()=>{
  const settings={temperatureMode:'manual',temperatureMin:0,temperatureMax:200},a=temperatureScale(frame(),settings),b=temperatureScale(frame([40,80],100),settings);
  assert.deepEqual(temperatureColor(80,a),temperatureColor(80,b));
  const uniform=temperatureScale(frame([20,20],20));assert.equal(uniform.max-uniform.min,1);
  assert.ok(temperatureColor(20,uniform).every(Number.isFinite));
  const invalid=temperatureScale(frame(),{temperatureMode:'manual',temperatureMin:100,temperatureMax:100});assert.equal(invalid.valid,false);assert.equal(invalid.max,160);
});
