import {projectPlastic,constitutiveStress,vonMises} from '../src/three/constitutive.js';
import {PRESSURE_DEFAULTS} from '../src/three/pressure-plasticity.js';
import {det} from '../src/three/math.js';
const cases=[];
for(const model of [8,9])for(const jp of [.6,1,1.2])for(const F of [[.85,0,0,0,.85,0,0,0,.85],[1.1,0,0,0,1.1,0,0,0,1.1],[1,.45,0,0,.95,0,0,0,1.1]]){
  const p={...PRESSURE_DEFAULTS},ep=.05,r=projectPlastic(F,model,jp,0,.025,35,ep,.01,20,undefined,p);
  const tau=constitutiveStress(r.F,model,.4,.4),vm=vonMises(tau,det(r.F)*r.jp);
  cases.push({model,jp,F,ep,p,expected:Array.from(r.F),newJp:r.jp,plastic:ep+r.plasticIncrement,vm});
}
console.log(JSON.stringify(cases));
