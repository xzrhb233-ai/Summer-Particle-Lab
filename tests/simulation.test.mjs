import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, CAPACITY } from '../src/simulation.js';

test('seeded planet remains finite and bounded under sustained simulation', () => {
  const s = new Simulation(); s.reset('planet'); const count = s.count;
  assert.ok(count > 6000 && count < 7000);
  for (let frame = 0; frame < 180; frame++) s.step();
  assert.equal(s.count, count);
  for (let i = 0; i < s.count; i++) {
    assert.ok(Number.isFinite(s.x[i] + s.y[i] + s.vx[i] + s.vy[i] + s.temperature[i]));
    assert.ok(Math.abs(s.x[i]) <= 555 && Math.abs(s.y[i]) <= 555);
  }
  const frame = s.snapshot();
  assert.equal(frame.composition.reduce((a, b) => a + b), count);
  assert.ok(frame.composition[2] > 500, 'water should not boil away immediately');
});

test('gravity attracts liquid while gas rises in a uniform field', () => {
  const s = new Simulation(); s.settings.gravity = 'uniform'; s.settings.thermal = false;
  s.add(-50, 50, 2); s.add(50, 50, 3);
  for (let i = 0; i < 30; i++) s.step();
  assert.ok(s.y[0] < 50); assert.ok(s.y[1] > 50);
});

test('boiling requires latent heat and preserves parcel mass', () => {
  const s = new Simulation(); s.add(0, 0, 2, 0, 0, 100);const mass=s.mass[0];
  s.addHeat(0,1000000);assert.equal(s.material[0],2);assert.equal(s.temperature[0],100);
  s.addHeat(0,1256000+2010*10);assert.equal(s.material[0],3);assert.ok(Math.abs(s.temperature[0]-110)<.001);
  assert.equal(s.mass[0],mass);
  s.addHeat(0,-(2256000+2010*10+4180*20));assert.equal(s.material[0],2);assert.equal(s.temperature[0],80);
});

test('paint emits selected material and erase removes only the brush region', () => {
  const s = new Simulation(); s.reset('empty'); s.settings.gravity = 'none';
  s.setPointer({ active: true, tool: 'emit', material: 6, x: 20, y: 20, radius: 18 });
  for (let i = 0; i < 12; i++) s.step();
  assert.ok(s.count > 20); assert.ok(s.material.subarray(0, s.count).every(m => m === 6));
  s.add(200, 200, 5);
  s.setPointer({ tool: 'erase', radius: 45 }); s.step();
  assert.equal(s.count, 1); assert.equal(s.material[0], 5);
});

test('hot/cold brushes change temperature and drag moves the captured group', () => {
  const s = new Simulation(); s.settings.gravity = 'none'; s.settings.thermal = false;
  s.add(0, 0, 2); s.add(90, 0, 5);
  s.setPointer({ active: true, tool: 'heat', x: 0, y: 0, radius: 20 });
  for (let i = 0; i < 10; i++) s.step();
  assert.ok(s.temperature[0]>24 && s.temperature[0]<26);assert.equal(s.material[0],2); assert.equal(s.temperature[1], 65);
  s.setPointer({ active: false }); s.setPointer({ active: true, tool: 'drag', x: 90, y: 0, radius: 20 });
  s.setPointer({ x: 120 });
  for (let i = 0; i < 8; i++) s.step();
  assert.ok(s.x[1] > 110);
});

test('snapshot buffers recycle; capacity and reset stay consistent', () => {
  const s = new Simulation();
  for (let i = 0; i < CAPACITY + 5; i++) s.add(0, 0, 0);
  assert.equal(s.count, CAPACITY);
  const a = s.snapshot(); const b = s.snapshot(a.buffer);
  assert.equal(a.buffer, b.buffer);
  s.reset('empty'); assert.equal(s.count, 0); assert.equal(s.snapshot().temperature, 0);
  s.reset('basin'); assert.equal(s.settings.gravity, 'uniform'); assert.ok(s.count > 1000);
});
