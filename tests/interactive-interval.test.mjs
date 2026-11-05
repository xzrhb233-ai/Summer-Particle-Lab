import test from 'node:test';
import assert from 'node:assert/strict';
import {interactiveInterval} from '../src/simulation/interactive-interval.js';
const four=clock=>({mixed:{scheme:'resident-four-method/1',clock}});
test('four-method UI uses the accepted contact step and bounded batches',()=>{
  assert.equal(interactiveInterval(four({nextDt:.0002}),.01,2,.0002),.0032);
  assert.equal(interactiveInterval(four({nextDt:.00000625}),.01,2,.0002),.0001);
  assert.equal(interactiveInterval(four({minDt:.00000625}),.01,2,.0002),.0001);
  assert.equal(interactiveInterval(four({nextDt:.0002}),.001,2,.0002),.001);
  assert.equal(interactiveInterval(four({nextDt:.0002}),.01,.00001,.0002),.00001);
});
test('other adapters retain their output batching',()=>{
  assert.equal(interactiveInterval({},.01,2,.0002),.01);
  assert.equal(interactiveInterval({},.01,.002,.0002),.002);
});
