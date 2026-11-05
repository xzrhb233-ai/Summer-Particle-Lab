import test from 'node:test';
import assert from 'node:assert/strict';
import {fluidContactDOFs} from '../src/mixed/fluid-contact.js';
import {cross} from '../src/fem/mesh.js';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const vector=(a,b)=>a.forEach((x,k)=>near(x,b[k]));
function fixture(){
  const s={mass:[2],pinned:[false],vx:[40],vy:[-20],vz:[12],mpm:{C:new Float64Array(9)}};
  const f={mesh:{nodes:[[0,0,0],[1,0,0],[0,0,1]]},u:new Float64Array(9),v:new Float64Array([.1,0,0,0,0,.1,0,.2,0]),m:new Float64Array([1,1,1,2,2,2,3,3,3]),fixed:new Uint8Array(9),contactWork:0};
  const h={ids:[0,1,2],weights:[.5,.2,.3],point:[.2,0,.3],arm:[0,-.1,0],normal:[0,1,0]};
  const velocity=()=>[s.vx[0],s.vy[0],s.vz[0]].map(x=>x*.025);
  const kinetic=()=>s.mass[0]*velocity().reduce((sum,x)=>sum+x*x,0)/2+f.v.reduce((sum,v,k)=>sum+.5*f.m[k]*v*v,0);
  const momentum=()=>[0,1,2].map(k=>s.mass[0]*velocity()[k]+h.ids.reduce((sum,n)=>sum+f.m[3*n+k]*f.v[3*n+k],0));
  const angular=()=>{const v=cross([.2,.1,.3],velocity().map(x=>x*s.mass[0]));for(const n of h.ids){const r=cross(f.mesh.nodes[n],Array.from(f.v.slice(3*n,3*n+3),x=>x*f.m[3*n]));for(let k=0;k<3;k++)v[k]+=r[k];}return v;};
  return {s,f,h,kinetic,momentum,angular,d:fluidContactDOFs(s,0,f,h)};
}
test('PBF tangential impulse preserves linear/angular momentum and reports actual kinetic work',()=>{
  const {s,f,d,kinetic,momentum,angular}=fixture(),p=momentum(),a=angular(),K=kinetic();
  const r=d.apply([-.3,.4,.07]);vector(momentum(),p);vector(angular(),a);vector(r.impulseResidual,[0,0,0]);
  near(kinetic()-K,r.workA+r.workB);near(f.contactWork,r.workB);assert.ok(s.mpm.C.every(x=>x===0));
});
test('PBF contact inverse mass matches its adjoint relative-velocity operator',()=>{
  for(const t of [[1,0,0],[0,1,0],[0,0,1],[.6,.8,0]]){
    const {d}=fixture(),v=d.relative(),effective=d.inv(t);d.apply(t);
    near(d.relative().reduce((sum,x,k)=>sum+(x-v[k])*t[k],0),effective);
  }
});
test('Coulomb-limited PBF friction dissipates the recorded work without reversing slip',()=>{
  const {d,kinetic}=fixture(),v=d.relative(),speed=Math.hypot(v[0],v[2]),t=[v[0]/speed,0,v[2]/speed],effective=d.inv(t),j=Math.min(.2*.5,speed/effective),before=kinetic();
  const r=d.apply(t.map(x=>-j*x)),loss=j*speed-.5*j*j*effective;
  near(kinetic()-before,-loss);near(r.workA+r.workB,-loss);assert.ok(d.relative().reduce((sum,x,k)=>sum+x*t[k],0)>=-1e-12);
});
test('PBF contact assigns fixed FEM reaction to support with no spurious work',()=>{
  const {s,f,h,kinetic}=fixture();f.fixed.fill(1);f.v.fill(0);const d=fluidContactDOFs(s,0,f,h),K=kinetic(),r=d.apply([-.2,.4,0]);
  vector(r.support,[.2,-.4,0]);vector(r.impulseResidual,[0,0,0]);near(r.workB,0);near(kinetic()-K,r.workA);assert.ok(f.v.every(x=>x===0));
});
test('PBF reaction wrench remains exact after earlier contacts have corrected the FEM face',()=>{
  const {s,f,h,kinetic}=fixture();f.u.set([.01,.02,0,-.02,.01,.03,.01,0,-.01]);
  const angular=()=>{
    const total=cross(h.point.map((x,k)=>x-h.arm[k]),[s.vx[0],s.vy[0],s.vz[0]].map(v=>v*.025*s.mass[0]));
    for(const n of h.ids){const point=f.mesh.nodes[n].map((x,k)=>x+f.u[3*n+k]),torque=cross(point,Array.from(f.v.slice(3*n,3*n+3),x=>x*f.m[3*n]));for(let k=0;k<3;k++)total[k]+=torque[k];}
    return total;
  };
  const d=fluidContactDOFs(s,0,f,h),before=angular(),K=kinetic(),r=d.apply([-.3,.4,.07]);
  vector(angular(),before);near(kinetic()-K,r.workA+r.workB);
});
test('PBF contact operator is scale independent for valid microscopic FEM faces',()=>{
  const {s,f,h,d}=fixture(),expected=d.inv([.6,.8,0]);
  f.mesh.nodes=f.mesh.nodes.map(p=>p.map(x=>x*1e-6));h.point=h.point.map(x=>x*1e-6);h.arm=h.arm.map(x=>x*1e-6);
  near(fluidContactDOFs(s,0,f,h).inv([.6,.8,0]),expected);
});
test('pinned PBF point carries support reaction without artificial kinetic work',()=>{
  const {s,f,h}=fixture();s.pinned[0]=true;s.vx[0]=s.vy[0]=s.vz[0]=0;
  const d=fluidContactDOFs(s,0,f,h),r=d.apply([-.2,.4,.1]);
  vector(r.support,[-.2,.4,.1]);vector(r.impulseResidual,[0,0,0]);near(r.workA,0);
  vector([s.vx[0],s.vy[0],s.vz[0]],[0,0,0]);assert.ok(s.mpm.C.every(x=>x===0));
});
