import {closestTriangle} from '../fem/contact.js';

const sub=(a,b)=>a.map((x,k)=>x-b[k]),length=v=>Math.hypot(...v);
const lerp=(a,b,t)=>a.map((x,k)=>x+(b[k]-x)*t);
export function sweptBoundsOverlap(p0,p1,a0,a1,r){
  return [0,1,2].every(k=>Math.max(p0[k],p1[k])+r>=Math.min(...a0.map(p=>p[k]),...a1.map(p=>p[k]))&&
    Math.min(p0[k],p1[k])-r<=Math.max(...a0.map(p=>p[k]),...a1.map(p=>p[k])));
}
function planeSeparated(p0,p1,a0,a1,r){
  for(const tri of [a0,a1]){
    const u=sub(tri[1],tri[0]),v=sub(tri[2],tri[0]);
    let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const l=length(n);if(l<1e-15)continue;n=n.map(x=>x/l);
    const dot=p=>p.reduce((sum,x,k)=>sum+x*n[k],0),centres=[dot(p0),dot(p1)],vertices=[...a0,...a1].map(dot);
    if(Math.min(...centres)-Math.max(...vertices)>r||Math.min(...vertices)-Math.max(...centres)>r)return true;
  }
  return false;
}
export function sphereTriangleGap(p,vertices,r){return length(sub(p,closestTriangle(p,...vertices).point))-r;}

// Continuous conservative advancement for a sphere and linearly moving triangle.
// Closest-feature distance covers the face, its edges and its vertices. Maximum
// vertex travel relative to the centre bounds the distance derivative.
// Exhausting the iteration budget returns uncertainty, NEVER a clearance claim.
export function sweepSphereTriangle(p0,p1,a0,a1,r,{tolerance=Math.max(1e-10,r*1e-7),iterations=256}={}){
  if(!sweptBoundsOverlap(p0,p1,a0,a1,r+tolerance))return null;
  if(planeSeparated(p0,p1,a0,a1,r+tolerance))return null;
  const travel=sub(p1,p0),speed=Math.max(...a0.map((p,k)=>length(sub(sub(a1[k],p),travel))));
  let t=0;
  for(let i=0;i<iterations;i++){
    const gap=sphereTriangleGap(lerp(p0,p1,t),a0.map((p,k)=>lerp(p,a1[k],t)),r);
    if(gap<=tolerance)return {time:t,initial:i===0,uncertain:false};
    if(speed<1e-15||gap-tolerance>speed*(1-t))return null;
    const next=t+.9*gap/speed;
    if(next>1)return null;
    if(next===t)return {time:t,initial:false,uncertain:true};
    t=next;
  }
  // Nearly tangential paths can make advancement arbitrarily slow. Prove
  // clearance on smaller intervals instead of interpreting this as a collision.
  const stack=[[t,1]];
  for(let visits=0;stack.length&&visits<2048;visits++){
    const [lo,hi]=stack.pop(),mid=(lo+hi)/2;
    const pl=lerp(p0,p1,lo),ph=lerp(p0,p1,hi);
    const al=a0.map((p,k)=>lerp(p,a1[k],lo)),ah=a0.map((p,k)=>lerp(p,a1[k],hi));
    if(!sweptBoundsOverlap(pl,ph,al,ah,r+tolerance)||planeSeparated(pl,ph,al,ah,r+tolerance))continue;
    const gap=sphereTriangleGap(lerp(p0,p1,mid),a0.map((p,k)=>lerp(p,a1[k],mid)),r);
    if(gap>tolerance+speed*(hi-lo)/2)continue;
    if(hi-lo<1e-8)return {time:lo,initial:false,uncertain:gap>tolerance};
    stack.push([mid,hi],[lo,mid]);
  }
  return stack.length?{time:stack[stack.length-1][0],initial:false,uncertain:true}:null;
}
