// Isochoric Hencky/J2 thermal strength and secondary Norton–Arrhenius creep.
// Stress parameters / constant Young's modulus E. Temperatures entered in °C.
export const THERMAL_DEFAULTS=Object.freeze({Tref:20,Thot:180,hotRatio:.08,A:.04,H:.04,rate:.0005,Q:35000,n:3,stress:.04});
export const THERMAL_LIMITS=Object.freeze({Tref:[-100,1500],Thot:[-99,2500],hotRatio:[.001,1],A:[.0001,.5],H:[0,2],rate:[0,10],Q:[0,200000],n:[1,8],stress:[.001,.5]});
export function thermalParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p={...THERMAL_DEFAULTS,...input};
  if(Object.keys(input).some(k=>!Object.hasOwn(THERMAL_DEFAULTS,k)))return null;
  for(const [k,[lo,hi]] of Object.entries(THERMAL_LIMITS))if(!Number.isFinite(p[k])||p[k]<lo||p[k]>hi)return null;
  return p.Thot>p.Tref?Object.freeze(p):null;
}
export function thermalStrength(ep,T,p=THERMAL_DEFAULTS){
  const theta=Math.max(0,Math.min(1,(T-p.Tref)/(p.Thot-p.Tref)));
  return (p.A+p.H*ep)*(1-(1-p.hotRatio)*theta);
}
// Use Kelvin and a bounded logarithm to stay finite at extreme brush temperatures.
export function creepLogRate(q,T,p=THERMAL_DEFAULTS){
  if(p.rate===0||q<=0)return -Infinity;
  const activation=Math.max(-60,Math.min(60,p.Q/8.314462618*(1/(p.Tref+273.15)-1/Math.max(1,T+273.15))));
  return Math.log(p.rate)+activation+p.n*Math.log(q/p.stress);
}
export function thermalReturn(sigma,model,ep,dt,T,p=THERMAL_DEFAULTS){
  const e=sigma.map(x=>Math.log(Math.max(x,1e-6))),tr=e.reduce((a,b)=>a+b,0),dev=e.map(x=>x-tr/3);
  const length=Math.hypot(...dev),J=Math.max(1e-6,Math.exp(tr)),q=Math.sqrt(6)*.4*length/J,slope=1.2/J;
  let increment=0;
  if(model===10){
    const factor=thermalStrength(0,T,p)/p.A;
    increment=Math.max(0,(q-thermalStrength(ep,T,p))/(slope+p.H*factor));
  }else if(dt>0&&p.rate>0&&q>1e-20){
    // Backward Euler: Δep = dt * rate(q_trial - 3G Δep, T).
    let lo=0,hi=q/slope;
    for(let k=0;k<32;k++){
      const mid=(lo+hi)/2;
      if(Math.log(mid/dt)<creepLogRate(Math.max(0,q-slope*mid),T,p))lo=mid;else hi=mid;
    }
    increment=(lo+hi)/2;
  }
  const scale=Math.max(0,1-Math.sqrt(1.5)*increment/Math.max(length,1e-20));
  return {sigma:dev.map(x=>Math.exp(tr/3+scale*x)),increment};
}
