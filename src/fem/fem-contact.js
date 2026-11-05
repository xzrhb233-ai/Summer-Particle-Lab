import {closestTriangle} from './contact.js';
import {sub,dot,cross,meshLength} from './mesh.js';

const scale=(v,s)=>v.map(x=>x*s),length=v=>Math.hypot(...v);
const matvec=(A,v)=>[0,1,2].map(i=>dot(A.slice(3*i,3*i+3),v));
const position=(s,n)=>s.mesh.nodes[n].map((x,k)=>x+s.u[3*n+k]);
const femPair=(p,d)=>p.parts.some(b=>b.id===d.a&&b.method==='fem')&&p.parts.some(b=>b.id===d.b&&b.method==='fem');

export function validateFEMSurfaceContacts(project){
  const keys=new Set();let count=0;
  project.contactPairs=project.contactPairs.map(d=>{
    if(!femPair(project,d))return d;
    const key=[d.a,d.b].sort().join('|');
    if(d.a===d.b||keys.has(key))throw Error('同一 FEM 部件对只能定义一次接触');keys.add(key);
    if(++count>16)throw Error('当前最多支持 16 个 FEM–FEM 表面接触对');
    const r={...d,name:String(d.name??d.id).slice(0,80),mechanical:d.mechanical??true,thermal:d.thermal??true,
      friction:d.friction??.2,stiffness:d.stiffness??1e5,damping:d.damping??20,contactConductance:d.contactConductance??1000};
    if(typeof r.mechanical!=='boolean'||typeof r.thermal!=='boolean'||!Number.isFinite(r.friction)||r.friction<0||r.friction>2||
      !Number.isFinite(r.stiffness)||r.stiffness<=0||r.stiffness>1e10||!Number.isFinite(r.damping)||r.damping<0||r.damping>1e6||
      !Number.isFinite(r.contactConductance)||r.contactConductance<0||r.contactConductance>1e5)throw Error('FEM–FEM 接触刚度、阻尼、摩擦或导热系数无效');
    if(r.thermal&&!project.solver.thermal)throw Error('FEM–FEM 接触传热需要启用温度场');
    if((r.frictionHeatFraction??0)!==0)throw Error('CPU FEM–FEM 接触暂不支持摩擦耗散转热');
    return r;
  });
  return project;
}

function inside(s,x){
  return s.mesh.cells.some(cell=>{
    const [a,b,c,d]=cell.ids.map(n=>position(s,n)),ab=sub(b,a),ac=sub(c,a),ad=sub(d,a),ap=sub(x,a),det=dot(ab,cross(ac,ad));
    if(!(det>1e-20))throw Error('FEM 接触网格出现翻转或退化单元');
    const w=[dot(ap,cross(ac,ad))/det,dot(ab,cross(ap,ad))/det,dot(ab,cross(ac,ap))/det];
    return w.every(v=>v>=-1e-9)&&w.reduce((a,v)=>a+v,0)<=1+1e-9;
  });
}

