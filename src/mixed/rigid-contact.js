import {exchangeImpulse} from '../simulation/coupling-interface.js';
import {arr,obj,cross} from '../multibody/contact.js';
import {dot,add,sub} from '../multibody/model.js';

// The body is the same Rapier object used by rigid/particle contact and joints.
// There is no independently integrated FEM-side copy of a rigid part.
export const rigidPosition=body=>arr(body.rb.translation());
export const rigidRadius=body=>body.definition.size[0]/2;
export const rigidInverseMass=body=>body.definition.type==='fixed'?0:1/body.definition.mass;
export function rigidDOFs(body,state,hit){
  // Other contacts may have moved the face since its manifold was built.
  // Apply both impulses at the same current barycentric material point.
  const point=[0,1,2].map(k=>hit.ids.reduce((sum,n,a)=>sum+hit.weights[a]*(state.mesh.nodes[n][k]+state.u[3*n+k]),0));
  hit={...hit,point,arm:sub(point,rigidPosition(body))};
  const invMass=rigidInverseMass(body),matrix=body.rb.effectiveWorldInvInertia();
  // Rapier's tensor includes the authored shape, its initial orientation and
  // the current rotation. A scalar sphere inertia is wrong for boxes/discs.
  const inverseI=v=>invMass?[
    matrix.m11*v[0]+matrix.m12*v[1]+matrix.m13*v[2],
    matrix.m21*v[0]+matrix.m22*v[1]+matrix.m23*v[2],
    matrix.m31*v[0]+matrix.m32*v[1]+matrix.m33*v[2],
  ]:[0,0,0];
  const relative=()=>{
    const v=invMass?arr(body.rb.velocityAtPoint(obj(hit.point))):[0,0,0];
    for(let a=0;a<3;a++)for(let k=0;k<3;k++)v[k]-=hit.weights[a]*state.v[3*hit.ids[a]+k];return v;
  };
  const inv=direction=>{
    const arm=cross(hit.arm,direction);let out=invMass+dot(arm,inverseI(arm));
    for(let a=0;a<3;a++)for(let k=0;k<3;k++){const n=3*hit.ids[a]+k;if(!state.fixed[n])out+=hit.weights[a]**2*direction[k]**2/state.m[n];}return out;
  };
  const rigid={applyImpulse(J){
    if(!invMass)return {work:0,support:J.slice(),impulse:[0,0,0]};
    const torque=cross(hit.arm,J),work=dot(J,arr(body.rb.linvel()))+.5*dot(J,J)*invMass+dot(torque,arr(body.rb.angvel()))+.5*dot(torque,inverseI(torque));
    body.rb.applyImpulseAtPoint(obj(J),obj(hit.point),true);
    return {work,support:[0,0,0],impulse:J.slice()};
  }};
  const fem={applyImpulse(J){
    let work=0;const support=[0,0,0],impulse=[0,0,0];
    for(let a=0;a<3;a++)for(let k=0;k<3;k++){
      const n=3*hit.ids[a]+k,j=hit.weights[a]*J[k];
      if(state.fixed[n])support[k]+=j;
      else {work+=j*state.v[n]+.5*j*j/state.m[n];state.v[n]+=j/state.m[n];impulse[k]+=j;}
    }
    state.contactWork+=work;return {work,support,impulse};
  }};
  return {point,relative,inv,solid:true,apply:J=>exchangeImpulse(rigid,fem,J)};
}
export function shiftRigid(body,delta){body.rb.setTranslation(obj(add(rigidPosition(body),delta)),true);}
