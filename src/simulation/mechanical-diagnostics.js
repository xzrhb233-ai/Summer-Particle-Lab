import {add,sub,mul,dot,norm,rotate,inverse,qmul,inertia} from '../multibody/model.js';
import {arr,qa,cross,obj} from '../multibody/contact.js';
import {LENGTH as L} from '../multibody/coupling-model.js';
import {det,rotation} from '../three/math.js';
import {createParticleHealth,observeParticleHealth} from './particle-health.js';

// Energy per reference volume, divided by mu; these models use lambda = mu.
// Unsupported laws return null rather than masquerading as zero stored energy.
export function elasticDensity(F,model,J=det(F)){
  if(!(J>0)||!Number.isFinite(J))return null;
  if(model===0){const R=rotation(F);return F.reduce((v,x,k)=>v+(x-R[k])**2,0)+.5*(J-1)**2;}
  if(model===1){const log=Math.log(J);return .5*(F.reduce((v,x)=>v+x*x,0)-3)-log+.5*log*log;}
  return null;
}

export function particleMechanics(s,gravity){
  let kinetic=0,affine=0,potential=0,elastic=0,unsupported=0;
  const particleHealth=createParticleHealth();
  const momentum=[0,0,0],angular=[0,0,0],D=(s.mpm.H*L)**2/4;
  for(let i=0;i<s.count;i++){
    const m=s.mass[i],p=[s.x[i]*L,s.y[i]*L,s.z[i]*L],v=[s.vx[i]*L,s.vy[i]*L,s.vz[i]*L],P=mul(v,m),C=s.mpm.C.subarray(i*9,i*9+9);
    const solid=s.isSolid(i),F=s.mpm.F.subarray(i*9,i*9+9),J=solid?det(F):null;
    observeParticleHealth(particleHealth,s,i,solid,F,C,J);
    kinetic+=.5*m*dot(v,v);potential-=m*dot(gravity,p);
    const H=cross(p,P);
    // APIC carries subcell angular momentum, even when particle centers do not move.
    if(solid){
      affine+=.5*m*D*C.reduce((v,x)=>v+x*x,0);
      const spin=[C[7]-C[5],C[2]-C[6],C[3]-C[1]];
      for(let k=0;k<3;k++)H[k]+=m*D*spin[k];
    }
    for(let k=0;k<3;k++){momentum[k]+=P[k];angular[k]+=H[k];}
    const W=solid&&!s.damage[i]?elasticDensity(F,s.model[i],J):null;
    if(W===null)unsupported++;else elastic+=m*6400*s.settings.stiffness*L*L*W;
  }
  return {kinetic,affine,potential,elastic:unsupported?null:elastic,knownElastic:elastic,unsupported,momentum,angular,particleHealth};
}

function bodyState(engine){
  return [...engine.bodies.values()].map(({definition:b,rb})=>{
    const position=arr(rb.translation()),velocity=arr(rb.linvel()),omega=arr(rb.angvel()),q=qa(rb.rotation()),local=rotate(inverse(q),omega),I=inertia(b),mass=b.type==='fixed'?0:b.mass;
    return {b,position,velocity,omega,mass,spin:mass?rotate(q,local.map((x,k)=>x*I[k])):[0,0,0],rotationMetric:mass?dot(I,local.map(x=>x*x)):0};
  });
}
function jointState(engine,item){
  const d=item.definition,A=engine.bodies.get(d.a),B=engine.bodies.get(d.b);
  if(d.type==='gear')return null;
  const qA=qa(A.rb.rotation()),qB=qa(B.rb.rotation()),a=add(arr(A.rb.translation()),rotate(qA,item.a)),b=add(arr(B.rb.translation()),rotate(qB,item.b)),axis=rotate(qA,item.axisA),delta=sub(b,a);
  const relative=sub(arr(B.rb.velocityAtPoint(obj(b))),arr(A.rb.velocityAtPoint(obj(a))));
  if(d.type==='revolute'){
    const r=qmul(inverse(qmul(qa(A.solverBody.rotation()),qa(item.joint.frameX1()))),qmul(qa(B.solverBody.rotation()),qa(item.joint.frameX2())));
    return {q:2*Math.atan2(r[0],r[3])+(d.angleOffset??0),v:dot(sub(arr(B.rb.angvel()),arr(A.rb.angvel())),axis)};
  }
  if(d.type==='prismatic')return {q:dot(delta,axis),v:dot(relative,axis)};
  if(d.type==='spring')return {q:norm(delta),v:dot(relative,mul(delta,1/Math.max(norm(delta),1e-12)))};
  return null;
}

