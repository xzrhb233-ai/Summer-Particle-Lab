import RAPIER from '../../node_modules/@dimforge/rapier3d-compat/rapier.mjs';
import {arr,obj,qa,contactBounds} from '../multibody/contact.js';
import {rotate,inverse,quaternion,qmul,sub,dot,add,mul} from '../multibody/model.js';
import {closestTriangle} from '../fem/contact.js';

export const FEM_RIGID_SHAPES=Object.freeze(['sphere','box','cylinder','disc']);
const origin={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1},cache=new WeakMap();
const rotation=q=>({...obj(q),w:q[3]});
const norm=p=>Math.hypot(...p);
export const rigidContactLength=body=>Math.min(...body.definition.size)/2;
export function rigidSurfaceArea(body){
  const [x,y,z]=body.definition.size,r=x/2,shape=body.definition.shape;
  if(shape==='sphere')return Math.PI*x*x;
  if(shape==='box')return 2*(x*y+x*z+y*z);
  if(shape==='torus')return Math.PI*Math.PI*(x-z)*z;
  return 2*Math.PI*r*(r+(shape==='disc'?z:y));
}
export function rigidProjectedArea(body,normal){
  const [x,y,z]=body.definition.size,n=rotate(inverse(qa(body.rb.rotation())),normal),shape=body.definition.shape;
  if(shape==='sphere')return x*x; // retain the existing sphere contact envelope
  if(shape==='box')return y*z*Math.abs(n[0])+x*z*Math.abs(n[1])+x*y*Math.abs(n[2]);
  const axial=Math.min(1,Math.abs(n[shape==='disc'?2:1])),r=x/2,h=shape==='disc'?z:y;
  return Math.PI*r*r*axial+2*r*h*Math.sqrt(Math.max(0,1-axial*axial));
}
export function rigidThermalLength(body,normal){
  const [x,y,z]=body.definition.size,shape=body.definition.shape;
  if(shape==='sphere')return x/2;
  const volume=shape==='box'?x*y*z:Math.PI*x*x*(shape==='disc'?z:y)/4;
  return .5*volume/rigidProjectedArea(body,normal);
}
function geometry(body){
  if(cache.has(body))return cache.get(body);
  const b=body.definition,[x,y,z]=b.size;
  if(!FEM_RIGID_SHAPES.includes(b.shape))throw Error('当前 FEM 刚体接触支持球、长方体、圆柱和圆盘；轮胎尚未支持');
  let shape,extra=[0,0,0,1],samples=[];
  if(b.shape==='sphere')shape=new RAPIER.Ball(x/2);
  else if(b.shape==='box'){
    shape=new RAPIER.Cuboid(x/2,y/2,z/2);
    for(const a of [-1,1])for(const c of [-1,1])for(const d of [-1,1])samples.push([a*x/2,c*y/2,d*z/2]);
  }else{
    const h=b.shape==='disc'?z:y;shape=new RAPIER.Cylinder(h/2,x/2);
    if(b.shape==='disc')extra=quaternion([90,0,0]);
    for(const side of [-1,1]){
      samples.push(rotate(extra,[0,side*h/2,0]));
      for(let k=0;k<16;k++)samples.push(rotate(extra,[x/2*Math.cos(k*Math.PI/8),side*h/2,x/2*Math.sin(k*Math.PI/8)]));
    }
  }
  const value={shape,extra,samples};cache.set(body,value);return value;
}
const area=t=>{
  const a=sub(t.v[1],t.v[0]),b=sub(t.v[2],t.v[0]);
  return .5*Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
};

