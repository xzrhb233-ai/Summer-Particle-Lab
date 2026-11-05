// Hencky finite-strain adaptation; Cauchy strengths / E, tension positive.
export const PRESSURE_DEFAULTS=Object.freeze({cohesion:.025,slope:.6,dilatancy:.15,tension:.01,alpha:1.5,plateau:.015,gamma:.01,densify:.02,beta:2,epsD:.7});
export const PRESSURE_LIMITS=Object.freeze({cohesion:[0,.5],slope:[0,2],dilatancy:[0,2],tension:[0,.5],alpha:[.05,Math.sqrt(4.5)],plateau:[.0001,.5],gamma:[0,1],densify:[.0001,1],beta:[1,5],epsD:[.05,3]});
export function pressureParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p={...PRESSURE_DEFAULTS,...input};
  if(Object.keys(input).some(k=>!Object.hasOwn(PRESSURE_DEFAULTS,k)))return null;
  for(const [k,[lo,hi]] of Object.entries(PRESSURE_LIMITS))if(!Number.isFinite(p[k])||p[k]<lo||p[k]>hi)return null;
  return p.dilatancy<=p.slope&&p.slope*p.tension<=p.cohesion+1e-12?Object.freeze(p):null;
}
export function foamStrength(ep,p=PRESSURE_DEFAULTS){
  const r=ep/p.epsD;
  return r>=1?1e20:p.plateau+p.gamma*r-p.densify*Math.log(Math.max(1e-30,1-r**p.beta));
}
export function pressureReturn(sigma,model,jp,ep,p=PRESSURE_DEFAULTS){
  const e=sigma.map(x=>Math.log(Math.max(x,1e-6))),trace=e.reduce((a,b)=>a+b,0),dev=e.map(x=>x-trace/3),length=Math.hypot(...dev);
  const J=Math.max(1e-6,Math.exp(trace)*jp),G=.4/J,K=(2/3)/J;
  const mean=K*trace,q=Math.sqrt(6)*G*length;
  let meanNew=mean,qNew=q,increment=0;
  if(model===8){
    const t=q/Math.sqrt(3),{cohesion:c,slope:a,dilatancy:b,tension:T}=p;
    if(mean>T&&t+a*T<=c){meanNew=T;}
    else if(t+a*mean>c){
      const dl=(t+a*mean-c)/(G+a*K*b);
      meanNew=mean-K*b*dl;qNew=Math.sqrt(3)*Math.max(0,t-G*dl);
      if(meanNew>T){meanNew=T;qNew=Math.sqrt(3)*Math.max(0,c-a*T);}
    }
  }else{
    const a2=p.alpha**2,B=1+a2/9,trial=Math.sqrt((q*q+a2*mean*mean)/B);
    if(trial>foamStrength(ep,p)){
      const state=eta=>{
        const qn=q/(1+3*G*eta),mn=mean/(1+K*a2*eta),hat=Math.sqrt((qn*qn+a2*mn*mn)/B);
        const dl=eta*B*hat;
        return {qn,mn,dl,residual:hat-foamStrength(ep+dl,p)};
      };
      let lo=0,hi=1/G;
      for(let k=0;k<32&&state(hi).residual>0;k++)hi*=2;
      for(let k=0;k<28;k++){const mid=(lo+hi)/2;if(state(mid).residual>0)lo=mid;else hi=mid;}
      const result=state((lo+hi)/2);qNew=result.qn;meanNew=result.mn;increment=result.dl;
    }
  }
  const traceNew=meanNew/K,scale=q>1e-20?qNew/q:1,newE=dev.map(x=>traceNew/3+scale*x);
  if(model===8)increment=Math.sqrt(2/3)*Math.hypot(...e.map((x,k)=>x-newE[k]));
  return {sigma:newE.map(Math.exp),jp:jp*Math.exp(trace-traceNew),increment};
}
