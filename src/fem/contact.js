import {dot,cross,sub} from './mesh.js';
import {quaternion,qmul} from '../multibody/model.js';
import {FEMSurfaceContacts,validateFEMSurfaceContacts} from './fem-contact.js';

const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const scale=(v,s)=>v.map(x=>x*s),add=(a,b)=>a.map((x,k)=>x+b[k]);
const length=v=>Math.hypot(...v);
export function validateRigidContacts(p){
  const rigids=p.parts.filter(b=>b.method==='rigid');
  if(rigids.length>16)throw Error('FEM 接触阶段最多 16 个球形刚体');
  for(const b of rigids){
    const g=b.geometry,m=b.material,i=b.initial,bc=b.boundary;
    if(g.shape!=='sphere'||!vec(g.size)||g.size.some(x=>x<.02||x>100)||g.size.some(x=>Math.abs(x-g.size[0])>1e-10))throw Error('FEM 接触目前支持等径球形刚体');
    if(!vec(g.center)||g.center.some(x=>Math.abs(x)>1000)||!vec(g.rotation)||typeof b.name!=='string')throw Error('刚体位置、旋转或名称无效');
    if(!Number.isFinite(m.mass)||m.mass<.001||m.mass>1e6||!['fixed','dynamic'].includes(bc.motion))throw Error('刚体质量或运动类型无效');
    if(!vec(i.velocity)||!vec(i.angularVelocity)||[...i.velocity,...i.angularVelocity].some(x=>Math.abs(x)>100))throw Error('刚体初速或角速度须在 ±100 范围');
    if(bc.motion==='fixed'&&[...i.velocity,...i.angularVelocity].some(x=>x!==0))throw Error('固定刚体的初速度须为零');
    if((bc.damping??0)!==0)throw Error('FEM 刚体接触请使用接触对阻尼；暂不支持刚体全局阻尼');
    if(g.appearance?.length)throw Error('FEM 接触请使用球形碰撞体外形，暂不支持组合显示外形');
    m.cp??=500;m.conductivity??=50;
    if(!Number.isFinite(m.cp)||m.cp<1||m.cp>100000||!Number.isFinite(m.conductivity)||m.conductivity<0||m.conductivity>10000||!Number.isFinite(i.temperature)||i.temperature< -273.15||i.temperature>2000)throw Error('刚体比热容、导热率或温度无效');
  }
  const ids=new Set(),keys=new Set();
  p.contactPairs=(p.contactPairs??[]).map(d=>{
    if(!d||typeof d.id!=='string'||!/^[-\w]{1,40}$/.test(d.id)||ids.has(d.id))throw Error('接触对 ID 无效或重复');ids.add(d.id);
    if(p.parts.some(b=>b.method==='fem'&&b.id===d.a)&&p.parts.some(b=>b.method==='fem'&&b.id===d.b))return d;
    if(!rigids.some(b=>b.id===d.a)||!p.parts.some(b=>b.id===d.b&&b.method==='fem'))throw Error('FEM 接触对 A 须为球形刚体，B 须为 FEM 部件');
    const key=d.a+'|'+d.b;if(keys.has(key))throw Error('同一部件对只能有一个接触定义');keys.add(key);
    const r={...d,name:String(d.name??d.id).slice(0,80),mechanical:d.mechanical??true,thermal:d.thermal??false,friction:d.friction??0,stiffness:d.stiffness??1e5,damping:d.damping??0,contactConductance:d.contactConductance??1000,thermalArea:d.thermalArea??.001};
    if(typeof r.thermal!=='boolean'||!Number.isFinite(r.contactConductance)||r.contactConductance<0||r.contactConductance>100000||!Number.isFinite(r.thermalArea)||r.thermalArea<=0||r.thermalArea>100)throw Error('界面换热系数或等效接触面积无效');
    if(r.thermal&&!p.solver.thermal)throw Error('请先启用 FEM 瞬态温度场');
    if(typeof r.mechanical!=='boolean'||!Number.isFinite(r.friction)||r.friction<0||r.friction>2||!Number.isFinite(r.stiffness)||r.stiffness<=0||r.stiffness>1e10||!Number.isFinite(r.damping)||r.damping<0||r.damping>1e6)throw Error('接触参数无效：刚度 (0, 1e10] N/m，阻尼 [0, 1e6] N·s/m，摩擦 [0, 2]');
    return r;
  });
  return validateFEMSurfaceContacts(p);
}

