import {bindingValue,bindingAverage,bindingUnit} from './curves.js';
import {sub,dot} from '../multibody/model.js';

const obj=v=>({x:v[0],y:v[1],z:v[2]});
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export class LoadProgram {
  constructor(engine){
    this.engine=engine;this.curves=new Map(engine.model.curves.map(c=>[c.id,c]));
    this.last=new Map();this.integrals=new Map();this.bodyLoads=new Map();this.motorTargets=new Map();
  }
  get bindings(){return this.engine.model.loadBindings.filter(b=>b.enabled);}
  schedule(time=this.engine.time){
    let nextEvent=60,maxDt=1/60;
    for(const b of this.bindings){
      const c=this.curves.get(b.curve),times=c.type==='sine'?[c.start,c.end]:c.points.map(p=>p[0]);
      for(const t of times)if(t>time+1e-10)nextEvent=Math.min(nextEvent,t);
      if(c.type==='sine'&&time>=c.start-1e-10&&time<c.end-1e-10)maxDt=Math.min(maxDt,1/(32*c.frequency));
    }
    return {nextEvent,maxDt};
  }
  limit(dt,time=this.engine.time){const s=this.schedule(time);return Math.min(dt,s.maxDt,s.nextEvent>time+1e-10?s.nextEvent-time:dt);}
  override(kind,target){
    for(const b of this.engine.model.loadBindings)if(b.kind===kind&&b.target===target)b.enabled=false;
  }
  apply(time,dt){
    const e=this.engine;
    this.bodyLoads=new Map([...e.bodies].map(([id,b])=>[id,{force:b.definition.force.slice(),torque:b.definition.torque.slice()}]));
    this.motorTargets.clear();
    if(e.bodyHeat)for(const [id,h] of e.bodyHeat)h.power=e.bodies.get(id).definition.thermal.power;
    if(e.model.coupling)e.effectiveHeater={...e.model.coupling.heater};
    const changed=new Set();
    for(const b of this.bindings){
      const c=this.curves.get(b.curve),j=e.joints.get(b.target);
      const value=b.kind==='motor-target'&&j.definition.motor.mode==='position'?bindingValue(b,c,time+dt):bindingAverage(b,c,time,dt);
      this.last.set(b.id,{value,start:time,end:time+dt});
      this.integrals.set(b.id,(this.integrals.get(b.id)??0)+bindingAverage(b,c,time,dt)*dt);
      if(b.kind==='body-force'||b.kind==='body-torque'){this.bodyLoads.get(b.target)[b.kind==='body-force'?'force':'torque'][b.component]=value;changed.add(b.target);}
      else if(b.kind==='body-heat')e.bodyHeat.get(b.target).power=value;
      else if(b.kind==='region-heat')e.effectiveHeater.power=value;
      else{
        const m=j.definition.motor;this.motorTargets.set(b.target,value);
        if(m.mode==='velocity')j.joint.configureMotorVelocity(value,m.damping);
        else j.joint.configureMotorPosition(value-(j.definition.angleOffset??0),m.stiffness,m.damping);
      }
    }
    for(const id of changed){
      const rb=e.bodies.get(id).rb,v=this.bodyLoads.get(id);
      rb.resetForces(true);rb.resetTorques(true);rb.addForce(obj(v.force),true);rb.addTorque(obj(v.torque),true);
    }
  }
  thermal(){return {heater:this.engine.effectiveHeater??this.engine.model.coupling?.heater,powers:[...(this.engine.bodyHeat?.values()??[])].map(t=>t.power)};}
  results(frame){
    return this.bindings.map(b=>{
      const j=this.engine.model.joints.find(j=>j.id===b.target),body=frame.bodies.find(x=>x.id===b.target);
      let response=null,responseUnit='';
      if(b.kind==='body-force'){response=body.velocity[b.component];responseUnit='m/s';}
      else if(b.kind==='body-torque'){response=body.angularVelocity[b.component];responseUnit='rad/s';}
      else if(b.kind.endsWith('heat')){response=b.kind==='body-heat'?body.temperature:frame.coupling?.meanTemperature;responseUnit='°C';}
      else{
        const f=frame.joints.find(x=>x.id===b.target);
        if(j.motor.mode==='position')response=f.coordinate;
        else{
          const A=frame.bodies.find(x=>x.id===j.a),B=frame.bodies.find(x=>x.id===j.b);
          const av=(x,p)=>{const w=cross(x.angularVelocity,sub(p,x.position));return x.velocity.map((v,k)=>v+w[k]);};
          response=dot(j.type==='revolute'?sub(B.angularVelocity,A.angularVelocity):sub(av(B,f.b),av(A,f.a)),f.axis);
        }
        responseUnit=bindingUnit(b,this.engine.model.joints);
      }
      const last=this.last.get(b.id),requested=bindingValue(b,this.curves.get(b.curve),frame.time);
      return {...b,unit:bindingUnit(b,this.engine.model.joints),requested,applied:last?.value??requested,
        intervalStart:last?.start??frame.time,intervalEnd:last?.end??frame.time,
        commandIntegral:this.integrals.get(b.id)??0,response:response??null,responseUnit};
    });
  }
}
