// Quadratic MLS-MPM / APIC for elastic solids only. Liquids never enter this grid.
// Fixed-corotated hyperelasticity: Hu et al., SIGGRAPH 2018.
import { MATERIALS } from './materials.js';
const DX=8,ORIGIN=-592,N=149,AREA=12.96;
const fields=['f00','f01','f10','f11','c00','c01','c10','c11'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const isMPMSolid=mat=>!!MATERIALS[mat].mpm;

// Kirchhoff stress P F^T. A rigid rotation has zero stress, but shear restores.
export function solidStress(a,b,c,d,mu,lambda) {
  const J=a*d-b*c,q=Math.hypot(a+d,c-b);
  const r=q>1e-12?(a+d)/q:1,t=q>1e-12?(c-b)/q:0;
  const volume=lambda*(J-1)*J;
  return [2*mu*((a-r)*a+(b+t)*b)+volume,
    2*mu*((a-r)*c+(b+t)*d),
    2*mu*((c-t)*a+(d-r)*b),
    2*mu*((c-t)*c+(d-r)*d)+volume];
}

export class SolidMPM {
  constructor(capacity) {
    for(const k of fields)this[k]=new Float64Array(capacity);
    for(const k of ['mass','ux','uy','fixed'])this[k]=new Float64Array(N*N);
    this.wx=new Float64Array(3);this.wy=new Float64Array(3);this.reset();
  }
  resetParticle(i){for(const k of fields)this[k][i]=0;this.f00[i]=this.f11[i]=1;}
  removeParticle(i,last){for(const k of fields)this[k][i]=this[k][last];}
  reset(){for(const k of fields)this[k].fill(k==='f00'||k==='f11'?1:0);this.substeps=this.activeNodes=0;}
  hasParticles(s){for(let i=0;i<s.count;i++)if(isMPMSolid(s.material[i]))return true;return false;}
  stencil(x,y){
    const px=(x-ORIGIN)/DX,py=(y-ORIGIN)/DX;
    this.bx=clamp(Math.floor(px-.5),0,N-3);this.by=clamp(Math.floor(py-.5),0,N-3);
    this.fx=px-this.bx;this.fy=py-this.by;
    const set=(f,w)=>{w[0]=.5*(1.5-f)**2;w[1]=.75-(f-1)**2;w[2]=.5*(f-.5)**2;};
    set(this.fx,this.wx);set(this.fy,this.wy);
  }
  stableStep(s){
    let wave=1,gradient=0;
    const sound=Math.sqrt(19200*(s.settings.solidStiffness??1));
    for(let p=0;p<s.count;p++)if(isMPMSolid(s.material[p])){
      const stretch=Math.max(1,Math.hypot(this.f00[p],this.f01[p],this.f10[p],this.f11[p]));
      wave=Math.max(wave,Math.hypot(s.vx[p],s.vy[p])+sound*stretch*stretch);
      gradient=Math.max(gradient,Math.abs(this.c00[p])+Math.abs(this.c01[p])+Math.abs(this.c10[p])+Math.abs(this.c11[p]));
    }
    return Math.min(1/240,.18*DX/wave,.1/Math.max(1,gradient));
  }
  step(s,dt){
    const {mass,ux,uy,fixed,wx,wy}=this;
    mass.fill(0);ux.fill(0);uy.fill(0);fixed.fill(0);
    for(let p=0;p<s.count;p++){
      if(!isMPMSolid(s.material[p]))continue;
      this.stencil(s.x[p],s.y[p]);
      const m=s.mass[p],V0=AREA*s.volume[p],rho=m/V0,E=rho*16000*(s.settings.solidStiffness??1);
      // nu=.25 -> mu=.4 E, lambda=.4 E (plane strain).
      const tau=solidStress(this.f00[p],this.f01[p],this.f10[p],this.f11[p],.4*E,.4*E);
      const factor=-dt*V0*4/(DX*DX);
      const a00=m*this.c00[p]+factor*tau[0],a01=m*this.c01[p]+factor*tau[1];
      const a10=m*this.c10[p]+factor*tau[2],a11=m*this.c11[p]+factor*tau[3];
      for(let j=0;j<3;j++)for(let i=0;i<3;i++){
        const n=(this.by+j)*N+this.bx+i,w=wx[i]*wy[j],dx=(i-this.fx)*DX,dy=(j-this.fy)*DX;
        mass[n]+=w*m;ux[n]+=w*(m*s.vx[p]+a00*dx+a01*dy);uy[n]+=w*(m*s.vy[p]+a10*dx+a11*dy);
        if(s.pinned[p])fixed[n]+=w*m;
      }
    }
    const demo=s.scene==='softbody',basin=s.scene==='basin';
    const bound=demo?170:basin?245:555,floor=demo?-145:basin?-175:-555,top=demo?145:bound;
    this.activeNodes=0;
    for(let n=0;n<mass.length;n++)if(mass[n]>1e-12){
      this.activeNodes++;ux[n]/=mass[n];uy[n]/=mass[n];
      if(fixed[n]>1e-9){ux[n]=uy[n]=0;continue;}
      if(s.settings.boundary||demo||basin){
        const x=ORIGIN+(n%N)*DX,y=ORIGIN+Math.floor(n/N)*DX;
        if((x<-bound+DX&&ux[n]<0)||(x>bound-DX&&ux[n]>0))ux[n]=0;
        if((y<floor+DX&&uy[n]<0)||(y>top-DX&&uy[n]>0))uy[n]=0;
      }
    }
    for(let p=0;p<s.count;p++){
      if(!isMPMSolid(s.material[p])||s.pinned[p])continue;
      this.stencil(s.x[p],s.y[p]);let vx=0,vy=0,a=0,b=0,c=0,d=0;
      for(let j=0;j<3;j++)for(let i=0;i<3;i++){
        const n=(this.by+j)*N+this.bx+i,w=wx[i]*wy[j],dx=(i-this.fx)*4/DX,dy=(j-this.fy)*4/DX;
        vx+=w*ux[n];vy+=w*uy[n];a+=w*ux[n]*dx;b+=w*ux[n]*dy;c+=w*uy[n]*dx;d+=w*uy[n]*dy;
      }
      this.c00[p]=a;this.c01[p]=b;this.c10[p]=c;this.c11[p]=d;
      const f=this.f00[p],g=this.f01[p],h=this.f10[p],k=this.f11[p];
      this.f00[p]=(1+dt*a)*f+dt*b*h;this.f01[p]=(1+dt*a)*g+dt*b*k;
      this.f10[p]=dt*c*f+(1+dt*d)*h;this.f11[p]=dt*c*g+(1+dt*d)*k;
      s.vx[p]=vx;s.vy[p]=vy;s.x[p]+=dt*vx;s.y[p]+=dt*vy;
      if(s.settings.boundary||demo||basin){s.x[p]=clamp(s.x[p],-bound+.1,bound-.1);s.y[p]=clamp(s.y[p],floor+.1,top-.1);}
    }
  }
  create(s,{x1,y1,x2,y2,material=11,shape='panel',fixed=false}){
    if(!isMPMSolid(material)||![x1,y1,x2,y2].every(Number.isFinite))return false;
    x1=clamp(x1,-530,530);x2=clamp(x2,-530,530);y1=clamp(y1,-530,530);y2=clamp(y2,-530,530);
    const length=Math.hypot(x2-x1,y2-y1),panel=shape==='panel';
    const width=panel?Math.abs(x2-x1):length,height=panel?Math.abs(y2-y1):22;
    if(width<7||height<7)return false;
    const nx=Math.floor(width/3.6)+1,ny=Math.floor(height/3.6)+1;
    if(nx*ny+s.count>s.x.length)return false;
    const ux=(x2-x1)/length,uy=(y2-y1)/length;
    for(let row=0;row<ny;row++)for(let col=0;col<nx;col++){
      const x=panel?x1+Math.sign(x2-x1)*col*3.6:x1+ux*col*3.6-uy*(row*3.6-height/2);
      const y=panel?y1+Math.sign(y2-y1)*row*3.6:y1+uy*col*3.6+ux*(row*3.6-height/2);
      s.add(x,y,material);if(fixed&&col<2)s.structures.pin(s.count-1,true);
    }
    return true;
  }
  stats(s){
    let count=0,min=Infinity,max=0,strain=0;
    for(let p=0;p<s.count;p++)if(isMPMSolid(s.material[p])){
      count++;const a=this.f00[p],b=this.f01[p],c=this.f10[p],d=this.f11[p],J=a*d-b*c;
      min=Math.min(min,J);max=Math.max(max,J);
      strain=Math.max(strain,.5*Math.hypot(a*a+c*c-1,b*b+d*d-1,Math.SQRT2*(a*b+c*d)));
    }
    return {count,minJ:count?min:1,maxJ:count?max:1,strain,nodes:this.activeNodes,substeps:this.substeps};
  }
}
