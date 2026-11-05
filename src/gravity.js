// Barnes–Hut quadtree for particles moving in a plane, with a softened 1/r² law.
// Buckets and a minimum cell size also handle coincident particles safely.
export const GRAVITATIONAL_CONSTANT = 100;
export class GravityTree {
  constructor(capacity = 16000) {
    this.order = new Int32Array(capacity);
    this.stack = new Int32Array(128);
    this.allocated = 0;
    this.grow(Math.max(64, capacity * 2));
    this.nodes = 0;
  }
  grow(size) {
    for (const name of ['cx', 'cy', 'half', 'mass', 'mx', 'my']) {
      const a = new Float64Array(size); if (this[name]) a.set(this[name]); this[name] = a;
    }
    for (const name of ['start', 'end', 'c0', 'c1', 'c2', 'c3']) {
      const a = new Int32Array(size); if (this[name]) a.set(this[name]); this[name] = a;
    }
    this.allocated = size;
  }
  build(x, y, count, masses = null) {
    this.x = x; this.y = y; this.masses = masses; this.count = count; this.nodes = 0;
    if (!count) return;
    if (this.order.length < count) this.order = new Int32Array(count);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      this.order[i] = i;
      minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
      minY = Math.min(minY, y[i]); maxY = Math.max(maxY, y[i]);
    }
    this.buildNode(0, count, (minX + maxX) / 2, (minY + maxY) / 2, Math.max(1, (maxX - minX) / 2, (maxY - minY) / 2) + .001, 0);
  }
  partition(start, end, axis, mid) {
    const order = this.order;
    let left = start, right = end - 1;
    while (left <= right) {
      if (axis[order[left]] < mid) left++;
      else { const temp = order[left]; order[left] = order[right]; order[right--] = temp; }
    }
    return left;
  }
  buildNode(start, end, cx, cy, half, depth) {
    if (this.nodes === this.allocated) this.grow(this.allocated * 2);
    const node = this.nodes++;
    this.start[node] = start; this.end[node] = end; this.cx[node] = cx; this.cy[node] = cy; this.half[node] = half;
    this.c0[node] = this.c1[node] = this.c2[node] = this.c3[node] = -1;
    let mass = 0, mx = 0, my = 0;
    for (let k = start; k < end; k++) {
      const i = this.order[k], m = this.masses ? this.masses[i] : 1;
      mass += m; mx += this.x[i] * m; my += this.y[i] * m;
    }
    this.mass[node] = mass; this.mx[node] = mass ? mx / mass : cx; this.my[node] = mass ? my / mass : cy;
    if (end - start <= 8 || half <= .5 || depth >= 24) return node;
    const middle = this.partition(start, end, this.x, cx);
    const left = this.partition(start, middle, this.y, cy);
    const right = this.partition(middle, end, this.y, cy);
    const h = half / 2;
    if (left > start) { const child = this.buildNode(start, left, cx - h, cy - h, h, depth + 1); this.c0[node] = child; }
    if (middle > left) { const child = this.buildNode(left, middle, cx - h, cy + h, h, depth + 1); this.c1[node] = child; }
    if (right > middle) { const child = this.buildNode(middle, right, cx + h, cy - h, h, depth + 1); this.c2[node] = child; }
    if (end > right) { const child = this.buildNode(right, end, cx + h, cy + h, h, depth + 1); this.c3[node] = child; }
    return node;
  }
  accelerations(ax, ay, { strength = 1, softening = 8, theta = .65 } = {}) {
    ax.fill(0, 0, this.count); ay.fill(0, 0, this.count);
    if (!this.nodes || !strength) return;
    const G = GRAVITATIONAL_CONSTANT * strength, eps2 = Math.max(.01, softening) ** 2, theta2 = theta * theta;
    const { x, y, stack, order } = this;
    for (let i = 0; i < this.count; i++) {
      const px = x[i], py = y[i];
      let top = 1, fx = 0, fy = 0; stack[0] = 0;
      while (top) {
        const n = stack[--top];
        const leaf = this.c0[n] < 0 && this.c1[n] < 0 && this.c2[n] < 0 && this.c3[n] < 0;
        if (leaf) {
          for (let k = this.start[n]; k < this.end[n]; k++) {
            const j = order[k]; if (j === i) continue;
            const dx = x[j] - px, dy = y[j] - py, r2 = dx * dx + dy * dy + eps2;
            const f = G * (this.masses ? this.masses[j] : 1) / (r2 * Math.sqrt(r2));
            fx += dx * f; fy += dy * f;
          }
        } else {
          const dx = this.mx[n] - px, dy = this.my[n] - py, distance2 = dx * dx + dy * dy;
          // Never approximate a cell containing the target, to exclude self-force.
          const contains = Math.abs(px - this.cx[n]) <= this.half[n] && Math.abs(py - this.cy[n]) <= this.half[n];
          if (!contains && 4 * this.half[n] ** 2 < theta2 * distance2) {
            const r2 = distance2 + eps2, f = G * this.mass[n] / (r2 * Math.sqrt(r2));
            fx += dx * f; fy += dy * f;
          } else {
            if (this.c0[n] >= 0) stack[top++] = this.c0[n];
            if (this.c1[n] >= 0) stack[top++] = this.c1[n];
            if (this.c2[n] >= 0) stack[top++] = this.c2[n];
            if (this.c3[n] >= 0) stack[top++] = this.c3[n];
          }
        }
      }
      ax[i] = fx; ay[i] = fy;
    }
  }
}