// Closest point on a triangle, including edge/vertex Voronoi regions.
// One closest feature per sphere/part prevents duplicate edge forces.
export function closestTriangle(p,a,b,c){
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  let w;
  if(d1<=0&&d2<=0)w=[1,0,0];
  else{
    const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp),vc=d1*d4-d3*d2;
    if(d3>=0&&d4<=d3)w=[0,1,0];
    else if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);w=[1-v,v,0];}
    else{
      const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp),vb=d5*d2-d1*d6,va=d3*d6-d5*d4;
      if(d6>=0&&d5<=d6)w=[0,0,1];
      else if(vb<=0&&d2>=0&&d6<=0){const v=d2/(d2-d6);w=[1-v,0,v];}
      else if(va<=0&&d4-d3>=0&&d5-d6>=0){const v=(d4-d3)/((d4-d3)+(d5-d6));w=[0,1-v,v];}
      else{const denom=va+vb+vc;if(!(denom>1e-30))throw Error('FEM 接触面退化，请减小载荷或改用大变形模型');w=[va/denom,vb/denom,vc/denom];}
    }
  }
  return {weights:w,point:a.map((x,k)=>w[0]*x+w[1]*b[k]+w[2]*c[k])};
}
const node=(s,n)=>s.mesh.nodes[n].map((x,k)=>x+s.u[3*n+k]);
function hit(pair,all=false){
  const {body:r,state:s}=pair;let best=null,dist=Infinity;
  for(const tri of s.mesh.surface){
    const v=tri.nodes.map(n=>node(s,n));
    if(!all&&[0,1,2].some(k=>r.x[k]<Math.min(...v.map(x=>x[k]))-r.radius||r.x[k]>Math.max(...v.map(x=>x[k]))+r.radius))continue;
    const c=closestTriangle(r.x,...v),delta=sub(r.x,c.point),d=length(delta);
    if(d<dist){dist=d;best={...c,ids:tri.nodes,normal:d>1e-12?scale(delta,1/d):tri.normal,depth:r.radius-d,arm:sub(c.point,r.x)};}
  }
  return best;
}
function inside(s,p){
  return s.mesh.cells.some(c=>{
    const [a,b,d,e]=c.ids.map(n=>node(s,n)),ab=sub(b,a),ad=sub(d,a),ae=sub(e,a),ap=sub(p,a),det=dot(ab,cross(ad,ae));
    if(Math.abs(det)<1e-20)return false;
    const w=[dot(ap,cross(ad,ae))/det,dot(ab,cross(ap,ae))/det,dot(ab,cross(ad,ap))/det];
    return w.every(x=>x>=-1e-10)&&w.reduce((a,x)=>a+x,0)<=1+1e-10;
  });
}
const bodyK=r=>.5*r.mass*dot(r.v,r.v)+.5*r.inertia*dot(r.omega,r.omega);
const femK=(s,ids)=>ids.reduce((sum,n)=>sum+[0,1,2].reduce((a,k)=>a+.5*s.m[3*n+k]*s.v[3*n+k]**2,0),0);
function relative(pair,c){
  const v=add(pair.body.v,cross(pair.body.omega,c.arm));
  for(let j=0;j<3;j++)for(let k=0;k<3;k++)v[k]-=c.weights[j]*pair.state.v[3*c.ids[j]+k];
  return v;
}
function effective(pair,c,dir){
  const {body:r,state:s}=pair;let w=r.invMass+r.invInertia*dot(cross(c.arm,dir),cross(c.arm,dir));
  for(let j=0;j<3;j++)for(let k=0;k<3;k++){const i=3*c.ids[j]+k;if(!s.fixed[i])w+=c.weights[j]**2*dir[k]**2/s.m[i];}
  return w;
}
// Both sides receive the same world-space impulse at the same contact point.
export function applyContactImpulse(pair,c,J){
  const {body:r,state:s}=pair,before=bodyK(r),beforeF=femK(s,c.ids),torque=cross(c.arm,J);
  for(let k=0;k<3;k++){r.v[k]+=r.invMass*J[k];r.omega[k]+=r.invInertia*torque[k];}
  for(let j=0;j<3;j++)for(let k=0;k<3;k++){const i=3*c.ids[j]+k;if(!s.fixed[i])s.v[i]-=c.weights[j]*J[k]/s.m[i];}
  const deltaF=femK(s,c.ids)-beforeF;s.contactWork+=deltaF;
  return Math.max(0,before-bodyK(r)-deltaF);
}
export class FEMContacts{
  constructor(project,states){
    this.bodies=project.parts.filter(b=>b.method==='rigid').map(part=>{
      const mass=part.material.mass,radius=part.geometry.size[0]/2,inertia=.4*mass*radius*radius,dynamic=part.boundary.motion==='dynamic';
      const r={part,mass,radius,inertia,invMass:dynamic?1/mass:0,invInertia:dynamic?1/inertia:0,x:part.geometry.center.slice(),v:part.initial.velocity.slice(),omega:part.initial.angularVelocity.slice(),q:quaternion(part.geometry.rotation),force:[0,0,0],external:scale(project.environment.gravity,mass),externalWork:0};
      r.capacity=mass*part.material.cp;r.temperature=part.initial.temperature;r.energy=r.capacity*r.temperature;
      r.initialEnergy=bodyK(r);return r;
    });
    for(const s of states){s.contactForce=new Float64Array(s.u.length);s.contactWork=0;}
    this.states=states;
    this.pairs=project.contactPairs.filter(d=>this.bodies.some(r=>r.part.id===d.a)).map(d=>({definition:d,body:this.bodies.find(r=>r.part.id===d.a),state:states.find(s=>s.part.id===d.b),normalLoss:0,frictionLoss:0,impulse:[0,0,0],tangent:[0,0,0],torque:[0,0,0],normalImpulse:0,maxDepth:0,samples:0,slip:0,heat:0,accumulatedHeat:0,thermalSamples:0}));
    this.surfaceContacts=new FEMSurfaceContacts(project,states);
    for(const p of this.pairs)if(p.definition.mechanical){const c=hit(p,true);if(inside(p.state,p.body.x)||c?.depth>1e-8)throw Error('刚体与 FEM 初始重叠，请移动球心或减小直径后重试');}
    this.duration=0;
  }
  // Bound the added normal penalty stiffness in mass-normalized coordinates.
  spectralBound(){return this.pairs.reduce((sum,p)=>{
    if(!p.definition.mechanical)return sum;
    let inv=0;for(let i=0;i<p.state.m.length;i++)if(!p.state.fixed[i])inv=Math.max(inv,1/p.state.m[i]);
    return sum+p.definition.stiffness*(p.body.invMass+inv);
  },this.surfaceContacts.spectralBound());}
  travelLimit(){
    let limit=Infinity;
    for(const p of this.pairs)if(p.definition.mechanical){let speed=length(p.body.v);for(let i=0;i<p.state.v.length;i+=3)speed=Math.max(speed,Math.hypot(...p.state.v.subarray(i,i+3)));limit=Math.min(limit,.025*p.body.radius/Math.max(speed,1e-12));}
    return Math.min(limit,this.surfaceContacts.travelLimit());
  }
  begin(duration){this.duration=duration;this.surfaceContacts.begin(duration);for(const p of this.pairs)Object.assign(p,{impulse:[0,0,0],tangent:[0,0,0],torque:[0,0,0],normalImpulse:0,maxDepth:0,samples:0,slip:0,heat:0,thermalSamples:0});}
  thermalContact(p){const c=hit(p,true);return c&&c.depth>=-1e-9?c:null;}
  forces(weight=0){
    for(const s of this.states)s.contactForce.fill(0);
    for(const r of this.bodies)r.force=r.external.slice();
    for(const p of this.pairs){
      // Roundoff at an exact touching configuration must not trigger a finite
      // dashpot impulse one step earlier after a rigid rotation of the model.
      const c=p.definition.mechanical?hit(p):null;p.contact=c?.depth>1e-10*p.body.radius?c:null;
      if(!p.contact)continue;
      if(c.depth>.2*p.body.radius)throw Error('接触穿透超过球半径 20%，请提高接触刚度、细化网格或降低撞击速度');
      const magnitude=p.definition.stiffness*c.depth,F=scale(c.normal,magnitude);
      for(let k=0;k<3;k++){p.body.force[k]+=F[k];p.impulse[k]+=weight*F[k];}
      for(let j=0;j<3;j++)for(let k=0;k<3;k++)p.state.contactForce[3*c.ids[j]+k]-=c.weights[j]*F[k];
      p.normalImpulse+=weight*magnitude;p.maxDepth=Math.max(p.maxDepth,c.depth);
    }
    this.surfaceContacts.forces(weight);
  }
  kick(h){for(const r of this.bodies)for(let k=0;k<3;k++)r.v[k]+=h*r.invMass*r.force[k];}
  drift(h){
    for(const r of this.bodies){
      if(!r.invMass)continue;
      if(h*length(r.v)>.05*r.radius)throw Error('接触步长过大，单步运动超过球半径 5%；请减小 FEM 最大步长');
      for(let k=0;k<3;k++){const dx=h*r.v[k];r.x[k]+=dx;r.externalWork+=r.external[k]*dx;}
      const speed=length(r.omega),angle=h*speed/2;
      if(speed){r.q=qmul([...scale(r.omega,Math.sin(angle)/speed),Math.cos(angle)],r.q);const norm=Math.hypot(...r.q);r.q=r.q.map(x=>x/norm);}
      if(![...r.x,...r.v,...r.omega,...r.q].every(Number.isFinite))throw Error('刚体接触积分出现非有限值');
    }
    this.surfaceContacts.checkTravel();
  }
  dissipate(h){
    for(const p of this.pairs){
      const c=p.contact;if(!c)continue;
      const vn=dot(relative(p,c),c.normal),w=effective(p,c,c.normal);
      // Compression-only dashpot: dissipative, no tensile force on separation.
      const j=vn<0&&w>0?-vn*(-Math.expm1(-p.definition.damping*w*h))/w:0;
      if(j){const J=scale(c.normal,j);p.normalLoss+=applyContactImpulse(p,c,J);for(let k=0;k<3;k++)p.impulse[k]+=J[k];p.normalImpulse+=j;}
      const rel=relative(p,c),t=sub(rel,scale(c.normal,dot(rel,c.normal))),slip=length(t);p.samples++;p.slip+=slip;
      if(slip>1e-12&&p.definition.friction>0){
        const dir=scale(t,1/slip),wt=effective(p,c,dir);
        const jt=wt>0?Math.min(slip/wt,p.definition.friction*(h*p.definition.stiffness*c.depth+j)):0,J=scale(dir,-jt);
        p.frictionLoss+=applyContactImpulse(p,c,J);const torque=cross(c.arm,J);
        for(let k=0;k<3;k++){p.impulse[k]+=J[k];p.tangent[k]+=J[k];p.torque[k]+=torque[k];}
      }
    }
    this.surfaceContacts.dissipate(h);
  }
  energy(){return this.pairs.reduce((s,p)=>s+(p.contact?.depth>0?.5*p.definition.stiffness*p.contact.depth**2:0),this.surfaceContacts.energy());}
  backup(){return {duration:this.duration,bodies:this.bodies.map(r=>structuredClone(r)),pairs:this.pairs.map(({body,state,...p})=>structuredClone(p)),surface:this.surfaceContacts.backup()};}
  restore(b){this.duration=b.duration;this.bodies.forEach((r,i)=>Object.assign(r,b.bodies[i]));this.pairs.forEach((p,i)=>Object.assign(p,b.pairs[i]));this.surfaceContacts.restore(b.surface);this.forces();}
  snapshot(){
    this.surfaceContacts.refresh();
    const bodies=this.bodies.map(r=>({id:r.part.id,name:r.part.name,shape:'sphere',type:r.part.boundary.motion,size:r.part.geometry.size,position:r.x.slice(),rotation:r.q.slice(),velocity:r.v.slice(),angularVelocity:r.omega.slice(),acceleration:scale(r.force,r.invMass),displacement:sub(r.x,r.part.geometry.center),kinetic:bodyK(r),temperature:r.temperature,thermalEnergy:r.energy,heatCapacity:r.capacity}));
    const contactPairs=this.pairs.map(p=>({...p.definition,force:scale(p.impulse,this.duration?1/this.duration:0),oppositeForce:scale(p.impulse,this.duration?-1/this.duration:0),torque:scale(p.torque,this.duration?1/this.duration:0),normalForce:this.duration?p.normalImpulse/this.duration:0,tangentialForce:scale(p.tangent,this.duration?1/this.duration:0),slipSpeed:p.samples?p.slip/p.samples:0,samples:p.samples,maxPenetration:p.maxDepth,contactEnergy:p.contact?.depth>0?.5*p.definition.stiffness*p.contact.depth**2:0,normalLoss:p.normalLoss,frictionLoss:p.frictionLoss,point:p.contact?.point,heatRate:this.duration?p.heat/this.duration:0,heat:p.heat,accumulatedHeat:p.accumulatedHeat,thermalSamples:p.thermalSamples}));
    const surface=this.surfaceContacts.snapshot();
    return {bodies,contactPairs:[...contactPairs,...surface.contactPairs],rigidKinetic:bodies.reduce((a,r)=>a+r.kinetic,0),initialEnergy:this.bodies.reduce((s,r)=>s+r.initialEnergy,0),externalWork:this.bodies.reduce((s,r)=>s+r.externalWork,0),contactEnergy:this.energy(),contactDissipated:this.pairs.reduce((s,p)=>s+p.normalLoss+p.frictionLoss,surface.contactDissipated)};
  }
}
