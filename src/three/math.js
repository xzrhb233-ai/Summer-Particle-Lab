export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const mul=(a,k)=>a.map(v=>v*k);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm=a=>mul(a,1/(Math.hypot(...a)||1));
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const identity=()=>[1,0,0,0,1,0,0,0,1];
export const det=a=>a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
export function inverseTranspose(a){
  const d=det(a);if(Math.abs(d)<1e-10)return null;
  return [(a[4]*a[8]-a[5]*a[7])/d,(a[5]*a[6]-a[3]*a[8])/d,(a[3]*a[7]-a[4]*a[6])/d,
    (a[2]*a[7]-a[1]*a[8])/d,(a[0]*a[8]-a[2]*a[6])/d,(a[1]*a[6]-a[0]*a[7])/d,
    (a[1]*a[5]-a[2]*a[4])/d,(a[2]*a[3]-a[0]*a[5])/d,(a[0]*a[4]-a[1]*a[3])/d];
}
export function rotation(F){
  let r=Array.from(F);
  for(let n=0;n<8;n++){
    const inv=inverseTranspose(r);if(!inv)return identity();
    let diff=0;for(let k=0;k<9;k++){const v=.5*(r[k]+inv[k]);diff+=Math.abs(v-r[k]);r[k]=v;}
    if(diff<1e-8)break;
  }
  return r;
}
export function stress3(F,mu,lambda){
  const R=rotation(F),J=det(F),t=new Float64Array(9);
  for(let a=0;a<3;a++)for(let b=0;b<3;b++){
    for(let k=0;k<3;k++)t[a*3+b]+=2*mu*(F[a*3+k]-R[a*3+k])*F[b*3+k];
    if(a===b)t[a*3+b]+=lambda*(J-1)*J;
  }
  return t;
}
