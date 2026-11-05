import {exchangeImpulse} from '../simulation/coupling-interface.js';
import {cross,dot,sub} from '../fem/mesh.js';

const L=.025,vel=['vx','vy','vz'];
const mul=(A,v)=>[A[0]*v[0]+A[1]*v[1]+A[2]*v[2],A[3]*v[0]+A[4]*v[1]+A[5]*v[2],A[6]*v[0]+A[7]*v[1]+A[8]*v[2]];
function inverse(A){
  const scale=Math.max(...A.map(Math.abs));if(!(scale>0))throw Error('PBF–FEM 接触三角形退化');
  const [a,b,c,d,e,f,g,h,i]=A.map(x=>x/scale),C=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const determinant=a*C[0]+b*C[3]+c*C[6];
  if(!(determinant>1e-14))throw Error('PBF–FEM 接触三角形退化');
  return C.map(x=>x/(determinant*scale));
}

// PBF carries translational momentum, not APIC spin. Transfer the opposing
// wrench to FEM at the material point centre: barycentric force at the face
// plus a zero-resultant nodal couple. The transpose of this map defines the
// relative velocity, so effective mass and kinetic work use the same operator.
// This preserves angular momentum without inventing hidden fluid rotation.
export function fluidContactDOFs(s,i,state,hit){
  const mobile=!s.pinned[i],m=s.mass[i];
  const nodes=hit.ids.map(n=>state.mesh.nodes[n].map((x,k)=>x+state.u[3*n+k]));
  const center=[0,1,2].map(k=>nodes.reduce((sum,v)=>sum+v[k],0)/3),arms=nodes.map(x=>sub(x,center));
  // Earlier contacts in the pass may have corrected these FEM positions.
  // Preserve the moment arm to their current barycentric force location.
  const facePoint=[0,1,2].map(k=>nodes.reduce((sum,v,a)=>sum+hit.weights[a]*v[k],0));
  const particleCenter=sub(hit.point,hit.arm),lever=sub(particleCenter,facePoint);
  const S=Array(9).fill(0);
  for(const r of arms)for(let j=0;j<3;j++)for(let k=0;k<3;k++)S[3*j+k]+=(j===k?dot(r,r):0)-r[j]*r[k];
  const invS=inverse(S),W=arms.map(()=>Array(9).fill(0));
  for(let k=0;k<3;k++){
    const unit=[0,0,0];unit[k]=1;
    const spin=mul(invS,cross(lever,unit));
    for(let a=0;a<3;a++){const couple=cross(spin,arms[a]);for(let j=0;j<3;j++)W[a][3*j+k]=hit.weights[a]*unit[j]+couple[j];}
  }
  const relative=()=>{
    const out=mobile?vel.map(k=>s[k][i]*L):[0,0,0];
    for(let a=0;a<3;a++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)out[k]-=W[a][3*j+k]*state.v[3*hit.ids[a]+j];
    return out;
  };
  const inv=direction=>{
    let out=mobile?dot(direction,direction)/m:0;
    for(let a=0;a<3;a++){const J=mul(W[a],direction);for(let k=0;k<3;k++){const n=3*hit.ids[a]+k;if(!state.fixed[n])out+=J[k]**2/state.m[n];}}
    return out;
  };
  const particle={applyImpulse(J){
    const support=[0,0,0],impulse=[0,0,0];let work=0;
    if(mobile){work=dot(J,vel.map(k=>s[k][i]*L))+.5*dot(J,J)/m;for(let k=0;k<3;k++){s[vel[k]][i]+=J[k]/m/L;impulse[k]=J[k];}}
    else for(let k=0;k<3;k++)support[k]=J[k];
    return {support,impulse,work};
  }};
  const fem={applyImpulse(J){
    const support=[0,0,0],impulse=[0,0,0];let work=0;
    for(let a=0;a<3;a++){const force=mul(W[a],J);for(let k=0;k<3;k++){
      const n=3*hit.ids[a]+k,j=force[k];
      if(state.fixed[n])support[k]+=j;
      else{work+=j*state.v[n]+.5*j*j/state.m[n];state.v[n]+=j/state.m[n];impulse[k]+=j;}
    }}
    state.contactWork+=work;return {support,impulse,work};
  }};
  return {point:particleCenter,relative,inv,solid:false,apply(J){const r=exchangeImpulse(particle,fem,J);return {...r,femWork:r.workB,mpmWork:r.workA};}};
}