// Opt-in observer: it does not change solver velocities, loads or poses.
export class MechanicalDiagnostics{
  constructor(engine){
    this.engine=engine;this.initial=null;this.steps=0;this.minDt=Infinity;this.maxDt=0;
    this.ledger={externalWork:0,motorWorkEstimate:0,dampingLossEstimate:0,contactNormalWork:0,contactFrictionWork:0,positiveContactWork:0,boundaryWork:0};
    engine.diagnostics=this;if(engine.particles)engine.particles.mechanicalDiagnostics=this;
  }
  recordContact(result){
    const normal=result.normalWork??0,friction=result.frictionWork??0;
    this.ledger.contactNormalWork+=normal;this.ledger.contactFrictionWork+=friction;
    this.ledger.positiveContactWork+=Math.max(0,normal)+Math.max(0,friction);
  }
  beforeRigid(dt){this.before=bodyState(this.engine);this.jointBefore=new Map([...this.engine.joints].map(([id,j])=>[id,jointState(this.engine,j)]));this.steps++;this.minDt=Math.min(this.minDt,dt);this.maxDt=Math.max(this.maxDt,dt);}
  afterRigid(dt){
    const after=bodyState(this.engine);
    after.forEach((b,i)=>{
      if(!b.mass)return;const a=this.before[i],omega=mul(add(a.omega,b.omega),.5);
      const applied=this.engine.loadProgram?.bodyLoads.get(b.b.id)??b.b;
      this.ledger.externalWork+=dot(applied.force,sub(b.position,a.position))+dt*dot(applied.torque,omega);
      this.ledger.dampingLossEstimate+=dt*b.b.damping*(.5*b.mass*(dot(a.velocity,a.velocity)+dot(b.velocity,b.velocity))+.5*(a.rotationMetric+b.rotationMetric));
    });
    for(const [id,item] of this.engine.joints){
      const d=item.definition,a=this.jointBefore.get(id),b=jointState(this.engine,item);if(!a||!b)continue;
      if(d.motor){
        const motor=d.motor,target=this.engine.loadProgram?.motorTargets.get(id)??motor.target,Q=motor.mode==='position'?motor.stiffness*(target-b.q)-motor.damping*b.v:motor.damping*(target-b.v);
        let dq=b.q-a.q;if(d.type==='revolute')dq=Math.atan2(Math.sin(dq),Math.cos(dq));
        this.ledger.motorWorkEstimate+=Q*dq;
      }
      if(d.type==='spring')this.ledger.dampingLossEstimate+=dt*d.damping*((a.v+b.v)/2)**2;
    }
  }
  sample(frame){
    const e=this.engine,p=e.particles?particleMechanics(e.particles,e.model.gravity):{kinetic:0,affine:0,potential:0,elastic:0,knownElastic:0,unsupported:0,momentum:[0,0,0],angular:[0,0,0]};
    const momentum=p.momentum.slice(),angular=p.angular.slice();
    for(const b of bodyState(e)){const P=mul(b.velocity,b.mass),H=add(cross(b.position,P),b.spin);for(let k=0;k<3;k++){momentum[k]+=P[k];angular[k]+=H[k];}}
    const regions=frame.joints.filter(j=>j.type==='region'),regionElastic=regions.reduce((v,j)=>v+j.elasticEnergy,0),regionWork=regions.reduce((v,j)=>v+j.work,0);
    const storage=frame.energy+p.kinetic+p.affine+p.potential+p.knownElastic+regionElastic;
    if(!this.initial)this.initial={time:frame.time,energy:storage,momentum:momentum.slice(),angular:angular.slice(),regionElastic,regionWork};
    const reasons=[];
    if(p.unsupported)reasons.push('unsupported-material-energy');
    if(e.model.joints.some(j=>j.motor))reasons.push('motor-work-estimated');
    if(e.model.joints.some(j=>j.type==='gear'))reasons.push('gear-work-unresolved');
    if(e.model.bodies.length>1)reasons.push('rigid-contact-unresolved');
    if(norm(e.model.gravity)||e.model.bodies.some(b=>norm(b.force)||norm(b.torque)))reasons.push('external-loads');
    if(e.model.bodies.some(b=>b.damping)||e.model.joints.some(j=>j.type==='spring'&&j.damping))reasons.push('damping-estimated');
    if(e.model.bodies.some(b=>b.type==='fixed')||e.particles?.pinned.subarray(0,e.particles.count).some(Boolean))reasons.push('external-support-reactions');
    const delta=storage-this.initial.energy,regionDelta=regionElastic-this.initial.regionElastic,W=this.ledger;
    const residual=p.unsupported?null:delta-W.externalWork-W.motorWorkEstimate-W.contactNormalWork-W.contactFrictionWork-W.boundaryWork-(regionWork-this.initial.regionWork)-regionDelta+W.dampingLossEstimate;
    const value={schema:'summer-mechanics-diagnostics/1',time:frame.time,baselineTime:this.initial.time,
      rigidEnergy:frame.energy,particleKinetic:p.kinetic,apicKinetic:p.affine,particlePotential:p.potential,materialElastic:p.elastic,regionElastic,
      mechanicalEnergy:p.unsupported?null:storage,knownEnergy:storage,energyChange:p.unsupported?null:delta,...W,
      regionImpulseWork:regionWork-this.initial.regionWork,regionElasticChange:regionDelta,
      positiveCorrectionWork:(e.attachments?.items??[]).reduce((v,j)=>v+(j.totalPositiveWork??0),0),
      residual,momentum,angularMomentum:angular,momentumChange:norm(sub(momentum,this.initial.momentum)),angularMomentumChange:norm(sub(angular,this.initial.angular)),
      constraintError:frame.maxError,penetration:frame.coupling?.maxPenetration??0,unsupportedParticles:p.unsupported,particleHealth:p.particleHealth??null,reasons,
      physicalSubsteps:this.steps,minSubstep:this.steps?this.minDt:null,maxSubstep:this.steps?this.maxDt:null};
    frame.diagnostics=value;return value;
  }
}

export const diagnosticFields=['time','mechanicalEnergy','rigidEnergy','particleKinetic','apicKinetic','particlePotential','materialElastic','regionElastic','externalWork','motorWorkEstimate','dampingLossEstimate','contactNormalWork','contactFrictionWork','boundaryWork','regionImpulseWork','regionElasticChange','positiveCorrectionWork','residual','momentumChange','angularMomentumChange','constraintError','penetration','minSubstep','maxSubstep'];
export function diagnosticsCSV(frames){
  return [diagnosticFields.join(','),...frames.filter(f=>f.diagnostics).map(f=>diagnosticFields.map(k=>f.diagnostics[k]??'').join(','))].join('\n');
}
