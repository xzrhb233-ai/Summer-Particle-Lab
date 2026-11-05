import {rotate,inverse,sub,add,mul,dot,norm,inertia} from './model.js';
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const arr=v=>[v.x,v.y,v.z],obj=v=>({x:v[0],y:v[1],z:v[2]}),qa=q=>[q.x,q.y,q.z,q.w];
// Conservative world bounds, cached once per contact pass. This rejects distant
// bicycle parts before their signed-distance query, without dropping near hits.
export function contactBounds(body,padding=0){
  const q=qa(body.rb.rotation()),center=arr(body.rb.translation()),half=body.definition.size.map(v=>v*.5),axes=[[1,0,0],[0,1,0],[0,0,1]].map(a=>rotate(q,a));
  const extent=center.map((_,a)=>padding+half.reduce((sum,h,k)=>sum+h*Math.abs(axes[k][a]),0));
  return {lower:center.map((v,a)=>v-extent[a]),upper:center.map((v,a)=>v+extent[a])};
}
export const withinBounds=(bounds,x,y,z)=>x>=bounds.lower[0]&&x<=bounds.upper[0]&&y>=bounds.lower[1]&&y<=bounds.upper[1]&&z>=bounds.lower[2]&&z<=bounds.upper[2];
// Signed distance and outward normal for actual rotated rigid primitives.
export function surface(body,point){
  const b=body.definition,q=qa(body.rb.rotation()),p=rotate(inverse(q),sub(point,arr(body.rb.translation()))),half=b.size.map(x=>x/2);let d,n;
  if(b.shape==='torus'){
    const radius=Math.hypot(p[0],p[1]),major=half[0]-half[2],radial=radius>1e-12?[p[0]/radius,p[1]/radius,0]:[1,0,0],delta=radius-major,length=Math.hypot(delta,p[2]);
    d=length-half[2];n=length>1e-12?[radial[0]*delta/length,radial[1]*delta/length,p[2]/length]:[0,0,1];
  }
  else if(b.shape==='sphere'){const r=norm(p);d=r-half[0];n=r>1e-12?mul(p,1/r):[1,0,0];}
  else if(b.shape==='box'){
    const z=p.map((v,a)=>Math.abs(v)-half[a]),outside=z.map(v=>Math.max(0,v)),length=norm(outside);d=length+Math.min(0,Math.max(...z));
    if(length>1e-12)n=outside.map((v,a)=>v/length*(p[a]<0?-1:1));else{const a=z.indexOf(Math.max(...z));n=[0,0,0];n[a]=p[a]<0?-1:1;}
  }else{
    if(b.shape==='disc'){[p[1],p[2]]=[p[2],p[1]];[half[1],half[2]]=[half[2],half[1]];}
    const r=Math.hypot(p[0],p[2]),dr=r-half[0],dy=Math.abs(p[1])-half[1],radial=r>1e-12?[p[0]/r,0,p[2]/r]:[1,0,0],cap=[0,p[1]<0?-1:1,0];
    d=Math.hypot(Math.max(0,dr),Math.max(0,dy))+Math.min(0,Math.max(dr,dy));
    n=dr>0&&dy>0?mul(add(mul(radial,dr),mul(cap,dy)),1/Math.hypot(dr,dy)):dr>dy?radial:cap;
    if(b.shape==='disc')[n[1],n[2]]=[n[2],n[1]];
  }
  return {distance:d,normal:rotate(q,n)};
}
// Sequential, dissipative contact impulses. Opposite impulses at the SAME world
// location conserve linear and angular momentum (external constraints excluded).
export function contactImpulse(body,point,velocity,mass,normal,friction=0,restitution=0){
  // Static colliders have zero point velocity and infinite effective mass.
  // Avoid WASM pose/inertia queries for the many road and basin contacts.
  if(body.definition.type==='fixed'){
    const vn=dot(velocity,normal);if(vn>=0)return {velocity:velocity.slice(),impulse:[0,0,0]};
    const jn=-(1+restitution)*vn*mass;let impulse=mul(normal,jn),v=add(velocity,mul(impulse,1/mass));
    const slip=sub(v,mul(normal,dot(v,normal))),speed=norm(slip);
    if(speed>1e-12&&friction>0){const tangent=mul(slip,-Math.min(friction*jn,speed*mass)/speed);impulse=add(impulse,tangent);v=add(v,mul(tangent,1/mass));}
    const normalWork=jn*vn+.5*jn*jn/mass,totalWork=.5*mass*(dot(v,v)-dot(velocity,velocity));
    return {velocity:v,impulse,normalWork,frictionWork:totalWork-normalWork};
  }
  const rb=body.rb,fixed=body.definition.type==='fixed',r=sub(point,arr(rb.translation())),q=qa(rb.rotation()),I=inertia(body.definition),invM=fixed?0:1/body.definition.mass;
  const inverseI=v=>fixed?[0,0,0]:rotate(q,rotate(inverse(q),v).map((x,a)=>x/I[a]));
  const effective=n=>1/mass+invM+dot(cross(r,n),inverseI(cross(r,n)));
  let v=velocity.slice(),total=[0,0,0];
  function apply(impulse){v=add(v,mul(impulse,1/mass));total=add(total,impulse);if(!fixed)rb.applyImpulseAtPoint(obj(mul(impulse,-1)),obj(point),true);}
  const relative=()=>sub(v,arr(rb.velocityAtPoint(obj(point)))),vn=dot(relative(),normal);
  if(vn>=0)return {velocity:v,impulse:total};
  const normalW=effective(normal),jn=-(1+restitution)*vn/normalW,normalWork=jn*vn+.5*jn*jn*normalW;apply(mul(normal,jn));
  const slip=sub(relative(),mul(normal,dot(relative(),normal))),speed=norm(slip);
  let frictionWork=0;
  if(speed>1e-12&&friction>0){const t=mul(slip,1/speed),W=effective(t),jt=Math.min(friction*jn,speed/W);frictionWork=-jt*speed+.5*jt*jt*W;apply(mul(t,-jt));}
  return {velocity:v,impulse:total,normalWork,frictionWork};
}