// Convex support mapping against the actual deformed triangle, not a sphere
// enclosing the body. Sampled primitive features enrich broad flat contacts;
// the GJK/EPA query also detects edge/face crossings with no vertex inside.
export function rigidFEMContacts(body,triangles,padding=0){
  const g=geometry(body),center=arr(body.rb.translation()),q=qa(body.rb.rotation()),pose=rotation(qmul(q,g.extra));
  const bounds=contactBounds(body,padding+1e-7),samples=g.samples.map(p=>add(center,rotate(q,p))),hits=[];
  const scale=Math.max(...body.definition.size),epsilon=Math.max(2e-7,scale*2e-6),near=padding+epsilon;
  for(const t of triangles){
    if([0,1,2].some(k=>bounds.upper[k]<t.lo[k]-epsilon||bounds.lower[k]>t.hi[k]+epsilon))continue;
    const tri=new RAPIER.Triangle(...t.v.map(obj));let c=g.shape.contactShape(obj(center),pose,tri,origin,identity,near);
    let hasQuery=!!c&&c.distance<=near;
    // Exact cap/triangle tangency can give GJK a zero normal and placeholder
    // witnesses. Retry by a numerical epsilon, then remove that offset from
    // the returned separation; never treat the body center as a contact.
    if(hasQuery&&norm(arr(c.normal2))<1e-12&&Number.isFinite(c.distance)&&Math.abs(c.distance)<=epsilon){
      const shift=mul(t.normal,epsilon*2),retry=g.shape.contactShape(obj(sub(center,shift)),pose,tri,origin,identity,near);
      if(retry&&norm(arr(retry.normal2))>1e-12){retry.distance+=dot(shift,arr(retry.normal2));c=retry;hasQuery=c.distance<=near;}
    }
    const triangleArea=area(t),append=(point,weights,depth,normal)=>hits.push({point,weights,depth,normal,ids:t.ids,arm:sub(point,center),triangleArea});
    if(hasQuery){
      const nearest=closestTriangle(arr(c.point2),...t.v),normal=arr(c.normal2),length=norm(normal);
      if(!Number.isFinite(c.distance))throw Error('刚体–FEM 几何接触无效');
      if(length>1e-12)append(nearest.point,nearest.weights,-c.distance,mul(normal,(dot(normal,t.normal)<-1e-7?-1:1)/length));
    }
    const features=samples.slice();
    if(['cylinder','disc'].includes(body.definition.shape)){
      const n=rotate(inverse(qmul(q,g.extra)),t.normal),radial=Math.hypot(n[0],n[2]),r=body.definition.size[0]/2,height=body.definition.size[body.definition.shape==='disc'?2:1];
      if(radial>1e-12)for(const side of Math.abs(n[1])<1e-8?[-1,1]:[n[1]>0?-1:1]){
        const support=[-r*n[0]/radial,side*height/2,-r*n[2]/radial];features.push(add(center,rotate(qmul(q,g.extra),support)));
      }
    }
    for(const point of features){
      const distance=dot(sub(point,t.v[0]),t.normal);
      // A narrow-phase miss may still be exact tangency in float32. Only a
      // real boundary feature within epsilon can recover that case.
      if(distance>near||!hasQuery&&distance< -near)continue;
      const projected=sub(point,mul(t.normal,distance)),f=closestTriangle(projected,...t.v);
      if(norm(sub(projected,f.point))<=epsilon)append(f.point,f.weights,-distance,t.normal);
    }
  }
  // Coincident points along triangulation diagonals are one contact. Keep a
  // small spatially distributed manifold so a flat box can support a moment.
  hits.sort((a,b)=>b.depth-a.depth);const unique=[];
  for(const h of hits)if(!unique.some(u=>norm(sub(u.point,h.point))<=epsilon&&dot(u.normal,h.normal)>.999))unique.push(h);
  if(unique.length<=8)return unique;
  const selected=[unique.shift()];
  while(selected.length<8&&unique.length){
    let index=0,best=-1;
    for(let k=0;k<unique.length;k++){
      const score=Math.min(...selected.map(s=>norm(sub(s.point,unique[k].point))**2+scale*scale*(1-dot(s.normal,unique[k].normal))));
      if(score>best){best=score;index=k;}
    }
    selected.push(unique.splice(index,1)[0]);
  }
  return selected;
}

// A convex body wholly enclosed by a FEM volume may not cross any surface
// triangle. Reject that initial configuration as well as face intersections.
export function rigidCenterInsideFEM(body,state){
  const p=arr(body.rb.translation()),node=n=>state.mesh.nodes[n].map((x,k)=>x+state.u[3*n+k]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  return state.mesh.cells.some(cell=>{
    const [a,b,c,d]=cell.ids.map(node),ab=sub(b,a),ac=sub(c,a),ad=sub(d,a),ap=sub(p,a),det=dot(ab,cross(ac,ad));
    if(Math.abs(det)<1e-20)return false;
    const w=[dot(ap,cross(ac,ad)),dot(ab,cross(ap,ad)),dot(ab,cross(ac,ap))].map(x=>x/det);
    return w.every(x=>x>=-1e-9)&&w.reduce((sum,x)=>sum+x,0)<=1+1e-9;
  });
}
