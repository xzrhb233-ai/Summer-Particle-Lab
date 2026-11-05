// Strengths are Cauchy stress / E. Finite-strain adaptation: isotropic
// Hencky elasticity with isochoric J2 return, rather than a Jaumann-rate update.
export const PLASTICITY_DEFAULTS=Object.freeze({A:.025,B:.08,n:.35,C:.025,rate0:1,Tref:20,Tm:1000,m:1});
export const PLASTICITY_LIMITS=Object.freeze({A:[.0001,.5],B:[0,2],n:[.05,2],C:[0,.2],rate0:[.001,1000],Tref:[-100,1500],Tm:[0,3000],m:[.1,5]});
export function plasticityParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p={...PLASTICITY_DEFAULTS,...input};
  if(Object.keys(input).some(k=>!Object.hasOwn(PLASTICITY_DEFAULTS,k)))return null;
  for(const [k,[lo,hi]] of Object.entries(PLASTICITY_LIMITS))if(!Number.isFinite(p[k])||p[k]<lo||p[k]>hi)return null;
  return p.Tm>p.Tref?Object.freeze(p):null;
}
export function flowStress(model,ep,rate,temperature,p=PLASTICITY_DEFAULTS){
  if(model===4)return p.A;
  if(model===5)return p.A+p.B*ep;
  // Regularize the logarithm below the reference rate; preserve static yield.
  const rateFactor=1+p.C*Math.log(Math.max(1,rate/p.rate0));
  const theta=Math.max(0,Math.min(1,(temperature-p.Tref)/(p.Tm-p.Tref)));
  return (p.A+p.B*ep**p.n)*rateFactor*(model===6?1-theta**p.m:1);
}
export function metalReturn(sigma,model,ep,dt,temperature,p=PLASTICITY_DEFAULTS){
  const e=sigma.map(x=>Math.log(Math.max(x,1e-6))),trace=e.reduce((a,b)=>a+b,0),dev=e.map(x=>x-trace/3);
  const length=Math.hypot(...dev),J=Math.max(1e-6,Math.exp(trace)),q=Math.sqrt(6)*.4*length/J;
  let increment=0;
  if(q>flowStress(model,ep,0,temperature,p)){
    const slope=1.2/J;
    if(model<=5)increment=(q-flowStress(model,ep,0,temperature,p))/(slope+(model===5?p.B:0));
    else {
      let lo=0,hi=q/slope;
      for(let iteration=0;iteration<24;iteration++){
        const mid=(lo+hi)/2;
        if(q-slope*mid>flowStress(model,ep+mid,mid/Math.max(dt,1e-12),temperature,p))lo=mid;else hi=mid;
      }
      increment=(lo+hi)/2;
    }
  }
  const scale=Math.max(0,1-Math.sqrt(1.5)*increment/Math.max(length,1e-20));
  return {sigma:dev.map(x=>Math.exp(trace/3+scale*x)),increment};
}
