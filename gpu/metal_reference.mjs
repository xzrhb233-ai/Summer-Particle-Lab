import {projectPlastic,constitutiveStress} from '../src/three/constitutive.js';
import {PLASTICITY_DEFAULTS} from '../src/three/metal-plasticity.js';
const cases=[];
for(const model of [4,5,6,7])for(const temp of [20,650,1100])for(const dt of [.001,.02]){
  const F=[1.3,.1,0,0,.8,0,0,0,1/1.04],ep=.15,p={...PLASTICITY_DEFAULTS,A:.03,B:.12};
  const result=projectPlastic(F,model,1,0,.025,35,ep,dt,temp,p);
  cases.push({model,temp,dt,ep,p,F,expected:Array.from(result.F),plastic:ep+result.plasticIncrement,tau:Array.from(constitutiveStress(result.F,model,.4,.4))});
}
console.log(JSON.stringify(cases));
