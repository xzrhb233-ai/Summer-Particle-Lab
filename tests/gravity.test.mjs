import test from 'node:test';
import assert from 'node:assert/strict';
import { GravityTree, GRAVITATIONAL_CONSTANT as G } from '../src/gravity.js';

function force(x, y, options = {}, masses) {
  const tree = new GravityTree(8), ax = new Float64Array(x.length), ay = new Float64Array(x.length);
  tree.build(x, y, x.length, masses); tree.accelerations(ax, ay, options);
  return { ax, ay, tree };
}
test('isolated and coincident particles do not exert self-force or produce NaN', () => {
  const single = force([300], [-250]);
  assert.equal(single.ax[0], 0); assert.equal(single.ay[0], 0);
  const coincident = force(new Float64Array(250), new Float64Array(250), { softening: 0 });
  assert.ok(coincident.ax.every(n => n === 0)); assert.ok(coincident.ay.every(n => n === 0));
  assert.ok(coincident.tree.nodes <= 25, 'coincident particles must terminate in a bounded-depth bucket');
  const empty = force([], []); assert.equal(empty.tree.nodes, 0);
});
test('two-body force matches the softened inverse-square law with unequal masses', () => {
  const { ax, ay } = force([-10, 10], [7, 7], { softening: 4 }, [2, 3]);
  const unit = G * 20 / (416 ** 1.5);
  assert.ok(Math.abs(ax[0] - 3 * unit) < 1e-12);
  assert.ok(Math.abs(ax[1] + 2 * unit) < 1e-12);
  assert.ok(Math.abs(2 * ax[0] + 3 * ax[1]) < 1e-12);
  assert.deepEqual([...ay], [0, 0]);
});
test('tree approximation stays within 2% RMS of direct forces on a nonuniform field', () => {
  let seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const n = 600, x = [], y = [], masses = [];
  for (let i = 0; i < n; i++) { x.push((random() - .5) * (i % 2 ? 400 : 50)); y.push((random() - .5) * 300); masses.push(.5 + random() * 3); }
  const approx = force(x, y, { theta: .65, softening: 8 }, masses);
  let error2 = 0, magnitude2 = 0;
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0;
    for (let j = 0; j < n; j++) if (i !== j) {
      const dx = x[j] - x[i], dy = y[j] - y[i], f = G * masses[j] / ((dx * dx + dy * dy + 64) ** 1.5);
      ax += dx * f; ay += dy * f;
    }
    error2 += (ax - approx.ax[i]) ** 2 + (ay - approx.ay[i]) ** 2;
    magnitude2 += ax * ax + ay * ay;
  }
  const relativeError = Math.sqrt(error2 / magnitude2);
  assert.ok(relativeError < .02, `relative RMS error: ${relativeError}`);
  const translated = force(x.map(v => v + 321), y.map(v => v - 234), { theta: .65, softening: 8 }, masses);
  for (let i = 0; i < n; i++) assert.ok(Math.hypot(translated.ax[i] - approx.ax[i], translated.ay[i] - approx.ay[i]) < 1e-8);
});
test('opening angle zero reproduces exact forces and strength zero clears output', () => {
  const x = Array.from({ length: 100 }, (_, i) => i * 2), y = x.map(v => Math.sin(v) * 10);
  const { tree, ax, ay } = force(x, y, { theta: 0 });
  let expected = 0;
  for (let j = 1; j < x.length; j++) expected += G * x[j] / ((x[j] ** 2 + y[j] ** 2 + 64) ** 1.5);
  assert.ok(Math.abs(ax[0] - expected) < 1e-10);
  tree.accelerations(ax, ay, { strength: 0 });
  assert.ok(ax.every(v => v === 0) && ay.every(v => v === 0));
});
