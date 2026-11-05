import {identity} from './math.js';
import {svd3} from './constitutive.js';

// Local tensile strain damage. Failed material remains MPM, with a cohesionless
// Drucker–Prager return; no particle deletion or artificial separation impulse.
export function fractureParameters(v={}) {
  const p={enabled:v.enabled??false,onset:v.onset??.08,failure:v.failure??.16};
  if(typeof p.enabled!=='boolean'||![p.onset,p.failure].every(Number.isFinite)||p.onset<.005||p.failure<=p.onset||p.failure>2)throw Error('断裂应变需满足 0.005 ≤ 起裂 < 失效 ≤ 2');
  return p;
}
export function updateDamage(s,i) {
  const p=s.fractureMaterials[s.lab.part[i]];
  if(!p?.enabled||s.damage[i]>=1)return;
  const F=s.mpm.F.subarray(i*9,i*9+9),{sigma}=svd3(F);
  const strain=Math.max(0,...sigma.map(x=>Math.log(Math.max(x,1e-8))));
  s.damage[i]=Math.max(s.damage[i],Math.min(1,(strain-p.onset)/(p.failure-p.onset)));
  if(s.damage[i]>=1){s.model[i]=3;s.mpm.F.set(identity(),i*9);s.mpm.Jp[i]=1;s.mpm.dilation[i]=0;s.mpm.cacheValid[i]=0;}
}