function surfaceData(state,band){
  const points=state.mesh.nodes.map((_,n)=>position(state,n)),width=meshLength(state,true),bins=new Map(),incident=new Map();
  const triangles=state.mesh.surface.map(t=>{
    const vertices=t.nodes.map(n=>points[n]),normal=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])),norm=length(normal);
    if(!(norm>1e-16))throw Error('FEM 接触三角面退化');
    const r={...t,vertices,normal:scale(normal,1/norm),area:norm/2};
    for(const n of t.nodes){if(!incident.has(n))incident.set(n,[]);incident.get(n).push(r);}
    const lo=[0,1,2].map(k=>Math.floor((Math.min(...vertices.map(v=>v[k]))-band)/width)),hi=[0,1,2].map(k=>Math.floor((Math.max(...vertices.map(v=>v[k]))+band)/width));
    if(hi.reduce((s,v,k)=>s*(v-lo[k]+1),1)>4096)throw Error('FEM 表面形变过大，接触搜索范围超出当前小变形能力');
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      const key=x+','+y+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(r);
    }
    return r;
  });
  return {points,triangles,incident,width,bins,cell:meshLength(state)};
}
function nearest(data,x){
  let best=null,distance=Infinity;
  for(const tri of data.bins.get(x.map(v=>Math.floor(v/data.width)).join(','))??[]){
    const hit=closestTriangle(x,...tri.vertices),d=length(sub(x,hit.point));
    if(d<distance-1e-12){distance=d;best={...hit,tri,distance:d,gap:dot(sub(x,hit.point),tri.normal)};}
  }
  return best;
}
function relative(c){
  return [0,1,2].map(k=>c.vertex.v[3*c.node+k]-c.ids.reduce((v,n,a)=>v+[0,1,2].reduce((sum,j)=>sum+c.W[a][3*j+k]*c.face.v[3*n+j],0),0));
}
function effective(c,dir){
  let w=0;
  for(let k=0;k<3;k++){
    const n=3*c.node+k;if(!c.vertex.fixed[n])w+=dir[k]**2/c.vertex.m[n];
  }
  for(let a=0;a<3;a++){const mapped=matvec(c.W[a],dir);for(let k=0;k<3;k++){const i=3*c.ids[a]+k;if(!c.face.fixed[i])w+=mapped[k]**2/c.face.m[i];}}
  return w;
}
function wrenchMap(vertices,point,weights,surfacePoint){
  const center=[0,1,2].map(k=>vertices.reduce((sum,v)=>sum+v[k],0)/3),arms=vertices.map(v=>sub(v,center)),S=Array(9).fill(0);
  for(const r of arms)for(let j=0;j<3;j++)for(let k=0;k<3;k++)S[3*j+k]+=(j===k?dot(r,r):0)-r[j]*r[k];
  const [a,b,c,d,e,f,g,h,i]=S,C=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],det=a*C[0]+b*C[3]+c*C[6];
  if(!(det>1e-30))throw Error('FEM 接触三角面力矩映射退化');
  const inverse=C.map(v=>v/det),W=arms.map(()=>Array(9).fill(0));
  for(let k=0;k<3;k++){
    const unit=[0,0,0];unit[k]=1;
    const spin=matvec(inverse,cross(sub(point,surfacePoint),unit));
    for(let a=0;a<3;a++){const couple=cross(spin,arms[a]);for(let j=0;j<3;j++)W[a][3*j+k]=weights[a]*unit[j]+couple[j];}
  }
  return W;
}
const localK=(s,ids)=>ids.reduce((sum,n)=>sum+[0,1,2].reduce((a,k)=>a+.5*s.m[3*n+k]*s.v[3*n+k]**2,0),0);
function impulse(c,J,dt){
  const beforeA=localK(c.vertex,[c.node]),beforeB=localK(c.face,c.ids);
  const mapped=c.W.map(W=>matvec(W,J));
  for(let k=0;k<3;k++){
    const a=3*c.node+k;if(!c.vertex.fixed[a])c.vertex.v[a]+=J[k]/c.vertex.m[a];
    if(dt)c.vertex.contactForce[a]+=J[k]/dt;
    for(let j=0;j<3;j++){const b=3*c.ids[j]+k;if(!c.face.fixed[b])c.face.v[b]-=mapped[j][k]/c.face.m[b];if(dt)c.face.contactForce[b]-=mapped[j][k]/dt;}
  }
  const da=localK(c.vertex,[c.node])-beforeA,db=localK(c.face,c.ids)-beforeB;
  c.vertex.contactWork+=da;c.face.contactWork+=db;return Math.max(0,-da-db);
}

