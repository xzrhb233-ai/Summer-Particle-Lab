import { MATERIALS } from './materials.js';
import { GravityTree, GRAVITATIONAL_CONSTANT } from './gravity.js';
import { enthalpyAt, decodeEnthalpy, exchangeHeat } from './thermal.js';
import { Structures } from './structures.js';
import { SolidMPM, isMPMSolid } from './solid-mpm.js';

export const CAPACITY = 16000;
const H = 8, H2 = H * H, LIMIT = 560, GRID = Math.ceil(2 * LIMIT / H) + 4;
const STEP = 1 / 120;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Position-based density constraints, compact cubic kernel and a fixed grid.
// SI reference thermodynamics; geometry, gravity and time are sandbox scales.
export class Simulation {
  constructor(seed = 139) {
    this.seed = seed;
    this.mpm = new SolidMPM(CAPACITY);
    for (const name of ['x', 'y', 'vx', 'vy', 'oldX', 'oldY', 'temperature', 'lambda', 'deltaX', 'deltaY', 'heat', 'gravityX', 'gravityY']) this[name] = new Float32Array(CAPACITY);
    for (const name of ['mass','invMass','volume','anchorX','anchorY']) this[name] = new Float32Array(CAPACITY);
    this.bondWait = new Uint16Array(CAPACITY);
    for (const name of ['enthalpy','heat','thermalBudget']) this[name] = new Float64Array(CAPACITY);
    this.pinned = new Uint8Array(CAPACITY); this.kind = new Uint8Array(CAPACITY);
    this.structures = new Structures(this); this.bondPending = []; this.thermalPairs = [];
    this.gravityTree = new GravityTree(CAPACITY);
    this.gravityMs = 0;
    this.material = new Uint8Array(CAPACITY);
    this.next = new Int32Array(CAPACITY);
    this.head = new Int32Array(GRID * GRID);
    this.cell = new Int32Array(CAPACITY);
    this.count = 0;
    this.settings = { solidStiffness:1, gravity: 'center', strength: 1, softening: 8, thermal: true, heatRate: 20, brushPower:180000, ambient: false, boundary: true, speed: 1 };
    this.exchangedHeat = 0;
    this.pointer = { active: false, x: 0, y: 0, radius: 24, tool: 'emit', material: 1, reverse: false };
    this.grabbed = [];
    this.scene = 'planet';
    this.time = 0;
    this.emissionRemainder = 0;
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  add(x, y, material, vx = 0, vy = 0, temperature = MATERIALS[material].temp) {
    if (this.count >= CAPACITY || !Number.isFinite(x + y + vx + vy + temperature)) return false;
    const i = this.count++;
    this.mpm.resetParticle(i);
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.material[i] = material; this.temperature[i] = temperature;
    this.mass[i] = MATERIALS[material].density / 1000;
    this.invMass[i] = 1 / this.mass[i]; this.volume[i] = 1;
    this.enthalpy[i] = enthalpyAt(material,temperature);
    this.pinned[i] = 0;this.kind[i]=isMPMSolid(material)?2:0;this.bondPending.push(i);
    this.bondWait[i]=120;
    return true;
  }
  reset(scene = 'planet') {
    this.count = 0; this.scene = scene; this.time = 0; this.seed = 139;
    this.mpm.reset();
    this.exchangedHeat = 0;
    this.structures = new Structures(this); this.bondPending = [];
    this.pointer.active = false; this.grabbed = []; this.emissionRemainder = 0;
    this.settings.gravity = ['softbody','basin','density','elastic'].includes(scene) ? 'uniform' : scene === 'thermal' ? 'none' : ['binary', 'collision'].includes(scene) ? 'self' : 'center';
    this.gravityMs = 0; this.gravityTree.nodes = 0;
    if (scene === 'planet') this.makePlanet(0, 0, 155);
    if(scene==='softbody') {
      this.mpm.create(this,{x1:-120,y1:70,x2:-45,y2:98,fixed:true});
      this.mpm.create(this,{x1:30,y1:10,x2:90,y2:70});
      for(let y=-135;y<-110;y+=3.35)for(let x=-150;x<150;x+=3.85)this.add(x,y,2);
    }
    if (scene === 'binary' || scene === 'collision') this.makeBinary(scene === 'collision');
    if (scene === 'basin') {
      for (let y = -165; y < -30; y += 3.35) for (let x = -205; x < 205; x += 3.85) {
        if (Math.abs(x) > 180 || y < -145) {
          this.add(x, y, 0);
          if(y < -159)this.structures.pin(this.count-1,true);
        }
        else if (y < -60) this.add(x, y, x < -45 ? 2 : x > 55 ? 1 : 6);
      }
    }
    if (scene === 'density') {
      for(let y=-145;y<-20;y+=3.4)for(let x=-130;x<130;x+=3.9)this.add(x,y,2,0,0,0);
      for(let y=5;y<28;y+=3.4)for(let x=-72;x<-48;x+=3.9)this.add(x,y,4,0,0,-5);
      for(let y=5;y<28;y+=3.4)for(let x=48;x<72;x+=3.9)this.add(x,y,5,0,0,0);
      for(const [x1,y1,x2,y2] of [[-140,-155,140,-155],[-140,-155,-140,35],[140,-155,140,35]]) {
        const start=this.count; this.structures.create({x1,y1,x2,y2,material:7});
        for(let i=start;i<this.count;i++)this.structures.pin(i,true);
      }
    }
    if(scene === 'elastic') {
      this.structures.create({x1:-130,y1:95,x2:-10,y2:95,material:7,fixed:true});
      this.structures.create({x1:-130,y1:20,x2:-10,y2:20,material:8,fixed:true});
      this.structures.create({x1:65,y1:110,x2:125,y2:5,material:9,fixed:true});
      for(let y=115;y<132;y+=3.4)for(let x=-35;x<-12;x+=3.9)this.add(x,y,5);
    }
    if(scene === 'thermal') {
      // Same mass: water and iron each 1 kg per sample. The hot iron bar
      // conducts longitudinally; the water stores more heat per degree.
      for(const [cx,mat] of [[-65,5],[65,2]])for(let row=0;row<9;row++)for(let col=0;col<9;col++) {
        this.add(cx+(col-4)*3.9,(row-4)*3.4,mat,0,0,col<3?90:20);
        this.mass[this.count-1]=1;this.invMass[this.count-1]=1;
        this.volume[this.count-1]=1000/MATERIALS[mat].density;
        this.structures.pin(this.count-1,true);
      }
    }
    this.buildGrid(); this.flushBonds();
  }
  makeBinary(collision) {
    const separation = collision ? 210 : 250;
    this.makePlanet(0, 0, 64, 0, 0, false);
    const firstCount = this.count;
    this.makePlanet(0, 0, 53, 0, 0, false);
    const total = this.count;
    let firstMass=0,totalMass=0;
    for(let i=0;i<total;i++){ totalMass+=this.mass[i]; if(i<firstCount)firstMass+=this.mass[i]; }
    const relativeSpeed = Math.sqrt(GRAVITATIONAL_CONSTANT * totalMass / separation) * Math.sqrt(this.settings.strength);
    const tangent = relativeSpeed * (collision ? .9 : 1);
    const radial = collision ? 42 : 0;
    for (let i = 0; i < total; i++) {
      const fraction = i < firstCount ? -(totalMass-firstMass) / totalMass : firstMass / totalMass;
      this.x[i] += separation * fraction;
      this.vx[i] += -radial * fraction;
      this.vy[i] += tangent * fraction;
    }
    let cx = 0, cy = 0, vx = 0, vy = 0;
    for (let i = 0; i < total; i++) { const m=this.mass[i]; cx += this.x[i]*m; cy += this.y[i]*m; vx += this.vx[i]*m; vy += this.vy[i]*m; }
    for (let i = 0; i < total; i++) { this.x[i] -= cx / totalMass; this.y[i] -= cy / totalMass; this.vx[i] -= vx / totalMass; this.vy[i] -= vy / totalMass; }
  }
  makePlanet(cx, cy, radius, vx = 0, vy = 0, atmosphere = true) {
    let row = 0;
    for (let y = -radius; y <= radius; y += 3.32, row++) {
      for (let x = -radius; x <= radius; x += 3.83) {
        const px = x + (row % 2) * 1.915;
        const r = Math.hypot(px, y) / radius;
        if (r > 1) continue;
        const theta = Math.atan2(y, px);
        const edge = .018 * Math.sin(theta * 7) + .012 * Math.cos(theta * 13);
        let mat = r < .38 + edge ? 5 : r < .52 + edge ? 0 : r < .77 + edge ? 1 : r < .81 + edge ? 0 : r < .97 + edge ? 2 : 4;
        if (mat === 4 && this.random() < .4) mat = 2;
        this.add(cx + px + (this.random() - .5) * .3, cy + y + (this.random() - .5) * .3, mat, vx - y * .015, vy + px * .015, MATERIALS[mat].temp + (this.random() - .5) * (mat === 1 ? 180 : 7));
      }
    }
    for (let i = 0; atmosphere && i < radius * 2.2; i++) {
      const a = this.random() * Math.PI * 2, r = radius * (1.02 + this.random() * .14);
      this.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, vx - Math.sin(a) * 3, vy + Math.cos(a) * 3, 120 + this.random() * 30);
    }
  }
  setPointer(value) {
    const wasActive = this.pointer.active;
    Object.assign(this.pointer, value);
    if (!this.pointer.active) this.grabbed = [];
    if (this.pointer.active && !wasActive && this.pointer.tool === 'drag') {
      const { x, y, radius } = this.pointer;
      this.grabbed = [];
      for (let i = 0; i < this.count; i++) if ((this.x[i] - x) ** 2 + (this.y[i] - y) ** 2 < radius * radius) {
        this.grabbed.push([i, this.x[i] - x, this.y[i] - y]);
      }
    }
  }
  buildGrid() {
    this.head.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const gx = clamp(Math.floor((this.x[i] + LIMIT) / H) + 2, 1, GRID - 2);
      const gy = clamp(Math.floor((this.y[i] + LIMIT) / H) + 2, 1, GRID - 2);
      const cell = gy * GRID + gx;
      this.cell[i] = cell; this.next[i] = this.head[cell]; this.head[cell] = i;
    }
  }
  removeAt(i) {
    const last = --this.count;
    this.mpm.removeParticle(i,last);
    this.structures.removeParticle(i,last);
    this.bondPending = this.bondPending.filter(n=>n!==i).map(n=>n===last?i:n);
    if (last === i) return;
    for (const k of ['x', 'y', 'vx', 'vy', 'temperature', 'material','mass','invMass','volume','enthalpy','pinned','kind','anchorX','anchorY','bondWait']) this[k][i] = this[k][last];
  }
  forNear(x,y,r,visit) {
    const x0=clamp(Math.floor((x-r+LIMIT)/H)+2,0,GRID-1),x1=clamp(Math.floor((x+r+LIMIT)/H)+2,0,GRID-1);
    const y0=clamp(Math.floor((y-r+LIMIT)/H)+2,0,GRID-1),y1=clamp(Math.floor((y+r+LIMIT)/H)+2,0,GRID-1);
    for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++)for(let j=this.head[yy*GRID+xx];j>=0;j=this.next[j])visit(j);
  }
  flushBonds() {
    if(!this.bondPending.length){if(this.structures.rigidDirty)this.structures.rebuildRigidGroups();return;}
    this.structures.solidify(this.bondPending);
    // Newly painted/frozen matter gets a short settling window to find contacts.
    // Mature solids do not weld on every collision or heal after a cut.
    const linked=new Set();for(const e of this.structures.edges){linked.add(e.a);linked.add(e.b);}
    this.bondPending=this.bondPending.filter(i=>i<this.count && !this.kind[i] && MATERIALS[this.material[i]].solid && !linked.has(i) && this.bondWait[i]>0 && --this.bondWait[i]>=0);
    if(this.structures.rigidDirty)this.structures.rebuildRigidGroups();
  }
  addHeat(i,joules) { this.enthalpy[i]+=joules/this.mass[i];this.phaseTransition(i); }
  interact(dt) {
    const p = this.pointer;
    if (!p.active || p.tool === 'pan') return;
    if(['anchor','release','cut'].includes(p.tool)){this.structures.brush(p.tool,p.x,p.y,p.radius);return;}
    if (p.tool === 'emit') {
      this.emissionRemainder += dt * (120 + p.radius * 9);
      const amount = Math.floor(this.emissionRemainder);
      this.emissionRemainder -= amount;
      for (let n = 0; n < amount; n++) {
        const angle = this.random() * Math.PI * 2, r = Math.sqrt(this.random()) * p.radius;
        const x = clamp(p.x + Math.cos(angle) * r, -LIMIT + 5, LIMIT - 5);
        const y = clamp(p.y + Math.sin(angle) * r, -LIMIT + 5, LIMIT - 5);
        const cell = (Math.floor((y + LIMIT) / H) + 2) * GRID + Math.floor((x + LIMIT) / H) + 2;
        let blocked = false;
        for (let dy = -1; dy <= 1 && !blocked; dy++) for (let dx = -1; dx <= 1 && !blocked; dx++) {
          for (let j = this.head[cell + dy * GRID + dx]; j >= 0; j = this.next[j]) {
            if ((this.x[j] - x) ** 2 + (this.y[j] - y) ** 2 < 8) { blocked = true; break; }
          }
        }
        if (!blocked && this.add(x, y, p.material, (this.random() - .5) * 3, (this.random() - .5) * 3)) {
          const i = this.count - 1; this.cell[i] = cell; this.next[i] = this.head[cell]; this.head[cell] = i;
        }
      }
      return;
    }
    const radius2 = p.radius * p.radius;
    for (let i = this.count - 1; i >= 0; i--) {
      const dx = p.x - this.x[i], dy = p.y - this.y[i], r2 = dx * dx + dy * dy;
      if (r2 > radius2) continue;
      if (p.tool === 'erase') { this.removeAt(i); continue; }
      const r = Math.sqrt(r2) + .1, w = 1 - r / p.radius;
      if (p.tool === 'heat' || p.tool === 'cool') {
        let q=(p.tool === 'heat' ? 1 : -1) * this.settings.brushPower * dt * (.3 + .7 * w);
        if(q<0){
          const m=this.material[i],cold=[2,3,4].includes(m)?4:m===1?0:[7,10].includes(m)?5:m;
          q=Math.max(q,(enthalpyAt(cold,-273.15)-this.enthalpy[i])*this.mass[i]);
        }
        this.addHeat(i,q);
      } else if (p.tool === 'attract' || p.tool === 'repel') {
        const force = (p.tool === 'attract' ? 1 : -1) * 360 * w * dt / r;
        this.vx[i] += dx * force; this.vy[i] += dy * force;
      } else if (p.tool === 'spin') {
        const force = 400 * w * dt / r * (p.reverse ? -1 : 1);
        this.vx[i] -= dy * force; this.vy[i] += dx * force;
      }
    }
    if (p.tool === 'erase') this.grabbed = [];
  }
  step(dt = 1 / 60) {
    // Fixed, bounded substeps protect constraint stability at low frame rates.
    dt = clamp(dt, 0, .05);
    this.gravityMs = 0;
    this.buildGrid(); this.interact(dt);
    this.exchangedHeat = 0;
    this.buildGrid(); this.flushBonds();
    if(this.mpm.hasParticles(this)) {
      let remaining=dt,steps=0;
      // Bound work under extreme user input; simulation time advances only by
      // the time actually solved, rather than violating CFL to catch up.
      while(remaining>1e-9 && steps<96) {
        const h=Math.min(remaining,this.mpm.stableStep(this));
        this.substep(h);remaining-=h;steps++;
      }
      this.mpm.substeps=steps;this.time+=dt-remaining;return;
    }
    const substeps = Math.max(1, Math.ceil(dt / STEP));
    for (let s = 0; s < substeps; s++) this.substep(dt / substeps);
    this.time += dt;
  }
  substep(dt) {
    if (dt <= 0) return;
    const { x, y, vx, vy, oldX, oldY, material, temperature, settings } = this;
    const selfGravity = settings.gravity === 'self';
    const mpm = this.mpm.hasParticles(this);
    if (selfGravity) {
      const start = performance.now();
      this.gravityTree.build(x, y, this.count,this.mass);
      this.gravityTree.accelerations(this.gravityX, this.gravityY, settings);
      this.gravityMs += performance.now() - start;
    }
    for (let i = 0; i < this.count; i++) {
      oldX[i] = x[i]; oldY[i] = y[i];
      if(this.pinned[i]){vx[i]=vy[i]=0;continue;}
      const gas = material[i] === 3;
      let gx = 0, gy = 0;
      if (settings.gravity === 'center') {
        const r = Math.sqrt(x[i] * x[i] + y[i] * y[i] + 400);
        gx = -x[i] / r; gy = -y[i] / r;
      } else if (settings.gravity === 'uniform') gy = -1;
      const force = (gas ? -16 : 27) * settings.strength;
      vx[i] += (selfGravity ? this.gravityX[i] : gx * force) * dt;
      vy[i] += (selfGravity ? this.gravityY[i] : gy * force) * dt;
      if (gas && !selfGravity) {
        vx[i] += Math.sin(y[i] * .06 + this.time * .7) * dt * 6;
        vy[i] += Math.cos(x[i] * .07 - this.time * .4) * dt * 6;
      }
      // Orbital motion has no global drag; internal viscosity still exchanges momentum.
      const solidMPM=isMPMSolid(material[i]);
      const damping = selfGravity || solidMPM ? 1 : Math.exp(-dt * (gas ? .15 : material[i] === 1 ? .11 : .035));
      vx[i] = clamp(vx[i] * damping, -180, 180); vy[i] = clamp(vy[i] * damping, -180, 180);
      if(!solidMPM){x[i] += vx[i] * dt; y[i] += vy[i] * dt;}
    }
    if(mpm && this.pointer.active && this.pointer.tool==='drag')for(const [i,ox,oy] of this.grabbed){
      if(i>=this.count||this.pinned[i]||!isMPMSolid(material[i]))continue;
      vx[i]+=clamp(90*(this.pointer.x+ox-x[i])-12*vx[i],-900,900)*dt;
      vy[i]+=clamp(90*(this.pointer.y+oy-y[i])-12*vy[i],-900,900)*dt;
    }
    if(mpm)this.mpm.step(this,dt);
    this.structures.begin();
    this.structures.breakOverstretched();
    if(this.structures.rigidDirty)this.structures.rebuildRigidGroups();
    for (let iteration = 0; iteration < 6; iteration++) {
      if(iteration<4)this.buildGrid();
      if(iteration<2)this.solveDensity(); else {this.deltaX.fill(0,0,this.count);this.deltaY.fill(0,0,this.count);}
      for (let i = 0; i < this.count; i++) {
        x[i] += this.deltaX[i]; y[i] += this.deltaY[i];
        if (settings.boundary || this.scene === 'basin' || this.scene === 'softbody') {
          const bound = this.scene === 'softbody' ? 170 : this.scene === 'basin' ? 245 : LIMIT - 5;
          x[i] = clamp(x[i], -bound, bound);
          y[i] = clamp(y[i], this.scene === 'softbody' ? -145 : this.scene === 'basin' ? -175 : -bound, this.scene === 'softbody'?145:bound);
        } else {
          // Keep the finite spatial grid valid. Out-of-world particles are removed below.
          x[i] = clamp(x[i], -LIMIT - 20, LIMIT + 20);
          y[i] = clamp(y[i], -LIMIT - 20, LIMIT + 20);
        }
      }
      if(iteration<4)this.structures.collide();
      this.structures.solve(dt);
      this.structures.solveRigid();
    }
    if (this.pointer.active && this.pointer.tool === 'drag') {
      for (const [i, ox, oy] of this.grabbed) {
        if (i >= this.count || this.pinned[i] || isMPMSolid(material[i])) continue;
        const tx = clamp(this.pointer.x + ox, -LIMIT + 5, LIMIT - 5);
        const ty = clamp(this.pointer.y + oy, -LIMIT + 5, LIMIT - 5);
        x[i] += clamp((tx - x[i]) * .25, -2, 2);
        y[i] += clamp((ty - y[i]) * .25, -2, 2);
      }
      this.structures.solveRigid();
    }
    for (let i = 0; i < this.count; i++) {
      vx[i] = clamp((x[i] - oldX[i]) / dt, -180, 180);
      vy[i] = clamp((y[i] - oldY[i]) / dt, -180, 180);
    }
    // Symmetric near-neighbor velocity/heat exchange, accumulated before application.
    this.deltaX.fill(0, 0, this.count); this.deltaY.fill(0, 0, this.count); this.heat.fill(0, 0, this.count);
    this.thermalPairs.length=0;
    this.buildGrid();
    for (let i = 0; i < this.count; i++) {
      const cell = this.cell[i], mi = material[i];
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        for (let j = this.head[cell + yy * GRID + xx]; j >= 0; j = this.next[j]) {
          if (j <= i) continue;
          const dx = x[i] - x[j], dy = y[i] - y[j], r2 = dx * dx + dy * dy;
          if (r2 >= H2 || r2 < .00001) continue;
          const q = 1 - Math.sqrt(r2) / H;
          const w = isMPMSolid(mi)&&isMPMSolid(material[j]) ? 0 : q * q * Math.min(MATERIALS[mi].viscosity, MATERIALS[material[j]].viscosity);
          const dvx = (vx[j] - vx[i]) * w, dvy = (vy[j] - vy[i]) * w;
          const sum=this.invMass[i]+this.invMass[j];
          if(sum){
            this.deltaX[i] += dvx*2*this.invMass[i]/sum; this.deltaX[j] -= dvx*2*this.invMass[j]/sum;
            this.deltaY[i] += dvy*2*this.invMass[i]/sum; this.deltaY[j] -= dvy*2*this.invMass[j]/sum;
          }
          if (settings.thermal) {
            this.thermalPairs.push(i,j,q);
          }
        }
      }
    }
    if(settings.thermal){
      for(const e of this.structures.edges)if(e.visible)this.thermalPairs.push(e.a,e.b,4/e.rest);
      exchangeHeat(this,this.thermalPairs,dt);
    }
    for (let i = this.count - 1; i >= 0; i--) {
      vx[i] += this.deltaX[i]; vy[i] += this.deltaY[i];
      if(this.pinned[i])vx[i]=vy[i]=0;
      if (!settings.boundary && this.scene !== 'basin' && (Math.abs(x[i]) > LIMIT || Math.abs(y[i]) > LIMIT)) {
        this.removeAt(i); this.grabbed = [];
      }
    }
  }
  phaseTransition(i) {
    const old=this.material[i], [m,t]=decodeEnthalpy(old,this.enthalpy[i]);
    this.material[i]=m;this.temperature[i]=t;
    // Gas expansion is bounded for the fixed-radius particle discretization.
    this.volume[i]=m===3?1:clamp(this.mass[i]*1000/MATERIALS[m].density,.05,12);
    if(old!==m){
      this.mpm.resetParticle(i);
      if(!MATERIALS[m].solid){
        this.kind[i]=0;this.structures.pin(i,false);
        if(MATERIALS[old].solid)this.structures.filter(e=>e.a!==i && e.b!==i);
      }
      else if(!MATERIALS[old].solid){this.bondPending.push(i);this.bondWait[i]=120;}
    }
  }
  solveDensity() {
    const { x, y, count, material, lambda, cell, head, next, deltaX, deltaY,volume,invMass } = this;
    const selfGravity = this.settings.gravity === 'self';
    const skip = i => isMPMSolid(material[i]);
    for (let i = 0; i < count; i++) {
      lambda[i] = 0;
      if(skip(i))continue;
      if (material[i] === 3 && !selfGravity) continue;
      let rho = volume[i], sumX = 0, sumY = 0, grad2 = 0;
      const invRest = 1 / (selfGravity && material[i] === 3 ? 2.1 : MATERIALS[material[i]].rest);
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        for (let j = head[cell[i] + yy * GRID + xx]; j >= 0; j = next[j]) {
          if (j === i || (material[j] === 3 && !selfGravity)) continue;
          const dx = x[i] - x[j], dy = y[i] - y[j], r2 = dx * dx + dy * dy;
          if (r2 >= H2 || r2 < .000001) continue;
          const r = Math.sqrt(r2), q = 1 - r / H;
          rho += volume[j] * q * q * q;
          const g = -3 * q * q / H * invRest / r * volume[j], gx = g * dx, gy = g * dy;
          grad2 += invMass[j] * (gx * gx + gy * gy); sumX += gx; sumY += gy;
        }
      }
      const constraint = Math.max(0, rho * invRest - 1);
      lambda[i] = -constraint / (grad2 + invMass[i]*(sumX * sumX + sumY * sumY) + .035 * Math.max(.05,invMass[i]));
    }
    for (let i = 0; i < count; i++) {
      let sx = 0, sy = 0;
      const gas = material[i] === 3 && !selfGravity;
      const invRest = 1 / (selfGravity && material[i] === 3 ? 2.1 : MATERIALS[material[i]].rest);
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        for (let j = head[cell[i] + yy * GRID + xx]; j >= 0; j = next[j]) {
          if ((skip(i)&&skip(j)) || j === i || (material[j] === 3 && !selfGravity)) continue;
          const dx = x[i] - x[j], dy = y[i] - y[j], r2 = dx * dx + dy * dy;
          if (r2 >= H2 || r2 < .000001) continue;
          const r = Math.sqrt(r2), q = 1 - r / H;
          const pairRest = .5 * (invRest + 1 / (selfGravity && material[j] === 3 ? 2.1 : MATERIALS[material[j]].rest));
          const amount = gas ? Math.max(0, 3.6 - r) * .16 / r : invMass[i]*(lambda[i]*volume[j] + lambda[j]*volume[i]) * (-3 * q * q / H) * pairRest / r;
          sx += dx * amount; sy += dy * amount;
        }
      }
      deltaX[i] = this.pinned[i]?0:sx; deltaY[i] = this.pinned[i]?0:sy;
    }
    // One shared limiter preserves mass-weighted equal/opposite corrections.
    let max=1.5;
    for(let i=0;i<count;i++)max=Math.max(max,Math.hypot(deltaX[i],deltaY[i]));
    if(max>1.5)for(let i=0;i<count;i++){deltaX[i]*=1.5/max;deltaY[i]*=1.5/max;}
  }
  snapshot(buffer) {
    const data = buffer && buffer.byteLength === CAPACITY * 16 ? new Float32Array(buffer) : new Float32Array(CAPACITY * 4);
    const composition = new Array(MATERIALS.length).fill(0);
    let totalTemp = 0, totalMass=0,energy=0;
    const phases={solid:0,liquid:0,gas:0,granular:0};
    const materialTemps=new Array(MATERIALS.length).fill(0);
    for (let i = 0; i < this.count; i++) {
      data[i * 4] = this.x[i]; data[i * 4 + 1] = this.y[i];
      data[i * 4 + 2] = this.material[i]; data[i * 4 + 3] = this.temperature[i];
      composition[this.material[i]]++; totalTemp += this.temperature[i];
      materialTemps[this.material[i]]+=this.temperature[i];
      const m=MATERIALS[this.material[i]];phases[m.solid?'solid':m.group==='liquids'?'liquid':m.group==='gases'?'gas':'granular']++;
      totalMass+=this.mass[i];energy+=this.mass[i]*this.enthalpy[i];
    }
    return { buffer: data.buffer,mpm:this.mpm.stats(this), count: this.count, composition,phases,materialTemps:materialTemps.map((t,i)=>composition[i]?t/composition[i]:null),exchangedHeat:this.exchangedHeat,totalMass,energy,structure:this.structures.snapshot(), temperature: this.count ? totalTemp / this.count : 0, time: this.time, gravityMs: this.gravityMs, treeNodes: this.settings.gravity === 'self' ? this.gravityTree.nodes : 0 };
  }
}
