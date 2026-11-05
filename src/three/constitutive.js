import { identity,det,clamp,stress3 } from './math.js';
import { metalReturn } from './metal-plasticity.js';
import { thermalReturn } from './thermal-plasticity.js';
import { pressureReturn } from './pressure-plasticity.js';

export const MODELS=[
  {name:'共旋转弹性',description:'紫色 · 形变后回弹，适合软体与悬臂。'},
  {name:'Neo-Hookean 超弹性',description:'绿色 · 非线性大形变弹性，适合橡胶状物体。'},
  {name:'雪 · 弹塑性',description:'白色 · 超过屈服后留下永久形变，压实后硬化。'},
  {name:'砂 · Drucker–Prager',description:'金色 · 无抗拉强度，受压摩擦承载，可塌落堆积。'},
  {name:'理想弹塑性 · J2',description:'蓝色 · 达到屈服强度后产生永久形变，屈服强度不随塑性应变增加。'},
  {name:'线性强化 · J2',description:'珊瑚色 · 塑性应变越大，屈服强度越高；卸载保留永久形变。'},
  {name:'Johnson–Cook',description:'橙色 · 加工硬化、应变率强化与温度软化共同决定屈服强度。'},
  {name:'简化 Johnson–Cook',description:'青色 · 保留加工硬化和应变率强化，不含温度软化项。'},
  {name:'黏聚岩土 · Drucker–Prager',description:'棕色 · 压力相关剪切屈服、独立剪胀与拉伸截断，可保留塑性体积变化。'},
  {name:'泡沫金属 · Deshpande–Fleck',description:'玫红色 · 静水压力也能引起屈服，压缩留下永久体积变化，压密后强化。'},
  {name:'温度相关 J2 塑性',description:'红色 · 加热降低屈服强度，冷却恢复强度；永久形变保留。'},
  {name:'Norton–Arrhenius 蠕变',description:'青柠色 · 受力下持续蠕变，加热加速、冷却减慢；使用实时温度。'},
];

// Jacobi diagonalization of FᵀF. Columns of U and V are principal directions.
export function svd3(F){
  const a=new Float64Array(9),v=identity();
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)a[i*3+j]+=F[k*3+i]*F[k*3+j];
  for(let sweep=0;sweep<10;sweep++){
    let changed=false;
    for(const [p,q] of [[0,1],[0,2],[1,2]]){
      const apq=a[p*3+q];if(Math.abs(apq)<1e-13*(1+Math.abs(a[p*3+p])+Math.abs(a[q*3+q])))continue;
      changed=true;const theta=.5*Math.atan2(2*apq,a[q*3+q]-a[p*3+p]),c=Math.cos(theta),s=Math.sin(theta);
      const app=a[p*3+p],aqq=a[q*3+q];
      a[p*3+p]=c*c*app-2*s*c*apq+s*s*aqq;a[q*3+q]=s*s*app+2*s*c*apq+c*c*aqq;a[p*3+q]=a[q*3+p]=0;
      for(let k=0;k<3;k++){
        if(k!==p&&k!==q){const x=a[k*3+p],y=a[k*3+q];a[k*3+p]=a[p*3+k]=c*x-s*y;a[k*3+q]=a[q*3+k]=s*x+c*y;}
        const x=v[k*3+p],y=v[k*3+q];v[k*3+p]=c*x-s*y;v[k*3+q]=s*x+c*y;
      }
    }
    if(!changed)break;
  }
  const sigma=[0,1,2].map(k=>Math.sqrt(Math.max(1e-16,a[k*3+k]))),u=new Float64Array(9);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)u[i*3+j]+=F[i*3+k]*v[k*3+j]/sigma[j];
  return {u,v,sigma};
}
export function compose({u,v},sigma){
  const F=new Float64Array(9);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)F[i*3+j]+=u[i*3+k]*sigma[k]*v[j*3+k];
  return F;
}
export const hardening=jp=>clamp(Math.exp(10*(1-jp)),.25,4);

