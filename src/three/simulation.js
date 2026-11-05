import {fractureParameters} from './fracture.js';
import {Laboratory,MAX_PARTS} from './laboratory.js';
import { GRAVITY_DEFAULTS,gravityMode,gravityAcceleration,updateGravity } from './gravity-options.js';
import { MATERIALS } from '../materials.js';
import { enthalpyAt,decodeEnthalpy,exchangeHeat } from '../thermal.js';
import { MPM3,solid } from './mpm.js';
import { clamp } from './math.js';
import { MODELS } from './constitutive.js';
import { PLASTICITY_DEFAULTS,plasticityParameters } from './metal-plasticity.js';
import { samplingOptions,jitterPoint } from './sampling.js';
import { THERMAL_DEFAULTS,thermalParameters } from './thermal-plasticity.js';
import { PRESSURE_DEFAULTS,pressureParameters } from './pressure-plasticity.js';
import { PHASE_DEFAULTS,phaseParameters,phaseEnthalpy,decodePhase } from './phase-change.js';
import { regularizeSolids } from './solid-sampling.js';
import { DEFAULT_DOMAIN,domainParameters,geometryParameters,geometryPoints,insideGeometry,transform,untransform } from './discretization.js';
export const CAPACITY3=20000;
const H=8,N=67,O=-264,REST=2.08;
// Repair inherited solid packing at a bounded speed, without making kinetic energy.
const MELT_RELAX_SPEED=8,MELT_SETTLE_TIME=.1,MELT_HANDOFF_SPEED=.25;
export class Simulation3 {
  constructor(){
    this.fractureMaterials=Array(MAX_PARTS).fill(null);this.damage=new Float64Array(CAPACITY3);
    this.phaseMaterials=Array(MAX_PARTS).fill(PHASE_DEFAULTS);this.melted=new Uint8Array(CAPACITY3);
    this.fluidTransition=new Uint8Array(CAPACITY3);this.relaxZone=new Uint8Array(CAPACITY3);
    for(const k of ['fluidStable','fluidBaseline','relaxLambda','relaxX','relaxY','relaxZ'])this[k]=new Float64Array(CAPACITY3);
    this.plasticity=Array(MAX_PARTS).fill(PLASTICITY_DEFAULTS);this.pressureMaterials=Array(MAX_PARTS).fill(PRESSURE_DEFAULTS);this.thermalMaterials=Array(MAX_PARTS).fill(THERMAL_DEFAULTS);
    for(const k of ['x','y','z','vx','vy','vz','ox','oy','oz','dx','dy','dz','gx','gy','gz','den','rho','lambda','mass','volume','invMass','temperature','enthalpy','heat','thermalBudget','ax','ay','az'])this[k]=new Float64Array(CAPACITY3);
    this.material=new Uint8Array(CAPACITY3);this.pinned=new Uint8Array(CAPACITY3);this.model=new Uint8Array(CAPACITY3);
    this.yieldStrain=new Float64Array(CAPACITY3);this.friction=new Float64Array(CAPACITY3);
    this.head=new Int32Array(N**3);this.next=new Int32Array(CAPACITY3);this.cell=new Int32Array(CAPACITY3);
    this.lab=new Laboratory(this,CAPACITY3);this.mpm=new MPM3(CAPACITY3);this.count=0;this.time=0;this.exchangedHeat=0;
    this.domain=domainParameters(DEFAULT_DOMAIN);this.boundsLo=[-63,-47,-63];this.boundsHi=[63,71,63];
    this.settings={timeStepScale:1,pbfIterations:3,pbfAntiClump:true,solidAntiClump:true,...GRAVITY_DEFAULTS,gravity:true,stiffness:1,thermal:true,heatRate:20,ambient:false};this.drag=null;this.pairs=[];
    this.press={enabled:false,y:64,target:64,speed:8,velocity:0,impulse:0,force:0,origin:64};this.history=[];this.profile={};this.heatPairs=[];
  }
  add(x,y,z,mat=11,temp=MATERIALS[mat]?.temp,model=0,yieldStrain=.025,friction=35){
    if(this.count>=CAPACITY3||!MATERIALS[mat]||![x,y,z,temp,yieldStrain,friction].every(Number.isFinite)||!Number.isInteger(model)||model<0||model>=MODELS.length)return false;
    const i=this.count++;this.x[i]=clamp(x,this.boundsLo[0],this.boundsHi[0]);this.y[i]=clamp(y,this.boundsLo[1],this.boundsHi[1]);this.z[i]=clamp(z,this.boundsLo[2],this.boundsHi[2]);
    this.vx[i]=this.vy[i]=this.vz[i]=0;this.material[i]=mat;this.temperature[i]=temp;
    this.damage[i]=0;this.model[i]=mat===11?model:0;this.yieldStrain[i]=clamp(yieldStrain,.005,.08);this.friction[i]=clamp(friction,15,50);
    this.mass[i]=MATERIALS[mat].density/1000;this.invMass[i]=1/this.mass[i];this.volume[i]=1;
    this.enthalpy[i]=enthalpyAt(mat,temp);this.pinned[i]=0;this.melted[i]=0;this.fluidTransition[i]=0;this.fluidStable[i]=0;this.lab.insert(i);this.mpm.resetParticle(i);this.phaseTransition(i);return true;
  }
  isSolid(i){return solid(this.material[i])&&!this.melted[i];}
  configureDomain(value){
    const d=domainParameters(value),lo=d.lower.map(x=>x+d.spacing*.25),hi=d.upper.map(x=>x-d.spacing*.25);
    for(let i=0;i<this.count;i++)if([this.x[i],this.y[i],this.z[i]].some((x,a)=>x<lo[a]||x>hi[a]))throw Error('新计算域无法容纳已有粒子；请扩大范围或在空场景设置');
    if(this.press.enabled&&(this.press.y<lo[1]+2||this.press.y>d.upper[1]))throw Error('当前压板超出新计算域，请先关闭压板');
    this.neighborH=Math.max(H,...d.size.map(x=>x/60));this.neighborOrigin=d.lower.map(x=>x-2*this.neighborH);
    this.domain=d;this.boundsLo=lo;this.boundsHi=hi;this.mpm.configure(d);
    const pressMin=d.lower[1]+Math.min(16,d.size[1]/2);
    this.press.target=clamp(this.press.target,pressMin,d.upper[1]);
    if(!this.press.enabled){this.press.y=clamp(this.press.y,pressMin,d.upper[1]);this.press.origin=this.press.y;}
    return d;
  }
  createGeometry(d){
    const g=geometryParameters(d,this.domain),noise=samplingOptions(d.sampling||{}),material=d.material??11,temp=d.temperature??MATERIALS[material]?.temp,model=d.model??0;
    const fracture=fractureParameters(d.fracture);
    const phase=phaseParameters(d.phaseChange),plasticity=plasticityParameters(d.plasticity),pressure=pressureParameters(d.pressure),thermal=thermalParameters(d.thermalMaterial),velocity=d.velocity??[0,0,0],yieldStrain=d.yieldStrain??.025,friction=d.friction??35;
    if(!noise||!phase||!plasticity||!pressure||!thermal||!MATERIALS[material]||!Number.isInteger(model)||model<0||model>=MODELS.length||![temp,yieldStrain,friction].every(Number.isFinite)||phase.enabled&&material!==11||!Array.isArray(velocity)||velocity.length!==3||!velocity.every(v=>Number.isFinite(v)&&Math.abs(v)<=80)||this.lab.nextId>=MAX_PARTS)throw Error('材料、初始条件或部件容量无效');
    const fixedFace=d.fixedFace??(d.fixed?'minX':'none');
    if(!['none','minX','maxX','minY','maxY','minZ','maxZ'].includes(fixedFace))throw Error('固定面无效');
    const points=geometryPoints(g,CAPACITY3-this.count),local=points.map(p=>untransform(g.R,p.map((v,a)=>v-g.center[a]))),lo=g.size.map(x=>-x*.5),hi=g.size.map(x=>x*.5),start=this.count,volume=g.volume/points.length/64;
    const axis='XYZ'.indexOf(fixedFace.at(-1)),sign=fixedFace.startsWith('max')?-1:1,edge=axis<0?0:Math.min(...local.map(p=>sign*p[axis]));
    const prepared=points.map((original,k)=>{
      const fixed=axis>=0&&sign*local[k][axis]<edge+g.spacing*.5,j=jitterPoint(local[k],k,lo,hi,g.shape==='cad'?'box':g.shape,fixed,noise,g.spacing);
      let p=transform(g.R,j).map((x,a)=>x+g.center[a]);
      if(g.shape==='cad'&&!insideGeometry(g,p))p=original;
      if(p.some((x,a)=>x<this.boundsLo[a]||x>this.boundsHi[a]))p=original;
      if(p.some((x,a)=>x<this.boundsLo[a]||x>this.boundsHi[a]))throw Error('采样点触及边界缓冲区，请将几何稍向计算域内部移动');
      return {p,fixed};
    });
    for(const {p,fixed} of prepared){
      this.add(...p,material,temp,model,yieldStrain,friction);const i=this.count-1;
      this.mass[i]*=volume;this.invMass[i]=1/this.mass[i];this.volume[i]=volume;
      if(fixed)this.pin(i,true);
    }
    const id=this.lab.register(start,d.name);this.plasticity[id]=plasticity;this.pressureMaterials[id]=pressure;this.thermalMaterials[id]=thermal;this.phaseMaterials[id]=phase;this.fractureMaterials[id]=fracture;
    if(material===2)for(let i=start;i<this.count;i++)this.fluidTransition[i]=1;
    this.lab.definitions.set(id,{shape:g.shape,center:g.center,size:g.size,rotation:g.rotation,volume:g.volume,spacing:g.spacing,cellSize:this.domain.cellSize,particlesPerCell:this.domain.particlesPerCell,count:points.length});
    if(material===11&&phase.enabled)for(let i=start;i<this.count;i++){this.enthalpy[i]=phaseEnthalpy(temp,phase);this.phaseTransition(i);}
    if(velocity.some(v=>v!==0))this.lab.command({id,action:'velocity',velocity});return id;
  }
  box(a,b,mat=11,fixed=false,temp=MATERIALS[mat]?.temp,model=0,yieldStrain=.025,friction=35,shape="box",name="",velocity=[0,0,0],plasticity={},sampling={},pressure={},thermalMaterial={},phaseChange={}){
    const phaseParams=phaseParameters(phaseChange);if(!phaseParams||phaseParams.enabled&&mat!==11)return false;
    const noise=samplingOptions(sampling),pressureParams=pressureParameters(pressure);if(!noise||!pressureParams)return false;
    const thermalParams=thermalParameters(thermalMaterial);if(!thermalParams)return false;
    const parameters=plasticityParameters(plasticity);
    if(!parameters||![...a,...b,temp,yieldStrain,friction].every(Number.isFinite)||!MATERIALS[mat]||!Number.isInteger(model)||model<0||model>=MODELS.length)return false;
    const lo=a.map((v,k)=>clamp(Math.min(v,b[k]),k===1?-46:-62,k===1?70:62));
    const hi=a.map((v,k)=>clamp(Math.max(v,b[k]),k===1?-46:-62,k===1?70:62));
    const dims=lo.map((v,k)=>Math.floor((hi[k]-v)/4)+1);
    if(dims.some(n=>n<2)||this.lab.nextId>=MAX_PARTS||!['box','ellipsoid','cylinder'].includes(shape)||!Array.isArray(velocity)||velocity.length!==3||!velocity.every(v=>Number.isFinite(v)&&Math.abs(v)<=80))return false;
    const points=[];
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
      const p=[lo[0]+4*x,lo[1]+4*y,lo[2]+4*z],q=p.map((v,a)=>(v-(lo[a]+hi[a])/2)/((hi[a]-lo[a])/2));
      if(shape==='box'||(shape==='ellipsoid'?q[0]**2+q[1]**2+q[2]**2:q[0]**2+q[2]**2)<=1+1e-7)points.push(p);
    }
    if(!points.length||this.count+points.length>CAPACITY3)return false;
    const start=this.count;
    for(let k=0;k<points.length;k++){
      const pinned=fixed&&points[k][0]===lo[0],p=jitterPoint(points[k],k,lo,hi,shape,pinned,noise);
      this.add(...p,mat,temp,model,yieldStrain,friction);
      if(pinned)this.pin(this.count-1,true);
    }
    const id=this.lab.register(start,name);
    this.plasticity[id]=parameters;this.pressureMaterials[id]=pressureParams;this.thermalMaterials[id]=thermalParams;
    this.phaseMaterials[id]=phaseParams;
    if(mat===11&&phaseParams.enabled)for(let i=start;i<this.count;i++){this.enthalpy[i]=phaseEnthalpy(temp,phaseParams);this.phaseTransition(i);}
    if(velocity.some(v=>v!==0))this.lab.command({id,action:'velocity',velocity});
    return true;
  }
  pin(i,on){this.pinned[i]=on?1:0;this.invMass[i]=on?0:1/this.mass[i];this.ax[i]=this.x[i];this.ay[i]=this.y[i];this.az[i]=this.z[i];if(on)this.vx[i]=this.vy[i]=this.vz[i]=0;}
  remove(i){const last=--this.count;for(const k of ['x','y','z','vx','vy','vz','mass','volume','invMass','temperature','enthalpy','material','pinned','model','yieldStrain','friction','ax','ay','az','melted','fluidTransition','fluidStable','damage'])this[k][i]=this[k][last];this.lab.remove(i,last);this.mpm.remove(i,last);this.drag=null;}
  reset(scene='coupled'){
    this.domain=domainParameters(DEFAULT_DOMAIN);this.boundsLo=[-63,-47,-63];this.boundsHi=[63,71,63];this.mpm.configure(this.domain);
    this.fractureMaterials.fill(null);this.neighborH=H;this.neighborOrigin=[O,O,O];this.phaseMaterials.fill(PHASE_DEFAULTS);
    this.plasticity.fill(PLASTICITY_DEFAULTS);this.pressureMaterials.fill(PRESSURE_DEFAULTS);this.thermalMaterials.fill(THERMAL_DEFAULTS);
    this.scene=scene;this.lab.reset();
    this.count=0;this.time=0;this.exchangedHeat=0;this.drag=null;this.mpm.reset();
    const compression=['compression','metals','porous','thermomech'].includes(scene);
    this.press={enabled:compression,y:compression?12:64,target:compression?12:64,speed:8,velocity:0,impulse:0,force:0,origin:compression?12:64};this.history=[];this.profile={};
    if(scene==='coupled'){
      this.box([-44,24,-12],[-8,36,12],11,true);
      this.box([12,8,4],[32,28,24],11);
      this.box([-44,-42,-36],[44,-34,36],2,false);
    }else if(scene==='thermomech'||scene==='melting'){
      const names=['冷态 J2 · 20°C','热态 J2 · 180°C','冷态蠕变 · 20°C','热态蠕变 · 180°C'];
      for(let k=0;k<4;k++){
        const x=k%2===0?-44:16,z=k<2?-44:16;
        this.box([x,-40,z],[x+24,0,z+24],11,false,k%2?180:20,k<2?10:11,.025,35,'box',names[k],[0,0,0],{},{enabled:true,strength:.2,seed:42+k},{},{},{enabled:scene==='melting'});
      }
    }else if(scene==='porous'){
      const names=['低剪胀岩土','高剪胀岩土','低平台泡沫','高平台泡沫'];
      for(let k=0;k<4;k++){
        const x=k%2===0?-44:16,z=k<2?-44:16,pressure=k<2?{dilatancy:k===0?0:.45}:{plateau:k===2?.008:.04};
        this.box([x,-40,z],[x+24,0,z+24],11,false,20,k<2?8:9,.025,35,'box',names[k],[0,0,0],{},{enabled:true,strength:.2,seed:42+k},pressure);
      }
    }else if(scene==='metals'){
      for(let k=0;k<4;k++){
        const x=k%2===0?-44:16,z=k<2?-44:16;
        this.box([x,-40,z],[x+24,0,z+24],11,false,k>=2?650:20,k+4,.025,35,'box',MODELS[k+4].name);
      }
    }else if(scene==='compression'){
      for(let model=0;model<4;model++){
        const x=model%2===0?-44:16,z=model<2?-44:16;
        this.box([x,-40,z],[x+24,0,z+24],11,false,20,model);
      }
    }else if(scene==='models'||scene==='large'){
      // Four mechanically distinct blocks, separated by an empty grid cell.
      const large=scene==='large';
      for(let model=0;model<4;model++){
        const x=model%2===0?-56:12,z=model<2?-56:12;
        this.box([x,large?-36:4,z],[x+40,large?64:28,z+40],11,false,20,model);
      }
    }else if(scene==='thermal'){
      this.box([-30,-36,-20],[-2,-20,20],2,false,80);
      this.box([2,-36,-20],[30,-20,20],2,false,20);
    }
  }
  buildGrid(){
    this.head.fill(-1);
    for(let i=0;i<this.count;i++){
      const q=[this.x[i],this.y[i],this.z[i]].map((v,a)=>clamp(Math.floor((v-(this.neighborOrigin?.[a]??O))/(this.neighborH??H)),1,N-2));
      const c=(q[2]*N+q[1])*N+q[0];this.cell[i]=c;this.next[i]=this.head[c];this.head[c]=i;
    }
  }
  near(i,fn){
    const cell=this.cell[i];
    for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(let j=this.head[cell+z*N*N+y*N+x];j>=0;j=this.next[j]){
      if(j===i)continue;const dx=this.x[i]-this.x[j],dy=this.y[i]-this.y[j],dz=this.z[i]-this.z[j],r=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(r>1e-6&&r<H)fn(j,dx,dy,dz,r,1-r/H);
    }
  }
  fluidBaselines(){
    this.relaxZone.fill(0,0,this.count);
    const active=this.fluidTransition.subarray(0,this.count).some(Boolean);
    if(!active)return false;
    // Sample BEFORE advection: only inherited compression is position-only.
    // New compression from velocity/gravity must still produce a pressure impulse.
    this.buildGrid();
    for(let i=0;i<this.count;i++)if(!this.isSolid(i)&&this.material[i]!==3){
      let rho=this.volume[i],zone=this.fluidTransition[i];
      this.near(i,(j,x,y,z,r,q)=>{if(this.material[j]!==3&&this.particlePairAllowed?.(i,j)!==false){rho+=this.volume[j]*q*q*q;zone|=this.fluidTransition[j];}});
      this.fluidBaseline[i]=Math.max(REST,rho);this.relaxZone[i]=zone;
    }
    return true;
  }
  density(dt=1/120){
    const pressureRecords=[];
    const pressureScale=(dt*120)**2*3/this.settings.pbfIterations;
    this.lambda.fill(0,0,this.count);
    for(const key of ['gx','gy','gz','den','dx','dy','dz','relaxLambda','relaxX','relaxY','relaxZ'])this[key].fill(0,0,this.count);
    this.rho.set(this.volume.subarray(0,this.count));
    for(let p=0;p<this.pairs.length;p+=2){
      const i=this.pairs[p],j=this.pairs[p+1];if(this.material[i]===3||this.material[j]===3)continue;
      const x=this.x[i]-this.x[j],y=this.y[i]-this.y[j],z=this.z[i]-this.z[j],r2=x*x+y*y+z*z;
      if(r2>=H*H||r2<1e-12)continue;const r=Math.sqrt(r2),q=1-r/H,g=-3*q*q/H/REST/r;
      const gi=g*this.volume[j],gj=g*this.volume[i];
      this.rho[i]+=this.volume[j]*q*q*q;this.rho[j]+=this.volume[i]*q*q*q;
      this.gx[i]+=gi*x;this.gy[i]+=gi*y;this.gz[i]+=gi*z;this.gx[j]-=gj*x;this.gy[j]-=gj*y;this.gz[j]-=gj*z;
      this.den[i]+=this.invMass[j]*gi*gi*r2;this.den[j]+=this.invMass[i]*gj*gj*r2;
    }
    for(let i=0;i<this.count;i++)if(!this.isSolid(i)&&this.material[i]!==3){
      const denominator=this.den[i]+this.invMass[i]*(this.gx[i]**2+this.gy[i]**2+this.gz[i]**2)+.025;
      const full=-Math.max(0,this.rho[i]/REST-1)/denominator;
      this.lambda[i]=this.relaxZone[i]?-Math.max(0,(this.rho[i]-this.fluidBaseline[i])/REST)/denominator:full;
      this.relaxLambda[i]=full-this.lambda[i];
    }
    for(let p=0;p<this.pairs.length;p+=2){
      const i=this.pairs[p],j=this.pairs[p+1],x=this.x[i]-this.x[j],y=this.y[i]-this.y[j],z=this.z[i]-this.z[j],r2=x*x+y*y+z*z;
      if(r2>=H*H||r2<1e-12)continue;const r=Math.sqrt(r2),q=1-r/H;
      // PBF artificial pressure (Macklin & Müller): repel close fluid samples,
      // including free-surface pairs whose compression-only lambda is zero.
      const scorr=this.settings.pbfAntiClump&&!this.isSolid(i)&&!this.isSolid(j)&&this.material[i]!==3&&this.material[j]!==3?-.05*pressureScale*(q/.7)**12:0;
      const relaxing=this.relaxZone[i]||this.relaxZone[j],g=-3*q*q/H/REST/r,pressure=scorr*(this.volume[i]+this.volume[j])*.5;
      const a=(this.lambda[i]*this.volume[j]+this.lambda[j]*this.volume[i]+(relaxing?0:pressure))*g,wi=this.invMass[i]*a,wj=this.invMass[j]*a;
      this.dx[i]+=x*wi;this.dy[i]+=y*wi;this.dz[i]+=z*wi;this.dx[j]-=x*wj;this.dy[j]-=y*wj;this.dz[j]-=z*wj;
      if(this.particlePairExplicit?.(i,j)&&a!==0)pressureRecords.push([i,j,x*a,y*a,z*a]);
      const b=(this.relaxLambda[i]*this.volume[j]+this.relaxLambda[j]*this.volume[i]+(relaxing?pressure:0))*g,ri=this.invMass[i]*b,rj=this.invMass[j]*b;
      this.relaxX[i]+=x*ri;this.relaxY[i]+=y*ri;this.relaxZ[i]+=z*ri;this.relaxX[j]-=x*rj;this.relaxY[j]-=y*rj;this.relaxZ[j]-=z*rj;
    }
    let max=1,relaxMax=1,dot=0,norm=0;const budget=MELT_RELAX_SPEED*dt/this.settings.pbfIterations;
    for(let i=0;i<this.count;i++){
      max=Math.max(max,Math.hypot(this.dx[i],this.dy[i],this.dz[i]));
      relaxMax=Math.max(relaxMax,Math.hypot(this.relaxX[i],this.relaxY[i],this.relaxZ[i])/budget);
      if(this.transitioning||this.energySafePressure){
        dot+=this.mass[i]*((this.x[i]-this.ox[i])*this.dx[i]+(this.y[i]-this.oy[i])*this.dy[i]+(this.z[i]-this.oz[i])*this.dz[i]);
        norm+=this.mass[i]*(this.dx[i]**2+this.dy[i]**2+this.dz[i]**2);
      }
    }
    // Dense inherited neighborhoods can overshoot a Jacobi pressure projection.
    // Handoff and rigid coupling use a common energy-decreasing line search.
    // Rigid contact can also compress neighborhoods abruptly. A shared scale
    // preserves pair momentum while preventing numerical pressure explosions.
    const scale=(this.transitioning||this.energySafePressure)&&norm>1e-20?Math.min(1/max,Math.max(0,-dot/norm)):1/max;
    // Keep density projection at full strength. The excess over the admissible
    // velocity impulse is position-only stabilization, as with contact cleanup.
    const positionScale=this.energySafePressure&&!this.transitioning?1/max:scale;
    for(const [i,j,x,y,z] of pressureRecords)this.recordPressurePair(i,j,[x,y,z].map(v=>v*scale*.025/dt));
    const bounds=[['x','ox','relaxX',this.boundsLo[0],this.boundsHi[0]],['y','oy','relaxY',this.boundsLo[1],this.press.enabled?Math.min(this.boundsHi[1],this.press.y-1.8):this.boundsHi[1]],['z','oz','relaxZ',this.boundsLo[2],this.boundsHi[2]]];
    for(let i=0;i<this.count;i++){
      this.x[i]+=this.dx[i]*positionScale;this.y[i]+=this.dy[i]*positionScale;this.z[i]+=this.dz[i]*positionScale;
      this.ox[i]+=this.dx[i]*(positionScale-scale);this.oy[i]+=this.dy[i]*(positionScale-scale);this.oz[i]+=this.dz[i]*(positionScale-scale);
      if(this.pinned[i])continue;
      for(const [pos,old,delta,lo,hi] of bounds){
        // Exclude only the actual relaxation displacement, including at walls.
        const shift=clamp(this[pos][i]+this[delta][i]/relaxMax,lo,hi)-clamp(this[pos][i],lo,hi);
        this[pos][i]+=shift;this[old][i]+=shift;
      }
    }
  }
  finishFluidTransition(dt){
    for(let i=0;i<this.count;i++)if(this.fluidTransition[i]){
      const settled=this.fluidBaseline[i]<=REST*1.001&&Math.hypot(this.relaxX[i],this.relaxY[i],this.relaxZ[i])<=MELT_HANDOFF_SPEED*dt/this.settings.pbfIterations;
      this.fluidStable[i]=settled?this.fluidStable[i]+dt:0;
      if(this.fluidStable[i]>=MELT_SETTLE_TIME)this.fluidTransition[i]=0;
    }
  }
  phaseTransition(i){
    if(this.material[i]===11){
      const p=this.phaseMaterials[this.lab.part[i]],phase=decodePhase(this.enthalpy[i],this.melted[i],p);
      this.temperature[i]=phase.temperature;
      if(phase.liquid!==!!this.melted[i]){
        this.melted[i]=Number(phase.liquid);this.mpm.resetParticle(i);
        this.fluidTransition[i]=Number(phase.liquid);this.fluidStable[i]=0;
        if(phase.liquid)this.pin(i,false);
      }
      this.volume[i]=clamp(this.mass[i]*1000/(MATERIALS[11].density*(this.projectDensityRatios?.[this.lab.part[i]]??1)),.000001,8);return;
    }
    const old=this.material[i],[mat,temp]=decodeEnthalpy(old,this.enthalpy[i]);this.material[i]=mat;this.temperature[i]=temp;
    this.volume[i]=mat===3?this.volume[i]:clamp(this.mass[i]*1000/(MATERIALS[mat].density*(this.projectDensityRatios?.[this.lab.part[i]]??1)),.000001,8);
    if(mat!==old){
      this.mpm.resetParticle(i);this.model[i]=0;if(!solid(mat))this.pin(i,false);
      this.fluidTransition[i]=Number(solid(old)&&!solid(mat)&&mat!==3);this.fluidStable[i]=0;
    }
  }
  brush(tool,point,radius=10,dt=1/30){
    for(let i=this.count-1;i>=0;i--)if(Math.hypot(this.x[i]-point[0],this.y[i]-point[1],this.z[i]-point[2])<radius){
      if(tool==='erase'){this.remove(i);continue;}
      if(tool==='anchor'||tool==='release'){this.pin(i,tool==='anchor');continue;}
      if(tool==='heat'||tool==='cool'){
        const mat=this.material[i],cold=[2,3,4].includes(mat)?4:mat===1?0:mat===10?5:mat;
        this.enthalpy[i]=Math.max(enthalpyAt(cold,-273.15),this.enthalpy[i]+(tool==='heat'?1:-1)*500000*dt/this.mass[i]);this.phaseTransition(i);
      }
    }
  }
  beginDrag(point,radius=10){
    const ids=[];for(let i=0;i<this.count;i++)if(!this.pinned[i]&&Math.hypot(this.x[i]-point[0],this.y[i]-point[1],this.z[i]-point[2])<radius)ids.push([i,this.x[i]-point[0],this.y[i]-point[1],this.z[i]-point[2]]);
    this.drag={ids,point};
  }
  setPress(value){
    if(typeof value.enabled==='boolean')this.press.enabled=value.enabled;
    if(Number.isFinite(value.target))this.press.target=clamp(value.target,this.domain.lower[1]+Math.min(16,this.domain.size[1]/2),this.domain.upper[1]);
    if(Number.isFinite(value.speed))this.press.speed=clamp(value.speed,1,20);
    if(value.hold)this.press.target=this.press.y;
    if(!this.press.enabled)this.press.velocity=this.press.force=0;
  }
  advancePress(dt){
    const p=this.press;if(!p.enabled){p.velocity=0;return;}
    // Do not sweep the plate through an anchored particle.
    let target=p.target;for(let i=0;i<this.count;i++)if(this.pinned[i])target=Math.max(target,this.y[i]+2);
    p.velocity=clamp((target-p.y)/dt,-p.speed,p.speed);p.y+=p.velocity*dt;
  }
  step(dt=1/60){
    const started=performance.now();this.profile={constitutive:0,transfer:0,grid:0,fluid:0,thermal:0,diagnostics:0,other:0,total:0};this.press.impulse=0;
    this.exchangedHeat=0;let remaining=dt,steps=0;const hasSolid=this.material.subarray(0,this.count).some((_,i)=>this.isSolid(i));
    while(remaining>1e-9&&steps<48){
      const h=Math.min(remaining,(hasSolid?this.mpm.stableStep(this):1/120)*this.settings.timeStepScale);this.substep(h,hasSolid);remaining-=h;steps++;
    }
    const advanced=dt-remaining;this.time+=advanced;this.substeps=steps;
    this.press.force=advanced?this.press.impulse/advanced:0;
    if(this.press.enabled){this.history.push([this.press.origin-this.press.y,this.press.force]);if(this.history.length>300)this.history.shift();}
    let section=performance.now();
    let min=Infinity,max=-Infinity;
    for(let i=0;i<this.count;i++){min=Math.min(min,this.temperature[i]);max=Math.max(max,this.temperature[i]);}
    if(this.settings.thermal&&(max-min>1e-9||this.settings.ambient)){
      this.buildGrid();const pairs=this.heatPairs;pairs.length=0;for(let i=0;i<this.count;i++)this.near(i,(j,x,y,z,r,q)=>{if(j>i)pairs.push(i,j,q);});
      exchangeHeat(this,pairs,advanced);
    }
    this.profile.thermal=performance.now()-section;section=performance.now();
    this.mpm.refreshDiagnostics(this);this.profile.diagnostics=performance.now()-section;
    this.profile.total=performance.now()-started;
    this.profile.other=Math.max(0,this.profile.total-this.profile.constitutive-this.profile.transfer-this.profile.grid-this.profile.fluid-this.profile.thermal-this.profile.diagnostics);
  }
  setSettings(value){
    for(const key of ['gravity','thermal','ambient','pbfAntiClump','solidAntiClump'])if(typeof value[key]==='boolean')this.settings[key]=value[key];
    for(const [key,lo,hi] of [['stiffness',.25,4],['heatRate',1,100],['timeStepScale',.1,1]])if(Number.isFinite(value[key]))this.settings[key]=clamp(value[key],lo,hi);
    if(Number.isInteger(value.pbfIterations))this.settings.pbfIterations=clamp(value.pbfIterations,1,8);
    updateGravity(this.settings,value);
  }
  substep(dt,hasSolid){
    const gravity=gravityMode(this.settings,this.scene);
    const transitioning=this.fluidBaselines();
    this.transitioning=transitioning;
    this.advancePress(dt);
    for(let i=0;i<this.count;i++){
      this.ox[i]=this.x[i];this.oy[i]=this.y[i];this.oz[i]=this.z[i];
      if(this.pinned[i])continue;
      if(gravity!=='none'){
        const a=gravityAcceleration(this.settings,gravity,this.x[i],this.y[i],this.z[i],this.material[i]===3);
        this.vx[i]+=a[0]*dt;this.vy[i]+=a[1]*dt;this.vz[i]+=a[2]*dt;
      }
    }
    if(this.drag)for(const [i,x,y,z] of this.drag.ids)if(i<this.count&&!this.pinned[i]){
      for(const [a,key,vkey] of [[0,'x','vx'],[1,'y','vy'],[2,'z','vz']])this[vkey][i]+=clamp(90*(this.drag.point[a]+[x,y,z][a]-this[key][i])-12*this[vkey][i],-900,900)*dt;
    }
    for(let i=0;i<this.count;i++)if(!this.isSolid(i)&&!this.pinned[i]){this.x[i]+=this.vx[i]*dt;this.y[i]+=this.vy[i]*dt;this.z[i]+=this.vz[i]*dt;}
    if(hasSolid)this.mpm.step(this,dt);
    const energyBeforePost=this.energyObserver?.mark();
    const fluidStarted=performance.now();
    const hasFluid=this.material.subarray(0,this.count).some((_,i)=>!this.isSolid(i));
    this.pairs.length=0;
    if(hasFluid){
      this.buildGrid();
      for(let i=0;i<this.count;i++)this.near(i,j=>{if(j>i&&(!this.isSolid(i)||!this.isSolid(j))&&this.particlePairAllowed?.(i,j)!==false)this.pairs.push(i,j);});
    }
    for(let iter=0;iter<(hasFluid?this.settings.pbfIterations:1);iter++){
      if(hasFluid)this.density(dt);
      for(let i=0;i<this.count;i++){
        this.x[i]=this.pinned[i]?this.ax[i]:clamp(this.x[i],this.boundsLo[0],this.boundsHi[0]);
        this.y[i]=this.pinned[i]?this.ay[i]:clamp(this.y[i],this.boundsLo[1],this.boundsHi[1]);
        this.z[i]=this.pinned[i]?this.az[i]:clamp(this.z[i],this.boundsLo[2],this.boundsHi[2]);
      }
    }
    if(transitioning)this.finishFluidTransition(dt);
    for(let i=0;i<this.count;i++){
      this.vx[i]=clamp((this.x[i]-this.ox[i])/dt,-160,160);this.vy[i]=clamp((this.y[i]-this.oy[i])/dt,-160,160);this.vz[i]=clamp((this.z[i]-this.oz[i])/dt,-160,160);
    }
    this.dx.fill(0,0,this.count);this.dy.fill(0,0,this.count);this.dz.fill(0,0,this.count);
    for(let p=0;p<this.pairs.length;p+=2){
      const i=this.pairs[p],j=this.pairs[p+1];if(this.isSolid(i)&&this.isSolid(j)||this.particlePairExplicit?.(i,j))continue;
      const total=this.invMass[i]+this.invMass[j];if(!total)continue;
      const x=this.x[i]-this.x[j],y=this.y[i]-this.y[j],z=this.z[i]-this.z[j],r=Math.sqrt(x*x+y*y+z*z),q=Math.max(0,1-r/H);
      const w=q*q*.015;
      for(const [v,d] of [['vx','dx'],['vy','dy'],['vz','dz']]){const impulse=(this[v][j]-this[v][i])*w;this[d][i]+=impulse*this.invMass[i]/total;this[d][j]-=impulse*this.invMass[j]/total;}
    }
    for(let i=0;i<this.count;i++){this.vx[i]+=this.dx[i];this.vy[i]+=this.dy[i];this.vz[i]+=this.dz[i];}
    if(this.press.enabled)for(let i=0;i<this.count;i++)if(!this.pinned[i]&&this.y[i]>this.press.y-1.8){
      this.y[i]=this.press.y-1.8;
      const before=this.vy[i];this.vy[i]=Math.min(before,this.press.velocity);this.press.impulse+=this.mass[i]*(before-this.vy[i]);
    }
    if(this.profile.fluid!==undefined)this.profile.fluid+=performance.now()-fluidStarted;
    this.energyObserver?.record('postprocess',energyBeforePost);
    const energyBeforeSampling=this.energyObserver?.mark();
    if(hasSolid){const samplingStarted=performance.now();regularizeSolids(this,dt,N);if(this.profile.grid!==undefined)this.profile.grid+=performance.now()-samplingStarted;}
    this.energyObserver?.record('regularization',energyBeforeSampling);
  }
  snapshot(buffer){
    const data=buffer&&buffer.byteLength>=this.count*8*4?new Float32Array(buffer,0,this.count*8):new Float32Array(this.count*8);let mass=0,energy=0,solids=0,liquids=0,maxStress=0,maxPlastic=0;const models=Array(MODELS.length).fill(0);
    let min=Infinity,max=-Infinity;
    for(let i=0;i<this.count;i++){
      const k=i*8;data[k]=this.x[i];data[k+1]=this.y[i];data[k+2]=this.z[i];data[k+3]=this.melted[i]?23:this.material[i]===11?11+this.model[i]:this.material[i];data[k+4]=this.temperature[i];data[k+5]=this.pinned[i];data[k+6]=this.mpm.stress[i];data[k+7]=this.mpm.plastic[i];
      maxStress=Math.max(maxStress,this.mpm.stress[i]);maxPlastic=Math.max(maxPlastic,this.mpm.plastic[i]);
      if(this.isSolid(i))models[this.model[i]]++;
      mass+=this.mass[i];energy+=this.mass[i]*this.enthalpy[i];if(this.isSolid(i))solids++;else liquids++;
      min=Math.min(min,this.temperature[i]);max=Math.max(max,this.temperature[i]);
    }
    return {domain:this.domain,parts:this.lab.snapshot(),gravityMode:gravityMode(this.settings,this.scene),gravityStrength:this.settings.gravityStrength,data,count:this.count,capacity:CAPACITY3,models,time:this.time,mass,energy,solids,liquids,min:this.count?min:0,max:this.count?max:0,heat:this.exchangedHeat,substeps:this.substeps||0,minJ:this.mpm.minJ(this),profile:this.profile,maxStress,maxPlastic,press:{...this.press},history:this.history};
  }
}