// Symmetric two-pass vertex/triangle contact on the deformed Tet4 boundary.
// Both passes use half quadrature area so matching meshes do not double force
// or heat. This is discrete contact, not continuous collision/edge-edge CCD.
export class FEMSurfaceContacts{
  constructor(project,states){
    this.states=states;this.duration=0;
    this.pairs=project.contactPairs.filter(d=>femPair(project,d)).map(definition=>{
      const a=states.find(s=>s.part.id===definition.a),b=states.find(s=>s.part.id===definition.b);
      const minCell=Math.min(meshLength(a),meshLength(b));
      const nominalArea=Math.min(...[a,b].map(s=>Math.max(...[0,1,2].map(k=>s.part.geometry.size.reduce((v,x,j)=>j===k?v:v*x,1)))));
      return {definition,a,b,minCell,nominalArea,contacts:[],normalLoss:0,frictionLoss:0,accumulatedHeat:0,totalImpulse:[0,0,0]};
    });
    this.begin(0);
    for(const p of this.pairs)if(p.definition.mechanical){
      const data=this.geometry(p);
      for(const [a,b,da,db] of [[p.a,p.b,data[0],data[1]],[p.b,p.a,data[1],data[0]]]){
        const center=[0,1,2].map(k=>da.points.reduce((sum,v)=>sum+v[k],0)/da.points.length);
        for(const x of [...da.incident.keys()].map(n=>da.points[n]).concat([center])){
          const hit=nearest(db,x),tolerance=1e-8*p.minCell,touch=hit?.distance<=tolerance;
          const penetration=hit?.gap< -tolerance&&hit.distance<=-hit.gap+tolerance;
          if(!touch&&(penetration||inside(b,x)))throw Error('FEM 部件初始重叠，请调整位置后建立表面接触');
        }
      }
    }
  }
  geometry(p){return [surfaceData(p.a,.21*p.minCell),surfaceData(p.b,.21*p.minCell)];}
  detect(p){
    const [a,b]=this.geometry(p),contacts=[];
    for(const [vertex,face,va,vb,sign] of [[p.a,p.b,a,b,1],[p.b,p.a,b,a,-1]])for(const [n,incident] of va.incident){
      const hit=nearest(vb,va.points[n]);if(!hit||hit.distance>.21*p.minCell||hit.gap>1e-8*p.minCell)continue;
      // A closest edge outside the face projection is not penetration of its
      // plane. Edge/edge CCD is outside this discrete surface formulation.
      if(hit.distance>Math.abs(hit.gap)+1e-8*p.minCell)continue;
      // Only opposite-facing boundary patches contribute a surface measure.
      const area=.5*incident.reduce((sum,t)=>sum+t.area/3*Math.max(0,-dot(t.normal,hit.tri.normal)),0);
      if(area<1e-16)continue;
      if(-hit.gap>.2*p.minCell)throw Error('FEM–FEM 穿透超过最小网格边长 20%，请提高接触刚度或降低撞击速度');
      // Transfer both resultant and moment at the same world point. The
      // adjoint map also defines relative velocity and effective mass, so
      // tangential friction conserves angular momentum across penetration.
      const point=va.points[n],W=wrenchMap(hit.tri.vertices,point,hit.weights,hit.point);
      contacts.push({vertex,face,node:n,ids:hit.tri.nodes,weights:hit.weights,W,normal:hit.tri.normal,point,depth:Math.max(0,-hit.gap),area,weight:area/p.nominalArea,sign});
    }
    return contacts;
  }
  spectralBound(){
    return this.pairs.reduce((sum,p)=>{
      if(!p.definition.mechanical)return sum;
      const inverse=[p.a,p.b].reduce((sum,s)=>sum+s.m.reduce((max,m,i)=>s.fixed[i]?max:Math.max(max,1/m),0),0);
      // Two-pass contact may share receiving nodes; total boundary-area weight
      // bounds all such rows without assuming matching meshes.
      const weight=[p.a,p.b].reduce((a,s)=>a+s.mesh.surface.reduce((v,t)=>v+t.area,0),0)/(2*p.nominalArea);
      return sum+2*p.definition.stiffness*inverse*weight;
    },0);
  }
  travelLimit(){
    return this.pairs.reduce((limit,p)=>{
      if(!p.definition.mechanical)return limit;
      const speed=[p.a,p.b].reduce((sum,s)=>sum+s.v.reduce((max,_,i)=>i%3?max:Math.max(max,Math.hypot(...s.v.subarray(i,i+3))),0),0);
      return Math.min(limit,.025*p.minCell/Math.max(speed,1e-12));
    },Infinity);
  }
  checkTravel(){
    for(const p of this.pairs)if(p.definition.mechanical)for(const s of [p.a,p.b])if(s.du){
      for(let i=0;i<s.du.length;i+=3)if(Math.hypot(...s.du.subarray(i,i+3))>.05*p.minCell)throw Error('FEM 表面单步运动超过最小网格边长 5%，请减小时间步或降低载荷');
    }
  }
  begin(duration){this.duration=duration;for(const p of this.pairs)Object.assign(p,{impulse:[0,0,0],tangent:[0,0,0],torque:[0,0,0],normalImpulse:0,maxDepth:0,samples:0,slip:0,heat:0,thermalSamples:0});}
  refresh(){
    // Mixed interfaces may correct FEM positions after the last force sample.
    // Storage must describe those current positions without adding impulses,
    // heat, samples, or a fictitious new penetration observation.
    for(const p of this.pairs)p.contacts=p.definition.mechanical?this.detect(p):[];
  }
  forces(weight=0){
    for(const p of this.pairs){
      p.contacts=p.definition.mechanical?this.detect(p):[];
      for(const c of p.contacts){
        if(!c.depth)continue;
        const magnitude=p.definition.stiffness*c.weight*c.depth,F=scale(c.normal,magnitude),mapped=c.W.map(W=>matvec(W,F));
        for(let k=0;k<3;k++){
          c.vertex.contactForce[3*c.node+k]+=F[k];
          for(let j=0;j<3;j++)c.face.contactForce[3*c.ids[j]+k]-=mapped[j][k];
          const j=c.sign*weight*F[k];p.impulse[k]+=j;p.totalImpulse[k]+=j;
        }
        const torque=cross(sub(c.point,p.a.part.geometry.center),scale(F,c.sign*weight));for(let k=0;k<3;k++)p.torque[k]+=torque[k];
        p.normalImpulse+=weight*magnitude;if(weight>0)p.maxDepth=Math.max(p.maxDepth,c.depth);
      }
    }
  }
  dissipate(h){
    for(const p of this.pairs)for(const c of p.contacts){
      if(!c.depth)continue;
      const vn=dot(relative(c),c.normal),w=effective(c,c.normal),j=vn<0&&w>0?-vn*(-Math.expm1(-p.definition.damping*c.weight*w*h))/w:0;
      if(j){const J=scale(c.normal,j),torque=cross(sub(c.point,p.a.part.geometry.center),scale(J,c.sign));p.normalLoss+=impulse(c,J,h);for(let k=0;k<3;k++){p.impulse[k]+=c.sign*J[k];p.totalImpulse[k]+=c.sign*J[k];p.torque[k]+=torque[k];}p.normalImpulse+=j;}
      const rel=relative(c),t=sub(rel,scale(c.normal,dot(rel,c.normal))),slip=length(t);p.samples++;p.slip+=slip;
      if(slip>1e-12&&p.definition.friction>0){
        const dir=scale(t,1/slip),wt=effective(c,dir),jt=wt>0?Math.min(slip/wt,p.definition.friction*(h*p.definition.stiffness*c.weight*c.depth+j)):0,J=scale(dir,-jt);
        p.frictionLoss+=impulse(c,J,h);
        const torque=cross(sub(c.point,p.a.part.geometry.center),scale(J,c.sign));
        for(let k=0;k<3;k++){p.impulse[k]+=c.sign*J[k];p.totalImpulse[k]+=c.sign*J[k];p.tangent[k]+=c.sign*J[k];p.torque[k]+=torque[k];}
      }
    }
  }
  thermalEdges(){
    const edges=[];
    for(const p of this.pairs){
      const d=p.definition,ka=p.a.part.material.conductivity,kb=p.b.part.material.conductivity;if(!d.thermal||!d.contactConductance||!ka||!kb)continue;
      const cells=[p.a,p.b].map(s=>meshLength(s));
      const resistance=1/d.contactConductance+.5*cells[0]/ka+.5*cells[1]/kb;
      for(const c of this.detect(p))for(let k=0;k<3;k++)if(c.weights[k]>1e-14)edges.push({i:c.vertex.thermal.offset+c.node,j:c.face.thermal.offset+c.ids[k],g:c.area*c.weights[k]/resistance,pair:p,pairSign:c.sign});
    }
    return edges;
  }
  energy(){return this.pairs.reduce((sum,p)=>sum+p.contacts.reduce((e,c)=>e+.5*p.definition.stiffness*c.weight*c.depth**2,0),0);}
  backup(){return {duration:this.duration,pairs:this.pairs.map(({a,b,contacts,...p})=>structuredClone(p))};}
  restore(backup){this.duration=backup.duration;this.pairs.forEach((p,i)=>Object.assign(p,backup.pairs[i]));}
  snapshot(){
    const rate=this.duration?1/this.duration:0;
    return {contactEnergy:this.energy(),contactDissipated:this.pairs.reduce((sum,p)=>sum+p.normalLoss+p.frictionLoss,0),contactPairs:this.pairs.map(p=>({...p.definition,
      scheme:'fem-vertex-triangle/1',force:scale(p.impulse,rate),oppositeForce:scale(p.impulse,-rate),totalImpulse:p.totalImpulse.slice(),torque:scale(p.torque,rate),normalForce:p.normalImpulse*rate,tangentialForce:scale(p.tangent,rate),
      slipSpeed:p.samples?p.slip/p.samples:0,samples:p.samples,maxPenetration:p.maxDepth,normalLoss:p.normalLoss,frictionLoss:p.frictionLoss,contactEnergy:p.contacts.reduce((sum,c)=>sum+.5*p.definition.stiffness*c.weight*c.depth**2,0),
      heatRate:p.heat*rate,heat:p.heat,accumulatedHeat:p.accumulatedHeat,thermalSamples:p.thermalSamples,point:p.contacts[0]?.point}))};
  }
}
