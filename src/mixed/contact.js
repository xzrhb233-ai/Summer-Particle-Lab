import {exchangeImpulse,exchangeHeat,ExchangeBook} from '../simulation/coupling-interface.js';
import {closestTriangle} from '../fem/contact.js';
import {dot,cross,sub,meshLength} from '../fem/mesh.js';
import {multiply} from '../fem/solver.js';
import {elasticEnergy,updateThermalForce} from '../fem/thermal.js';
import {particlePort,lumpedPort} from '../simulation/thermal-ports.js';
import {MATERIALS} from '../materials.js';
import {fluidContactDOFs} from './fluid-contact.js';
import {rigidFEMContacts,rigidContactLength,rigidSurfaceArea,rigidProjectedArea,rigidThermalLength,rigidCenterInsideFEM} from './rigid-geometry.js';
import {rigidDOFs,rigidPosition,rigidRadius,rigidInverseMass,shiftRigid} from './rigid-contact.js';

const L=.025,xyz=['x','y','z'],vel=['vx','vy','vz'];
const add=(a,b)=>a.map((x,k)=>x+b[k]),scale=(v,a)=>v.map(x=>x*a),norm=v=>Math.hypot(...v);
const position=(s,i)=>xyz.map(k=>s[k][i]*L);
const radius=(s,i)=>.5*Math.cbrt(s.volume[i]*.001);
function surface(state){
  const nodes=state.mesh.nodes.map((v,n)=>v.map((x,k)=>x+state.u[3*n+k]));
  return state.mesh.surface.map(t=>{const v=t.nodes.map(n=>nodes[n]),n=cross(sub(v[1],v[0]),sub(v[2],v[0])),l=norm(n);
    if(l<1e-14)throw Error('混合接触面退化');
    const normal=scale(n,(dot(n,t.normal)<0?-1:1)/l);
    return {ids:t.nodes,v,normal,lo:xyz.map((_,k)=>Math.min(...v.map(x=>x[k]))),hi:xyz.map((_,k)=>Math.max(...v.map(x=>x[k])))};});
}
function nearest(triangles,p,r,all=false){
  let best=null,bestD=Infinity;
  for(const t of triangles){
    if(!all&&xyz.some((_,k)=>p[k]<t.lo[k]-r-1e-9||p[k]>t.hi[k]+r+1e-9))continue;
    const q=closestTriangle(p,...t.v),d=sub(p,q.point),length=norm(d);
    if(length>=bestD)continue;
    const signed=dot(d,t.normal)<-1e-10?-length:length;
    bestD=length;best={...q,ids:t.ids,normal:length>1e-12?scale(d,(signed<0?-1:1)/length):t.normal,depth:r-signed,arm:sub(q.point,p)};
  }
  return best&&best.depth>=-1e-9?best:null;
}
function sourceHits(pair,s,entry,faces,padding=0,all=false){
  if(pair.rigid&&pair.rigid.definition.shape!=='sphere')return rigidFEMContacts(pair.rigid,faces,padding).map(h=>({...h,depth:h.depth+padding}));
  const r=pair.rigid?rigidRadius(pair.rigid):radius(s,entry.index),point=pair.rigid?rigidPosition(pair.rigid):position(s,entry.index),h=nearest(faces,point,r+padding,all);
  return h?[h]:[];
}
// APIC's skew(C) stores subcell rotation. Its angular inertia is 2 m D,
// D=h_grid²/4 for quadratic B-splines. Tangential impulses change that spin,
// so the FEM receives the opposite impulse at the same physical point.
export function contactDOFs(s,i,state,hit){
  const point=[0,1,2].map(k=>hit.ids.reduce((sum,n,a)=>sum+hit.weights[a]*(state.mesh.nodes[n][k]+state.u[3*n+k]),0));
  hit={...hit,point,arm:sub(point,position(s,i))};
  if(!s.isSolid(i))return fluidContactDOFs(s,i,state,hit);
  const mobile=!s.pinned[i],solid=s.isSolid(i),m=s.mass[i],D=(s.mpm.H*L)**2/4,I=solid&&mobile?2*m*D:Infinity,off=i*9;
  const omega=()=>solid?[(s.mpm.C[off+7]-s.mpm.C[off+5])*.5,(s.mpm.C[off+2]-s.mpm.C[off+6])*.5,(s.mpm.C[off+3]-s.mpm.C[off+1])*.5]:[0,0,0];
  const relative=()=>{
    const v=mobile?add(vel.map(k=>s[k][i]*L),cross(omega(),hit.arm)):[0,0,0];
    for(let a=0;a<3;a++)for(let k=0;k<3;k++)v[k]-=hit.weights[a]*state.v[3*hit.ids[a]+k];return v;
  };
  const inv=direction=>{
    let out=(mobile?1/m:0)+dot(cross(hit.arm,direction),cross(hit.arm,direction))/I;
    for(let a=0;a<3;a++)for(let k=0;k<3;k++){const n=3*hit.ids[a]+k;if(!state.fixed[n])out+=hit.weights[a]**2*direction[k]**2/state.m[n];}return out;
  };
  const particle={applyImpulse(J){
    let work=0;const support=[0,0,0],impulse=[0,0,0];
    if(mobile){
      const torque=cross(hit.arm,J),spin=omega();
      work=dot(J,vel.map(k=>s[k][i]*L))+.5*dot(J,J)/m+dot(torque,spin)+.5*dot(torque,torque)/I;
      for(let k=0;k<3;k++){s[vel[k]][i]+=J[k]/m/L;impulse[k]=J[k];}
      const w=scale(torque,1/I),C=s.mpm.C;
      C[off+1]-=w[2];C[off+2]+=w[1];C[off+3]+=w[2];C[off+5]-=w[0];C[off+6]-=w[1];C[off+7]+=w[0];
    }else for(let k=0;k<3;k++)support[k]=J[k];
    return {work,support,impulse};
  }};
  const fem={applyImpulse(J){
    let work=0;const support=[0,0,0],impulse=[0,0,0];
    for(let a=0;a<3;a++)for(let k=0;k<3;k++){
      const n=3*hit.ids[a]+k,j=hit.weights[a]*J[k];
      if(state.fixed[n])support[k]+=j;
      else {work+=j*state.v[n]+.5*j*j/state.m[n];state.v[n]+=j/state.m[n];impulse[k]+=j;}
    }
    state.contactWork+=work;return {work,support,impulse};
  }};
  const apply=J=>{const r=exchangeImpulse(particle,fem,J);return {...r,femWork:r.workB,mpmWork:r.workA};};

  return {point,relative,inv,apply,solid};
}
export class MixedContacts{
  constructor(project,mpm,fem){
    this.s=mpm.particles;this.fem=fem;this.duration=0;this.gravity=project.environment.gravity;this.exchanges=new ExchangeBook();
    const parts=project.parts.filter(p=>['mpm','pbf'].includes(p.method)),ports=new Map(parts.map((p,k)=>[p.id,particlePort(this.s,p,k+1).select({type:'whole'})]));
    for(const [id,body] of mpm.bodies){const heat=mpm.bodyHeat.get(id);ports.set(id,lumpedPort(heat,{capacity:heat.capacity,area:rigidSurfaceArea(body)}).select());}
    this.pairs=project.contactPairs.filter(d=>ports.has(d.a)&&fem.states.some(s=>s.part.id===d.b)).map(d=>({definition:d,rigid:mpm.bodies.get(d.a),state:fem.states.find(s=>s.part.id===d.b),entries:ports.get(d.a),accumulatedHeat:0,normalLoss:0,frictionLoss:0,correctionWork:0,particleCorrectionWork:0,totalImpulse:[0,0,0]}));
    this.begin(0);
    for(const p of this.pairs){const faces=surface(p.state),tolerance=p.rigid&&p.rigid.definition.shape!=='sphere'?Math.max(2e-7,rigidContactLength(p.rigid)*1e-5):1e-8;
      if(p.rigid&&rigidCenterInsideFEM(p.rigid,p.state))throw Error('刚体初始体积位于 FEM 内部，请调整几何中心或尺寸');
      for(const e of p.entries)if(sourceHits(p,this.s,e,faces,0,true).some(h=>h.depth>tolerance))throw Error('粒子或刚体初始体积与 FEM 重叠，请调整几何中心或尺寸');
    }
  }
  begin(duration){this.duration=duration;for(const p of this.pairs)Object.assign(p,{impulse:[0,0,0],torque:[0,0,0],tangent:[0,0,0],support:[0,0,0],normal:0,samples:0,slip:0,depth:0,heat:0,thermalSamples:0});}
  travelLimit(){
    let speed=0,r=Infinity;const s=this.s;
    for(let i=0;i<s.count;i++){speed=Math.max(speed,Math.hypot(s.vx[i],s.vy[i],s.vz[i])*L);r=Math.min(r,radius(s,i));}
    for(const p of this.pairs)if(p.rigid){speed=Math.max(speed,Math.hypot(...[p.rigid.rb.linvel().x,p.rigid.rb.linvel().y,p.rigid.rb.linvel().z]));r=Math.min(r,rigidContactLength(p.rigid));}
    let femSpeed=0;for(const f of this.fem.states)for(let i=0;i<f.v.length;i+=3)femSpeed=Math.max(femSpeed,Math.hypot(...f.v.subarray(i,i+3)));
    return .15*r/Math.max(.001,speed+femSpeed);
  }
  mechanical(){
    const s=this.s;
    for(let pass=0;pass<6;pass++){
      const surfaces=new Map(this.fem.states.map(f=>[f,surface(f)]));
      for(const p of this.pairs){if(!p.definition.mechanical)continue;
        const f=p.state,before=elasticEnergy(f,f.internal);let shifted=false;
        for(const e of p.entries){
          const i=e.index,r=p.rigid?rigidContactLength(p.rigid):radius(s,i),hits=sourceHits(p,s,e,surfaces.get(f)??surface(f));
          for(const [hitIndex,h] of hits.entries()){
          if(h.depth>r*.8)throw Error('MPM–FEM 接触穿透过深，已回滚本次推进；请减小步长或初速');
          p.depth=Math.max(p.depth,h.depth);const dofs=p.rigid?rigidDOFs(p.rigid,f,h):contactDOFs(s,i,f,h),relative=dofs.relative(),vn=dot(relative,h.normal),inv=dofs.inv(h.normal);
          const record=(J,loss,tangent=false)=>{
            const receipt=dofs.apply(J),{support}=receipt;this.exchanges.impulse(p.definition.id,receipt,tangent?'friction':'normal',Math.max(0,loss));p.impulse=add(p.impulse,J);p.totalImpulse=add(p.totalImpulse,J);p.torque=add(p.torque,cross(sub(dofs.point,p.rigid?rigidPosition(p.rigid):p.state.part.geometry.center),J));p.support=add(p.support,support);
            if(tangent){p.tangent=add(p.tangent,J);p.frictionLoss+=Math.max(0,loss);}else p.normalLoss+=Math.max(0,loss);
          };
          const j=vn<0&&inv>0?-vn/inv:0;
          if(j){record(scale(h.normal,j),.5*j*(-vn));p.normal+=j;p.samples++;
            const v=dofs.relative(),vt=sub(v,scale(h.normal,dot(v,h.normal))),speed=norm(vt);p.slip+=speed;
            // The fluid adapter supplies an adjoint nodal wrench without APIC spin.
            if(speed>1e-12){const t=scale(vt,1/speed),it=dofs.inv(t),jt=Math.min(p.definition.friction*j,speed/it);record(scale(t,-jt),jt*speed-.5*jt*jt*it,true);}
          }
          // Correct the deepest rigid feature once per manifold; applying the
          // same translation at every corner would multiply the correction.
          const correctionHit=p.rigid?hits[0]:h;
          if(correctionHit.depth>1e-10&&(!p.rigid||hitIndex===hits.length-1)){
            const h=correctionHit;
            const invSource=p.rigid?rigidInverseMass(p.rigid):(s.pinned[i]?0:1/s.mass[i]);
            const inverse=invSource+h.ids.reduce((sum,n,a)=>sum+h.normal.reduce((v,x,k)=>v+(f.fixed[3*n+k]?0:h.weights[a]**2*x*x/f.m[3*n+k]),0),0);
            if(!inverse)continue;const correction=h.depth/inverse;
            if(invSource){
              if(p.rigid)shiftRigid(p.rigid,scale(h.normal,correction*invSource));
              else for(let k=0;k<3;k++)s[xyz[k]][i]+=correction*h.normal[k]*invSource/L;
              for(let k=0;k<3;k++)p.particleCorrectionWork-=this.gravity[k]*correction*h.normal[k];
            }
            for(let a=0;a<3;a++)for(let k=0;k<3;k++){const n=3*h.ids[a]+k;if(!f.fixed[n])f.u[n]-=h.weights[a]*correction*h.normal[k]/f.m[n];}
            shifted=true;surfaces.delete(f);
          }
          }
        }
        if(shifted){multiply(f.A,f.u,f.internal);const work=elasticEnergy(f,f.internal)-before;p.correctionWork+=work;f.contactWork+=work;}
      }
    }
  }
  exchange(dt){
    const s=this.s,edges=[];
    const surfaces=new Map(this.fem.states.map(f=>[f,surface(f)]));
    for(const p of this.pairs){
      const d=p.definition,f=p.state,kf=f.part.material.conductivity;if(!d.thermal||!d.contactConductance||!kf)continue;
      const cell=meshLength(f);
      for(const e of p.entries){const i=e.index,r=p.rigid?rigidContactLength(p.rigid):radius(s,i),skin=d.thermalToleranceRatio*r,hits=sourceHits(p,s,e,surfaces.get(f),skin);
        for(const h of hits){
        // A spatial, timestep-independent tolerance regularizes the estimated
        // material-point boundary. The configurable radius fraction defaults
        // to 5% (1.25 mm in the demo), rather than toggling on roundoff gaps.
        // This is an approximate contact envelope, not gap radiation/convection.
        const coverage=skin?Math.min(1,Math.max(0,h.depth/skin)):1;if(!coverage)continue;
        const kp=p.rigid?p.rigid.definition.thermal.conductivity:MATERIALS[s.material[i]].conductivity;if(!kp)continue;
        const area=p.rigid?rigidProjectedArea(p.rigid,h.normal)/hits.length:4*r*r,path=p.rigid?rigidThermalLength(p.rigid,h.normal):r;
        const g=coverage*area/(1/d.contactConductance+path/kp+.5*cell/kf);
        for(let a=0;a<3;a++)if(h.weights[a]>0){const b=f.thermal.entries[h.ids[a]],G=g*h.weights[a];edges.push({a:e,b,g:G,pair:p.definition.id});}
        }
      }
    }
    const receipt=exchangeHeat(edges,dt);this.exchanges.heat(receipt);
    for(const p of this.pairs){const r=receipt.results.get(p.definition.id);if(r){p.heat+=r.heatA;p.accumulatedHeat+=r.heatA;p.thermalSamples+=r.samples;}}
    if(this.fem.thermal.enabled)for(const f of this.fem.states)updateThermalForce(f);
  }
  backup(){return this.pairs.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['definition','state','entries','rigid'].includes(k)).map(([k,v])=>[k,structuredClone(v)])));}
  restore(b){this.pairs.forEach((p,i)=>Object.assign(p,b[i]));}
  results(){const dt=this.duration||1;return this.pairs.map(p=>({...p.definition,force:scale(p.impulse,1/dt),oppositeForce:scale(p.impulse,-1/dt),torque:scale(p.torque,1/dt),normalForce:p.normal/dt,tangentialForce:scale(p.tangent,1/dt),slipSpeed:p.samples?p.slip/p.samples:0,samples:p.samples,maxPenetration:p.depth,heat:p.heat,heatRate:p.heat/dt,accumulatedHeat:p.accumulatedHeat,thermalSamples:p.thermalSamples,normalLoss:p.normalLoss,frictionLoss:p.frictionLoss,correctionWork:p.correctionWork,particleCorrectionWork:p.particleCorrectionWork,totalImpulse:p.totalImpulse.slice(),supportImpulse:p.support.slice(),contactEnergy:0}));}
}
