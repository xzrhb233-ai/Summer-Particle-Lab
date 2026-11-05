import {projectPlastic,constitutiveStress,vonMises} from '../src/three/constitutive.js';
import {THERMAL_DEFAULTS as P} from '../src/three/thermal-plasticity.js';
import {det} from '../src/three/math.js';
const cases=[];
for(const model of [10,11])for(const T of [-100,20,180,800])for(const F of [[1,.2,0,0,1,0,0,0,1],[.9,0,0,0,1.05,0,0,0,1]]){
  const p={...P},ep=.05,r=projectPlastic(F,model,1,0,.025,35,ep,.01,T,undefined,undefined,p);
  cases.push({model,T,F,ep,p,expected:Array.from(r.F),plastic:ep+r.plasticIncrement,vm:vonMises(constitutiveStress(r.F,model,.4,.4),det(r.F))});
}
console.log(JSON.stringify(cases));
