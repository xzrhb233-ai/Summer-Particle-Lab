import {sweepSphereTriangle,sphereTriangleGap,sweptBoundsOverlap} from './swept-contact.js';
import {rigidContactLength} from './rigid-geometry.js';
import {meshLength} from '../fem/mesh.js';

const axes=['x','y','z'], L=.025;
const radius=(s,i)=>.5*Math.cbrt(s.volume[i]*.001);
const vector=v=>[v.x,v.y,v.z];
const pose=b=>({x:vector(b.rb.translation()),q:b.rb.rotation()});
const reach=b=>Math.hypot(...b.definition.size)/2;
const femSpeed=f=>{let v=0;for(let i=0;i<f.v.length;i+=3)v=Math.max(v,Math.hypot(...f.v.subarray(i,i+3)));return v;};
export class ContactMotionError extends Error {
  constructor(ratio){super('接触单步位移超限，缩小步长后重算');this.ratio=ratio;}
}

// Bounds relative surface travel, including thin FEM cells and rigid rotation.
// Endpoint displacement is also checked because forces/projection can invalidate
// a velocity-only estimate. This is conservative substepping, not general CCD.
export class ContactMotion {
  constructor(contacts){
    this.s=contacts.s;
    this.pairs=contacts.pairs.filter(p=>p.definition.mechanical).map(p=>{
      let size=p.rigid?rigidContactLength(p.rigid):Infinity;
      if(!p.rigid)for(const e of p.entries)size=Math.min(size,radius(this.s,e.index));
      size=Math.min(size,meshLength(p.state));
      return {pair:p,limit:.15*size};
    });
  }
  limit(){
    let dt=Infinity;
    for(const {pair:p,limit} of this.pairs){
      let speed=0;
      if(p.rigid)speed=Math.hypot(...vector(p.rigid.rb.linvel()))+reach(p.rigid)*Math.hypot(...vector(p.rigid.rb.angvel()));
      else for(const e of p.entries)speed=Math.max(speed,Math.hypot(...['vx','vy','vz'].map(k=>this.s[k][e.index]))*L);
      dt=Math.min(dt,limit/Math.max(1e-12,speed+femSpeed(p.state)));
    }
    return dt;
  }
  capture(){
    this.positions=axes.map(k=>this.s[k].slice(0,this.s.count));
    this.fem=new Map(this.pairs.map(({pair:p})=>[p.state,p.state.u.slice()]));
    this.rigid=new Map(this.pairs.filter(({pair:p})=>p.rigid).map(({pair:p})=>[p.rigid,pose(p.rigid)]));
  }
  checkSwept(){
    let tests=0;
    for(const {pair:p} of this.pairs){
      if(p.rigid&&p.rigid.definition.shape!=='sphere')continue;
      const f=p.state,old=this.fem.get(f);
      const triangles=f.mesh.surface.map(tri=>({
        before:tri.nodes.map(n=>f.mesh.nodes[n].map((v,k)=>v+old[3*n+k])),
        after:tri.nodes.map(n=>f.mesh.nodes[n].map((v,k)=>v+f.u[3*n+k]))
      }));
      for(const e of p.entries){
        const r=p.rigid?p.rigid.definition.size[0]/2:radius(this.s,e.index),eps=Math.max(1e-10,r*1e-7);
        const start=p.rigid?this.rigid.get(p.rigid).x:axes.map((k,a)=>this.positions[a][e.index]*L);
        const end=p.rigid?vector(p.rigid.rb.translation()):axes.map(k=>this.s[k][e.index]*L);
        for(const tri of triangles){
          if(!sweptBoundsOverlap(start,end,tri.before,tri.after,r+eps))continue;
          // Existing endpoint contact is handled by the impulse solver. Sweep
          // only the cases it cannot see: separated endpoints with an impact
          // in between. Starting overlaps remain the discrete solver's job.
          if(sphereTriangleGap(start,tri.before,r)<=eps||sphereTriangleGap(end,tri.after,r)<=eps)continue;
          tests++;
          const hit=sweepSphereTriangle(start,end,tri.before,tri.after,r-4*eps);
          if(hit){const error=new ContactMotionError(2);error.kind='swept-contact';error.toi=hit.time;error.pair=p.definition.id;throw error;}
        }
      }
    }
    return tests;
  }
  check(){
    let ratio=0;
    for(const {pair:p,limit} of this.pairs){
      let distance=0,fd=0;const old=this.fem.get(p.state),u=p.state.u;
      for(let i=0;i<u.length;i+=3)fd=Math.max(fd,Math.hypot(u[i]-old[i],u[i+1]-old[i+1],u[i+2]-old[i+2]));
      if(p.rigid){
        const a=this.rigid.get(p.rigid),b=pose(p.rigid),cos=Math.min(1,Math.abs(a.q.x*b.q.x+a.q.y*b.q.y+a.q.z*b.q.z+a.q.w*b.q.w)/Math.sqrt((a.q.x*a.q.x+a.q.y*a.q.y+a.q.z*a.q.z+a.q.w*a.q.w)*(b.q.x*b.q.x+b.q.y*b.q.y+b.q.z*b.q.z+b.q.w*b.q.w)));
        distance=Math.hypot(...b.x.map((x,k)=>x-a.x[k]))+2*reach(p.rigid)*Math.sqrt(Math.max(0,1-cos*cos));
      }else for(const e of p.entries)distance=Math.max(distance,L*Math.hypot(...axes.map((k,a)=>this.s[k][e.index]-this.positions[a][e.index])));
      ratio=Math.max(ratio,(distance+fd)/limit);
    }
    if(!Number.isFinite(ratio)||ratio>1.001)throw new ContactMotionError(ratio);
    return ratio;
  }
}
