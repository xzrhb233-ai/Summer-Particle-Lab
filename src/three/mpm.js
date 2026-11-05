import {updateDamage} from './fracture.js';
import { identity,det,clamp } from './math.js';
import { constitutiveStress,projectPlastic,hardening,principalStress,vonMises } from './constitutive.js';
import { MATERIALS } from '../materials.js';
import { DEFAULT_DOMAIN,domainParameters } from './discretization.js';
export const solid=m=>MATERIALS[m].solid;
export class MPM3 {
  constructor(capacity){
    this.F=new Float64Array(capacity*9);this.C=new Float64Array(capacity*9);
    this.Jp=new Float64Array(capacity);this.dilation=new Float64Array(capacity);
    this.stress=new Float64Array(capacity);this.plastic=new Float64Array(capacity);
    this.tau=new Float64Array(capacity*9);this.cachedTau=new Float64Array(capacity*9);this.cacheValid=new Uint8Array(capacity);
    this.base=new Int32Array(capacity*3);this.fraction=new Float64Array(capacity*3);this.weights=new Float64Array(capacity*9);
    this.scratchA=new Float64Array(9);this.scratchC=new Float64Array(9);this.scratchF=new Float64Array(9);
    this.configure(domainParameters(DEFAULT_DOMAIN));
    this.reset();
  }
  configure(domain){this.domain=domain;this.H=domain.cellSize;this.O=domain.origin;this.N=Math.max(...domain.nodes);this.mass=new Float64Array(this.N**3);this.v=new Float64Array(this.N**3*3);this.fixed=new Uint8Array(this.N**3);this.fields=null;}
  reset(){this.C.fill(0);this.F.fill(0);for(let p=0;p<this.F.length/9;p++)this.resetParticle(p);}
  resetParticle(p){this.F.set(identity(),p*9);this.C.fill(0,p*9,p*9+9);this.Jp[p]=1;this.dilation[p]=0;this.stress[p]=0;this.plastic[p]=0;this.cacheValid[p]=0;}
  remove(p,last){
    for(const key of ['F','C','cachedTau'])this[key].copyWithin(p*9,last*9,last*9+9);
    for(const key of ['Jp','dilation','stress','plastic','cacheValid'])this[key][p]=this[key][last];
  }
  stencil(s,p){
    const H=this.H,N=this.N,O=this.O;
    for(let a=0;a<3;a++){
      const value=a===0?s.x[p]:a===1?s.y[p]:s.z[p],q=(value-O[a])/H,b=clamp(Math.floor(q-.5),0,N-3),t=q-b,k=p*9+a*3;
      this.base[p*3+a]=b;this.fraction[p*3+a]=t;
      this.weights[k]=.5*(1.5-t)**2;this.weights[k+1]=.75-(t-1)**2;this.weights[k+2]=.5*(t-.5)**2;
    }
  }
  updateStress(s,p){
    const F=this.F.subarray(p*9,p*9+9),E=s.mass[p]/(64*s.volume[p])*16000*s.settings.stiffness,model=s.model[p];
    const h=model===2?hardening(this.Jp[p]):1;
    const tau=this.cacheValid[p]&&model>=2?this.cachedTau.subarray(p*9,p*9+9):constitutiveStress(F,model,1,1);
    for(let k=0;k<9;k++)this.tau[p*9+k]=tau[k]*.4*E*h*(s.damage?.[p]<1?1-s.damage[p]:1);
    this.stress[p]=vonMises(tau,det(F)*(model>=8&&model<10?this.Jp[p]:1))*.4*h; // Cauchy von Mises / base Young's modulus.
  }
  refreshDiagnostics(s){
    for(let p=0;p<s.count;p++){if(s.isSolid(p))this.updateStress(s,p);else this.stress[p]=this.plastic[p]=0;}
  }
  stableStep(s){
    let max=1,grad=1;
    for(let p=0;p<s.count;p++)if(s.isSolid(p)){
      let row=0,col=0,g=0;for(let a=0;a<3;a++){
        let r=0,c=0;for(let b=0;b<3;b++){r+=Math.abs(this.F[p*9+a*3+b]);c+=Math.abs(this.F[p*9+b*3+a]);g+=Math.abs(this.C[p*9+a*3+b]);}
        row=Math.max(row,r);col=Math.max(col,c);
      }
      const hard=s.model[p]===2?hardening(this.Jp[p]):1;
      const compression=(s.model[p]===1||(s.model[p]>=8&&s.model[p]<10))?1/Math.max(.05,det(this.F.subarray(p*9,p*9+9))*((s.model[p]>=8&&s.model[p]<10)?this.Jp[p]:1)):1;
      max=Math.max(max,Math.hypot(s.vx[p],s.vy[p],s.vz[p])+Math.sqrt(19200*s.settings.stiffness*hard)*Math.max(1,row*col,compression));grad=Math.max(grad,g);
    }
    return Math.min(this.H/8/240,1.4*this.H/8/max,.08/grad);
  }
  step(s,dt){
    const H=this.H,N=this.N,O=this.O;
    if(s.separatePartGrids&&!this.fields)this.fields=Array.from({length:s.projectPartCount+1},()=>({mass:new Float64Array(N**3),v:new Float64Array(N**3*3),fixed:new Uint8Array(N**3)}));
    const observer=s.energyObserver;observer?.begin(this);
    let started=performance.now();
    for(let p=0;p<s.count;p++)if(s.isSolid(p))this.updateStress(s,p);
    if(s.profile)s.profile.constitutive+=performance.now()-started;
    started=performance.now();
    this.mass.fill(0);this.v.fill(0);this.fixed.fill(0);
    if(this.fields)for(const f of this.fields){f.mass.fill(0);f.v.fill(0);f.fixed.fill(0);}
    for(let p=0;p<s.count;p++){
      if(!s.isSolid(p))continue;
      this.stencil(s,p);const b=p*3,t=p*9,m=s.mass[p],V=64*s.volume[p],A=this.scratchA;
      const field=this.fields?.[s.lab.part[p]]??this;
      const bx=this.base[b],by=this.base[b+1],bz=this.base[b+2],fx=this.fraction[b],fy=this.fraction[b+1],fz=this.fraction[b+2],w=this.weights;
      for(let k=0;k<9;k++)A[k]=m*this.C[t+k]-dt*V*4/(H*H)*this.tau[t+k];
      for(let k=0;k<3;k++)for(let j=0;j<3;j++)for(let i=0;i<3;i++){
        const n=((bz+k)*N+by+j)*N+bx+i,weight=w[t+i]*w[t+3+j]*w[t+6+k],x=(i-fx)*H,y=(j-fy)*H,z=(k-fz)*H;
        field.mass[n]+=weight*m;
        field.v[n*3]+=weight*(m*s.vx[p]+A[0]*x+A[1]*y+A[2]*z);
        field.v[n*3+1]+=weight*(m*s.vy[p]+A[3]*x+A[4]*y+A[5]*z);
        field.v[n*3+2]+=weight*(m*s.vz[p]+A[6]*x+A[7]*y+A[8]*z);
        if(observer){const q=field.energyMomentum,C=this.C;
          q[n*3]+=weight*m*(s.vx[p]+C[t]*x+C[t+1]*y+C[t+2]*z);
          q[n*3+1]+=weight*m*(s.vy[p]+C[t+3]*x+C[t+4]*y+C[t+5]*z);
          q[n*3+2]+=weight*m*(s.vz[p]+C[t+6]*x+C[t+7]*y+C[t+8]*z);
        }
        if(s.pinned[p]&&weight>1e-8)field.fixed[n]=1;
      }
    }
    if(s.profile)s.profile.transfer+=performance.now()-started;
    started=performance.now();
    observer?.p2g(this);
    for(const field of this.fields??[this])for(let n=0;n<field.mass.length;n++)if(field.mass[n]>1e-12){
      const q=[O[0]+(n%N)*H,O[1]+(Math.floor(n/N)%N)*H,O[2]+Math.floor(n/(N*N))*H];
      for(let a=0;a<3;a++){
        let v=field.v[n*3+a]/field.mass[n];const lo=this.domain.lower[a],hi=this.domain.upper[a];
        if(field.fixed[n]||(q[a]<lo+H&&v<0)||(q[a]>hi-H&&v>0))v=0;
        if(s.mechanicalDiagnostics){const before=field.v[n*3+a]/field.mass[n];s.mechanicalDiagnostics.ledger.boundaryWork+=.5*field.mass[n]*(v*v-before*before)*.025**2;}
        field.v[n*3+a]=v;
      }
      // A full-width horizontal platen is a unilateral moving boundary.
      if(s.press?.enabled&&q[1]>=s.press.y-H*.5&&!field.fixed[n]){
        const before=field.v[n*3+1],after=Math.min(before,s.press.velocity);
        field.v[n*3+1]=after;s.press.impulse+=(before-after)*field.mass[n];
      }
    }
    // Optional two-way rigid-body contact, before G2P so APIC C and F see it.
    s.externalGridContact?.(this,dt);observer?.grid(this);
    if(s.profile)s.profile.grid+=performance.now()-started;
    started=performance.now();
    for(let p=0;p<s.count;p++){
      if(!s.isSolid(p)||s.pinned[p])continue;
      const b=p*3,t=p*9,bx=this.base[b],by=this.base[b+1],bz=this.base[b+2],fx=this.fraction[b],fy=this.fraction[b+1],fz=this.fraction[b+2],w=this.weights;
      const field=this.fields?.[s.lab.part[p]]??this;
      let vx=0,vy=0,vz=0;const C=this.scratchC;C.fill(0);
      for(let k=0;k<3;k++)for(let j=0;j<3;j++)for(let i=0;i<3;i++){
        const n=((bz+k)*N+by+j)*N+bx+i,weight=w[t+i]*w[t+3+j]*w[t+6+k],dx=(i-fx)*4/H,dy=(j-fy)*4/H,dz=(k-fz)*4/H;
        const delta=s.contactGridDeltas?.[s.lab.part[p]];
        const x=weight*(field.v[n*3]+(delta?.[n*3]??0)),y=weight*(field.v[n*3+1]+(delta?.[n*3+1]??0)),z=weight*(field.v[n*3+2]+(delta?.[n*3+2]??0));vx+=x;vy+=y;vz+=z;
        C[0]+=x*dx;C[1]+=x*dy;C[2]+=x*dz;C[3]+=y*dx;C[4]+=y*dy;C[5]+=y*dz;C[6]+=z*dx;C[7]+=z*dy;C[8]+=z*dz;
      }
      const F=this.scratchF;F.set(this.F.subarray(t,t+9));
      for(let a=0;a<3;a++)for(let b=0;b<3;b++){
        let value=F[a*3+b];for(let k=0;k<3;k++)value+=dt*C[a*3+k]*F[k*3+b];this.F[p*9+a*3+b]=value;
      }
      updateDamage(s,p);this.C.set(C,t);s.vx[p]=vx;s.vy[p]=vy;s.vz[p]=vz;s.x[p]+=dt*vx;s.y[p]+=dt*vy;s.z[p]+=dt*vz;
    }
    if(s.profile)s.profile.transfer+=performance.now()-started;
    started=performance.now();
    for(let p=0;p<s.count;p++)if(s.isSolid(p)&&!s.pinned[p]&&s.model[p]>=2){
        const result=projectPlastic(this.F.subarray(p*9,p*9+9),s.model[p],this.Jp[p],this.dilation[p],s.yieldStrain[p],s.friction[p],this.plastic[p],dt,s.temperature[p],s.plasticity[s.lab.part[p]],s.pressureMaterials[s.lab.part[p]],s.thermalMaterials[s.lab.part[p]]);
        this.F.set(result.F,p*9);this.Jp[p]=result.jp;this.dilation[p]=result.dilation;
        this.plastic[p]+=result.plasticIncrement;
        this.cachedTau.set(principalStress(result.decomposition,s.model[p]),p*9);this.cacheValid[p]=1;
    }
    observer?.g2p();
    if(s.profile)s.profile.constitutive+=performance.now()-started;
  }
  minJ(s){let value=1;for(let i=0;i<s.count;i++)if(s.isSolid(i))value=Math.min(value,det(this.F.subarray(i*9,i*9+9)));return value;}
}
