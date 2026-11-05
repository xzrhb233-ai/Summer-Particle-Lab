import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';

function center(s, start, end) {
  let x = 0, y = 0, mass=0;
  for (let i = start; i < end; i++) { x += s.x[i]*s.mass[i]; y += s.y[i]*s.mass[i];mass+=s.mass[i]; }
  return { x: x / mass, y: y / mass };
}
const probe = new Simulation(); probe.makePlanet(0, 0, 64, 0, 0, false); const split = probe.count;

test('binary preset orbits its shared barycenter without collapsing or global damping', () => {
  const s = new Simulation(); s.reset('binary'); const count = s.count;
  assert.equal(s.settings.gravity, 'self');
  for (let i = 0; i < 600; i++) s.step();
  const a = center(s, 0, split), b = center(s, split, count), barycenter = center(s, 0, count);
  const separation = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(separation > 200 && separation < 290, `separation after 10 s: ${separation}`);
  assert.ok(Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) > .8, 'bodies should advance along their orbit');
  assert.ok(Math.hypot(barycenter.x, barycenter.y) < 3, `barycenter drift: ${JSON.stringify(barycenter)}`);
  assert.equal(s.count, count);
});
test('collision preset brings the material groups into contact and stays finite', () => {
  const s = new Simulation(); s.reset('collision'); const count = s.count;
  let closest = Infinity;
  for (let frame = 0; frame < 600; frame++) {
    s.step();
    if (frame % 30 === 0) {
      const a = center(s, 0, split), b = center(s, split, count);
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  assert.ok(closest < 105, `closest group separation: ${closest}`);
  assert.equal(s.count, count);
  for (let i = 0; i < count; i++) assert.ok(Number.isFinite(s.x[i] + s.y[i] + s.vx[i] + s.vy[i]));
});
test('uniform translational velocity is preserved in an isolated self-gravity scene', () => {
  const s = new Simulation(); s.reset('empty'); s.settings.gravity = 'self'; s.settings.thermal = false;
  s.add(110, 40, 2, 15, -7);
  for (let i = 0; i < 60; i++) s.step();
  assert.ok(Math.abs(s.x[0] - 125) < .02); assert.ok(Math.abs(s.y[0] - 33) < .02);
  assert.ok(Math.abs(s.vx[0] - 15) < .02);
});
