import RAPIER from '../../node_modules/@dimforge/rapier3d-compat/rapier.mjs';
import {validateModel,quaternion,rotate,inverse,qmul,add,sub,mul,dot,norm,inertia} from './model.js';
import {LoadProgram} from '../simulation/load-program.js';
import {PhysicsClock} from '../simulation/physics-clock.js';
const obj=v=>({x:v[0],y:v[1],z:v[2]}),quat=q=>({...obj(q),w:q[3]}),arr=v=>[v.x,v.y,v.z],qa=q=>[q.x,q.y,q.z,q.w];
// Rapier's JS unit joints take one common local axis. Keep each solver body's
// initial basis world-aligned and rotate its collider/inertia instead. The
// public body view still exposes the user's geometry basis to contact and UI.
function geometryBody(raw,q0){
  return new Proxy(raw,{get(target,key){
    if(key==='rotation')return ()=>quat(qmul(qa(target.rotation()),q0));
    if(key==='setRotation')return (q,wake)=>target.setRotation(quat(qmul(qa(q),inverse(q0))),wake);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
let ready;
export function initialize(){return ready??=RAPIER.init();}
export class MultibodySimulation{
  constructor(input){
    this.model=validateModel(input);this.world=new RAPIER.World(obj(this.model.gravity));this.world.numSolverIterations=this.model.iterations;this.bodies=new Map();this.joints=new Map();this.time=0;this.steps=0;this.previousVelocity=new Map();this.acceleration=new Map();
    try{
      for(const b of this.model.bodies){
        if(b.appearance){for(const shape of b.appearance){Object.freeze(shape.position);Object.freeze(shape.size);Object.freeze(shape.rotation);Object.freeze(shape);}Object.freeze(b.appearance);}
        const q=quaternion(b.rotation),desc=(b.type==='fixed'?RAPIER.RigidBodyDesc.fixed():RAPIER.RigidBodyDesc.dynamic()).setTranslation(...b.position).setLinvel(...b.velocity).setAngvel(obj(b.angularVelocity)).setLinearDamping(b.damping).setAngularDamping(b.damping).setCanSleep(false).setCcdEnabled(true);
        const solverBody=this.world.createRigidBody(desc),rb=geometryBody(solverBody,q),[x,y,z]=b.size;
        const colliders=[];
        if(b.shape==='torus'){
          const R=(x-z)/2,r=z/2,segments=32,halfAngle=Math.PI/segments;
          for(let k=0;k<segments;k++){const a=(k+.5)*2*halfAngle;colliders.push(RAPIER.ColliderDesc.capsule(R*Math.sin(halfAngle),r).setTranslation(R*Math.cos(halfAngle)*Math.cos(a),R*Math.cos(halfAngle)*Math.sin(a),0).setRotation(quat(quaternion([0,0,a*180/Math.PI]))));}
          // Use analytic torus inertia instead of counting overlapping capsule
          // seams as extra material. Rapier retains the open center for contact.
          rb.setAdditionalMassProperties(b.mass,obj([0,0,0]),obj(inertia(b)),quat(q),true);
        }else colliders.push(b.shape==='sphere'?RAPIER.ColliderDesc.ball(x/2):b.shape==='cylinder'?RAPIER.ColliderDesc.cylinder(y/2,x/2):b.shape==='disc'?RAPIER.ColliderDesc.cylinder(z/2,x/2).setRotation(quat(quaternion([90,0,0]))):RAPIER.ColliderDesc.cuboid(x/2,y/2,z/2));
        const membership=1<<b.collisionFamily;
        for(const collider of colliders){collider.setTranslation(...rotate(q,arr(collider.translation))).setRotation(quat(qmul(q,qa(collider.rotation))));collider.setCollisionGroups(((membership<<16)|(b.collisionFamily?0xffff^membership:0xffff))>>>0);this.world.createCollider(collider.setMass(b.shape==='torus'?0:b.mass).setFriction(b.friction).setRestitution(b.restitution),solverBody);}
        if(b.type==='dynamic'){rb.addForce(obj(b.force),true);rb.addTorque(obj(b.torque),true);}
        this.bodies.set(b.id,{definition:b,rb,solverBody,q0:q});this.previousVelocity.set(b.id,b.velocity.slice());this.acceleration.set(b.id,[0,0,0]);
      }
      for(const j of this.model.joints){
        const A=this.bodies.get(j.a),B=this.bodies.get(j.b),a=rotate(inverse(A.q0),sub(j.anchor,A.definition.position)),b=rotate(inverse(B.q0),sub(j.type==='spring'||j.separateAnchors?j.anchorB:j.anchor,B.definition.position));
        const axisA=rotate(inverse(A.q0),j.axis),axisB=rotate(inverse(B.q0),j.axis);let d;
        if(j.type==='gear'){const carrier=j.carrier?this.bodies.get(j.carrier):null;this.joints.set(j.id,{definition:j,a,b,axisA,axisB,axisCarrier:carrier?rotate(inverse(carrier.q0),j.axis):null,angles:carrier?[0,0,0]:[0,0],previous:carrier?[0,0,0]:[0,0],torque:0});continue;}
        const sa=obj(rotate(A.q0,a)),sb=obj(rotate(B.q0,b)),offset=j.angleOffset??0;
        if(j.type==='fixed')d=RAPIER.JointData.fixed(sa,quat([0,0,0,1]),sb,quat([0,0,0,1]));
        else if(j.type==='planar')d=RAPIER.JointData.generic(sa,sb,obj(j.axis),RAPIER.JointAxesMask.LinX|RAPIER.JointAxesMask.AngY|RAPIER.JointAxesMask.AngZ);
        else if(j.type==='spring')d=RAPIER.JointData.spring(j.restLength,j.stiffness,j.damping,sa,sb);
        else if(j.type==='spherical')d=RAPIER.JointData.spherical(sa,sb);
        else d=RAPIER.JointData[j.type](sa,sb,obj(j.axis));
        const joint=this.world.createImpulseJoint(d,A.solverBody,B.solverBody,true);joint.setContactsEnabled(false);
        if(j.limits)joint.setLimits(...j.limits.map(x=>x-offset));
        if(j.motor){joint.configureMotorModel(RAPIER.MotorModel.ForceBased);if(j.motor.mode==='velocity')joint.configureMotorVelocity(j.motor.target,j.motor.damping);else joint.configureMotorPosition(j.motor.target-offset,j.motor.stiffness,j.motor.damping);}
        this.joints.set(j.id,{definition:j,joint,a,b,axisA,previousAngle:null,unwrapped:0});
      }
      this.loadProgram=new LoadProgram(this);this.clock=new PhysicsClock(this.model.dt);
    }catch(e){this.world.free();throw e;}
  }
  step(dt=this.model.dt){
    if(!Number.isFinite(dt)||dt<=0||dt>1/60)throw Error('时间步无效');
    const end=this.time+dt;
    while(end-this.time>1e-10){
      const tick=this.clock.next(this.time,end,this.model.dt,this.loadProgram.schedule()),h=tick.dt;
      this.loadProgram.apply(this.time,h);this.world.timestep=h;this.diagnostics?.beforeRigid(h);this.solveGears(h);this.world.step();this.diagnostics?.afterRigid(h);this.time=tick.end;this.steps++;
    }
    for(const [id,{rb}] of this.bodies){const v=arr(rb.linvel());this.acceleration.set(id,mul(sub(v,this.previousVelocity.get(id)),1/dt));this.previousVelocity.set(id,v);}
    return this.snapshot();
  }
  gearState(item){
    const j=item.definition,entries=[this.bodies.get(j.a),this.bodies.get(j.b)],axes=[item.axisA,item.axisB],worldAxes=[];
    if(j.carrier){entries.push(this.bodies.get(j.carrier));axes.push(item.axisCarrier);}
    const jacobian=j.carrier?[-j.ratio,1,j.ratio-1]:[-j.ratio,1];
    entries.forEach(({rb,q0},i)=>{
      const q=qa(rb.rotation()),relative=qmul(inverse(q0),q),angle=2*Math.atan2(dot(relative.slice(0,3),axes[i]),relative[3]);
      item.angles[i]+=Math.atan2(Math.sin(angle-item.previous[i]),Math.cos(angle-item.previous[i]));item.previous[i]=angle;worldAxes.push(rotate(q,axes[i]));
    });
    const speeds=entries.map(({rb},i)=>dot(arr(rb.angvel()),worldAxes[i]));
    return {entries,axes,worldAxes,jacobian,phaseError:dot(jacobian,item.angles),speedError:dot(jacobian,speeds)};
  }
  solveGears(dt){
    for(const item of this.joints.values())if(item.definition.type==='gear'){
      const j=item.definition,s=this.gearState(item),inverseInertias=s.entries.map(({definition},i)=>definition.type==='fixed'?0:s.axes[i].reduce((sum,x,a)=>sum+x*x/inertia(definition)[a],0));
      const denominator=inverseInertias.reduce((sum,v,i)=>sum+s.jacobian[i]**2*v,0);if(denominator<1e-12)continue;
      // Implicit compliant gear impulse. Apply before Rapier so its support
      // joints also see the reaction; never overwrite solved velocities/poses.
      const impulse=Math.max(-j.maxTorque*dt,Math.min(j.maxTorque*dt,-dt*(j.stiffness*s.phaseError+(j.damping+dt*j.stiffness)*s.speedError)/(1+dt*(j.damping+dt*j.stiffness)*denominator)));
      // Relative shaft rotation includes the pitching carrier. Its reaction
      // closes angular momentum and gives zero error for common rigid rotation.
      s.entries.forEach(({rb},i)=>rb.applyTorqueImpulse(obj(mul(s.worldAxes[i],s.jacobian[i]*impulse)),true));item.torque=impulse/dt;
    }
  }
  snapshot(){
    let kinetic=0,potential=0,springEnergy=0,maxError=0;
    const bodies=[...this.bodies.values()].map(({definition:b,rb})=>{
      const position=arr(rb.translation()),rotation=qa(rb.rotation()),velocity=arr(rb.linvel()),angularVelocity=arr(rb.angvel()),localOmega=rotate(inverse(rotation),angularVelocity),mass=b.type==='fixed'?0:b.mass;
      const ke=.5*mass*dot(velocity,velocity)+(b.type==='fixed'?0:.5*dot(inertia(b),localOmega.map(x=>x*x))),pe=-mass*dot(this.model.gravity,position);kinetic+=ke;potential+=pe;
      return {id:b.id,name:b.name,type:b.type,shape:b.shape,size:b.size,appearance:b.appearance,mass,position,rotation,velocity,angularVelocity,acceleration:this.acceleration.get(b.id).slice(),displacement:sub(position,b.position),kinetic:ke,potential:pe};
    });
    const joints=[...this.joints.values()].map(item=>{
      if(item.definition.type==='gear'){const j=item.definition,s=this.gearState(item);return {id:j.id,name:j.name,type:j.type,a:arr(s.entries[0].rb.translation()),b:arr(s.entries[1].rb.translation()),axis:s.worldAxes[0],coordinate:item.angles[1],error:0,springForce:null,phaseError:s.phaseError,speedError:s.speedError,transmittedTorque:item.torque};}
      const {definition:j,joint,a,b,axisA}=item,A=this.bodies.get(j.a).rb,B=this.bodies.get(j.b).rb,qA=qa(A.rotation()),qB=qa(B.rotation()),ra=rotate(qA,a),rb=rotate(qB,b),pa=add(arr(A.translation()),ra),pb=add(arr(B.translation()),rb),delta=sub(pb,pa),distance=norm(delta),axis=rotate(qA,axisA);
      let coordinate=null,error=0,springForce=null;
      if(j.type==='prismatic'){coordinate=dot(delta,axis);error=norm(sub(delta,mul(axis,coordinate)));}
      else if(j.type==='planar'){coordinate=null;error=Math.abs(dot(delta,axis));}
      else if(j.type==='spring'){coordinate=distance;springEnergy+=.5*j.stiffness*(distance-j.restLength)**2;const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],va=add(arr(A.linvel()),cross(arr(A.angvel()),ra)),vb=add(arr(B.linvel()),cross(arr(B.angvel()),rb));springForce=j.stiffness*(distance-j.restLength)+j.damping*dot(sub(vb,va),mul(delta,1/Math.max(distance,1e-9)));}
      else error=distance;
      if(j.type==='revolute'){
        const solverA=qa(this.bodies.get(j.a).solverBody.rotation()),solverB=qa(this.bodies.get(j.b).solverBody.rotation());
        const relative=qmul(inverse(qmul(solverA,qa(joint.frameX1()))),qmul(solverB,qa(joint.frameX2())));let angle=2*Math.atan2(relative[0],relative[3]);angle=Math.atan2(Math.sin(angle),Math.cos(angle));
        if(item.previousAngle===null)item.unwrapped=angle;else item.unwrapped+=Math.atan2(Math.sin(angle-item.previousAngle),Math.cos(angle-item.previousAngle));item.previousAngle=angle;coordinate=item.unwrapped+(j.angleOffset??0);
      }
      maxError=Math.max(maxError,error);return {id:j.id,name:j.name,type:j.type,a:pa,b:pb,axis,coordinate,error,springForce};
    });
    if(bodies.some(b=>[...b.position,...b.rotation,...b.velocity,...b.angularVelocity].some(x=>!Number.isFinite(x))))throw Error('求解出现非有限数值，请减小时间步或检查模型');
    const frame={time:this.time,steps:this.steps,bodies,joints,kinetic,potential,springEnergy,energy:kinetic+potential+springEnergy,maxError,clock:this.clock.snapshot()};
    frame.loadResponses=this.loadProgram.results(frame);return frame;
  }
  // Mixed-domain transactions also restore Rapier's contact/joint caches, not
  // merely displayed poses. Keep body entries stable for coupling references.
  backupRigid(){return {world:this.world.takeSnapshot(),previousVelocity:structuredClone(this.previousVelocity),acceleration:structuredClone(this.acceleration),
    joints:[...this.joints].map(([id,item])=>[id,Object.fromEntries(Object.entries(item).filter(([k])=>k!=='joint').map(([k,v])=>[k,structuredClone(v)]))])};}
  restoreRigid(data){
    const replacement=RAPIER.World.restoreSnapshot(data.world),old=this.world;this.world=replacement;
    for(const b of this.bodies.values()){const raw=replacement.getRigidBody(b.solverBody.handle);b.solverBody=raw;b.rb=geometryBody(raw,b.q0);}
    for(const [id,state] of data.joints){const item=this.joints.get(id),handle=item.joint?.handle;Object.assign(item,structuredClone(state));if(handle!==undefined)item.joint=replacement.getImpulseJoint(handle);}
    this.previousVelocity=structuredClone(data.previousVelocity);this.acceleration=structuredClone(data.acceleration);old.free();
  }
  free(){this.world.free();}
}
export class MotionHistory{
  constructor(){this.frames=[];this.interval=1/60;}
  record(frame,force=false){
    if(frame.particles)this.interval=Math.max(1/60,frame.particles.byteLength*61/(32*1024*1024));
    if(this.frames.length>=6001)throw Error('回放记录已达上限，请重置后继续');
    if(force||!this.frames.length||frame.time-this.frames.at(-1).time>=this.interval-1e-9){if(this.frames.at(-1)?.time===frame.time)return;
      if(frame.particles&&(this.frames.length+1)*frame.particles.byteLength>48*1024*1024)throw Error('耦合回放达到内存上限，请导出结果后重置');
      // Immutable display meshes are shared across replay frames; only changing
      // physical state needs copying (otherwise a bicycle duplicates its road 3600 times).
      const saved=structuredClone({...frame,bodies:frame.bodies.map(b=>Object.isFrozen(b.appearance)?{...b,appearance:null}:b)});
      saved.bodies.forEach((b,i)=>{if(Object.isFrozen(frame.bodies[i].appearance))b.appearance=frame.bodies[i].appearance;});this.frames.push(saved);}
  }
  at(index){return this.frames[Math.max(0,Math.min(this.frames.length-1,Math.round(index)))];}
  csv(){const quote=x=>'"'+String(x).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"',rows=['time_s,body_id,body_name,x_m,y_m,z_m,qx,qy,qz,qw,vx_m_s,vy_m_s,vz_m_s,wx_rad_s,wy_rad_s,wz_rad_s,ax_m_s2,ay_m_s2,az_m_s2,kinetic_J,potential_J'];for(const f of this.frames)for(const b of f.bodies)rows.push([f.time,quote(b.id),quote(b.name),...b.position,...b.rotation,...b.velocity,...b.angularVelocity,...(f.time===0?['','','']:b.acceleration),b.kinetic,b.potential].join(','));return rows.join('\n');}
}
