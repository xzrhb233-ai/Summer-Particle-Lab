import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
import {DEFAULT_DOMAIN,domainParameters,geometryParameters,geometryPoints,insideGeometry} from '../src/three/discretization.js';
import {phaseEnthalpy} from '../src/three/phase-change.js';

test('domain validation counts cut edge cells and guarantees a complete MPM stencil',()=>{
  const d=domainParameters({...DEFAULT_DOMAIN,lower:[-7,-7,-7],upper:[9,9,9]});assert.deepEqual(d.cells,[3,3,3]);assert.equal(d.particlesPerCell,8);assert.equal(d.spacing,4);
  for(const cellSize of [4,8,12,16]){
    const domain=domainParameters({lower:[-120,-120,-120],upper:[120,120,120],cellSize,particlesPerAxis:4});
    for(let a=0;a<3;a++)for(const x of [domain.lower[a],domain.upper[a]]){const base=Math.floor((x-domain.origin[a])/cellSize-.5);assert.ok(base>=0&&base+2<domain.nodes[a]&&domain.nodes[a]<=67);}
  }
  for(const value of [{cellSize:0},{cellSize:Infinity},{particlesPerAxis:2.5},{cellSize:16,particlesPerAxis:2},{lower:[-2401,0,0]},{lower:[0,0,0],upper:[8,0,8]},{cellSize:4,upper:[240,240,240]}])assert.throws(()=>domainParameters({...DEFAULT_DOMAIN,...value}));
});
test('fully filled grid cells have n cubed particles and refinement preserves analytic volume and mass',()=>{
  const masses=[];
  for(const n of [2,3,4]){
    const s=new Simulation3();s.configureDomain({...DEFAULT_DOMAIN,particlesPerAxis:n});s.createGeometry({center:[0,0,0],size:[16,16,16],material:11});
    assert.equal(s.count,8*n**3);const state=s.snapshot();masses.push(state.mass);assert.ok(Math.abs(state.mass-4096/64*1.1)<1e-9);
    assert.ok(Math.abs(s.volume.slice(0,s.count).reduce((a,b)=>a+b,0)*64-4096)<1e-9);assert.equal(state.parts[0].geometry.particlesPerCell,n**3);
  }
  assert.ok(Math.max(...masses)-Math.min(...masses)<1e-9);
});
test('rotated boxes, ellipsoids and cylinders stay inside their exact local geometry',()=>{
  for(const shape of ['box','ellipsoid','cylinder']){
    const s=new Simulation3(),d={shape,center:[21.125,5.5,-17.25],size:[20.5,24,16],rotation:[21,32,-17],sampling:{enabled:true,strength:.2,seed:42}};
    const g=geometryParameters(d,s.domain);s.createGeometry(d);
    for(let i=0;i<s.count;i++)assert.ok(insideGeometry(g,[s.x[i],s.y[i],s.z[i]]));
    assert.ok(Math.abs(s.snapshot().mass-g.volume/64*1.1)<1e-9);assert.equal(s.lab.snapshot()[0].displacement,0);
  }
});
test('invalid domain/geometry creation is atomic and existing histories survive a safe grid change',()=>{
  const s=new Simulation3();s.createGeometry({center:[0,0,0],size:[16,16,16]});s.mpm.plastic[0]=.4;s.mpm.C[0]=.1;s.mpm.F[0]=.9;
  const before=s.count;assert.throws(()=>s.configureDomain({...DEFAULT_DOMAIN,lower:[0,0,0]}));assert.equal(s.domain.cellSize,8);
  assert.throws(()=>s.createGeometry({center:[60,0,0],size:[24,16,16],rotation:[0,20,0]}));assert.equal(s.count,before);assert.equal(s.lab.nextId,2);
  s.configureDomain({...DEFAULT_DOMAIN,cellSize:4,particlesPerAxis:2});assert.equal(s.mpm.plastic[0],.4);assert.equal(s.mpm.C[0],.1);assert.equal(s.mpm.F[0],.9);
});
test('expanded domains and different grid sizes preserve uniform APIC motion away from walls',()=>{
  for(const cellSize of [4,8,12,16]){
    const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;s.settings.solidAntiClump=false;
    s.configureDomain({lower:[-120,-120,-120],upper:[120,120,120],cellSize,particlesPerAxis:4});s.createGeometry({center:[76,40,-76],size:[8,8,8],velocity:[3,-2,7]});
    const initial=s.x.slice(0,s.count);s.mpm.step(s,.001);
    for(let i=0;i<s.count;i++){assert.ok(Math.abs(s.x[i]-initial[i]-.003)<1e-9);assert.ok(Math.abs(s.vz[i]-7)<1e-9);}
    const a=s.mpm.stableStep(s);assert.ok(a<=cellSize/8/240+1e-12);
  }
});
test('fine solid phase change preserves particle volume, mass, enthalpy and solver handoff',()=>{
  const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;s.configureDomain({...DEFAULT_DOMAIN,cellSize:4,particlesPerAxis:4});
  const id=s.createGeometry({center:[0,0,0],size:[4,4,4],material:11,model:10,phaseChange:{enabled:true}}),initial=s.snapshot(),volume=s.volume[0];
  for(let i=0;i<s.count;i++){s.enthalpy[i]=phaseEnthalpy(180,s.phaseMaterials[id]);s.phaseTransition(i);}
  assert.ok(Math.abs(s.volume[0]-volume)<1e-12);assert.equal(s.snapshot().mass,initial.mass);s.substep(1/120,false);
  assert.ok(s.snapshot().data.every(Number.isFinite));
});
test('capacity limits and coarse geometry with no samples fail before creating particles',()=>{
  const g=geometryParameters({center:[0,0,0],size:[24,24,24]},domainParameters(DEFAULT_DOMAIN));assert.throws(()=>geometryPoints(g,10));
  const s=new Simulation3();assert.throws(()=>s.createGeometry({center:[0,0,0],size:[.1,.1,.1]}));assert.equal(s.count,0);
});

test('off-grid walls reject boundary samples atomically and a relocated domain keeps the platen inside',()=>{
  const s=new Simulation3();s.configureDomain({...DEFAULT_DOMAIN,lower:[1.5,-48,-64],upper:[65.5,72,64]});
  assert.throws(()=>s.createGeometry({center:[5.5,0,0],size:[8,8,8]}),/边界缓冲区/);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  s.configureDomain({lower:[0,100,0],upper:[8,108,8],cellSize:4,particlesPerAxis:2});
  assert.equal(s.press.y,104);s.setPress({enabled:true,target:0});assert.equal(s.press.target,104);
  s.configureDomain(s.domain);s.setPress({target:300});assert.equal(s.press.target,108);
});