// Snow: multiplicative Fe/Fp split, asymmetric stretch yield and compaction hardening.
// Sand: non-cohesive logarithmic Drucker–Prager return with a dilation history.
export function projectPlastic(F,model,jp=1,dilation=0,yieldStrain=.025,friction=35,ep=0,dt=1/240,temperature=20,parameters,pressure,thermal){
  if(model<2)return {F,jp,dilation};
  const decomposition=svd3(F),s=decomposition.sigma;
  let projected,metalIncrement;
  if(model===2){
    projected=s.map(x=>clamp(x,1-yieldStrain,1+yieldStrain*.3));
    jp=clamp(jp*s.reduce((a,b)=>a*b,1)/projected.reduce((a,b)=>a*b,1),.6,20);
  }else if(model>=10){
    const result=thermalReturn(s,model,ep,dt,temperature,thermal);projected=result.sigma;metalIncrement=result.increment;
  }else if(model>=8){
    const result=pressureReturn(s,model,jp,ep,pressure);projected=result.sigma;jp=result.jp;metalIncrement=result.increment;
  }else if(model>=4){
    const result=metalReturn(s,model,ep,dt,temperature,parameters);projected=result.sigma;metalIncrement=result.increment;
  }else{
    const e=s.map(x=>Math.log(Math.max(x,1e-6))),trace=e.reduce((a,b)=>a+b,0)+dilation;
    if(trace>=0){projected=[1,1,1];dilation=trace;}
    else {
      dilation=0;const dev=e.map(x=>x-trace/3),length=Math.hypot(...dev);
      const sin=Math.sin(friction*Math.PI/180),alpha=Math.sqrt(2/3)*2*sin/(3-sin);
      // lambda = mu here, so (3 lambda + 2 mu)/(2 mu) = 2.5.
      const delta=Math.max(0,length+2.5*trace*alpha);
      projected=e.map((x,k)=>Math.exp(x-delta/(length||1)*dev[k]));
    }
  }
  const plasticIncrement=metalIncrement??Math.hypot(...s.map((x,k)=>Math.log(x/projected[k])));
  return {F:compose(decomposition,projected),jp,dilation,plasticIncrement,decomposition:{u:decomposition.u,v:decomposition.v,sigma:projected}};
}

// Reuse the plastic return's principal directions; no second SVD is needed.
export function principalStress({u,sigma},model){
  const J=sigma[0]*sigma[1]*sigma[2],e=sigma.map(Math.log),trace=e[0]+e[1]+e[2];
  const diagonal=sigma.map((x,k)=>model===2?2*(x-1)*x+(J-1)*J:2*e[k]+trace),tau=new Float64Array(9);
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let k=0;k<3;k++)tau[a*3+b]+=u[a*3+k]*diagonal[k]*u[b*3+k];
  return tau;
}

export function vonMises(tau,J=1){
  return Math.sqrt(Math.max(0,.5*((tau[0]-tau[4])**2+(tau[4]-tau[8])**2+(tau[8]-tau[0])**2)+3*(tau[1]**2+tau[2]**2+tau[5]**2)))/Math.max(1e-6,J);
}

export function constitutiveStress(F,model,mu,lambda,jp=1){
  if(model===0||model===2){const h=model===2?hardening(jp):1;return stress3(F,mu*h,lambda*h);}
  const tau=new Float64Array(9);
  if(model===1){
    const pressure=lambda*Math.log(Math.max(det(F),1e-6));
    for(let a=0;a<3;a++)for(let b=0;b<3;b++){
      for(let k=0;k<3;k++)tau[a*3+b]+=mu*F[a*3+k]*F[b*3+k];
      if(a===b)tau[a*3+b]+=pressure-mu;
    }
  }else{
    const {u,sigma}=svd3(F),e=sigma.map(x=>Math.log(Math.max(x,1e-6))),trace=e.reduce((a,b)=>a+b,0);
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let k=0;k<3;k++)tau[a*3+b]+=u[a*3+k]*(2*mu*e[k]+lambda*trace)*u[b*3+k];
  }
  return tau;
}
