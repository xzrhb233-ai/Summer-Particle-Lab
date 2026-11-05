// Local binary IPC. Taichi owns particle integration; the existing Rapier and
// sequential contact solver own rigid motion and equal/opposite impulses.
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {toLegacy,fromLegacy} from '../src/simulation/project.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {attachParticleThermalLoads} from '../src/simulation/thermal-ports.js';
import {arr,qa,obj} from '../src/multibody/contact.js';
import {norm,sub,mul,add,rotate,inverse,inertia,quaternion} from '../src/multibody/model.js';
await initialize();
let engine=null,grid=null,active=[],buffer=Buffer.alloc(0);
function rigidState(){
  return [...engine.bodies.values()].flatMap(({definition:b,rb})=>{
    const q=qa(rb.rotation()),fixed=b.type==='fixed',I=inertia(b),inverseI=v=>fixed?[0,0,0]:rotate(q,rotate(inverse(q),v).map((x,k)=>x/I[k]));
    const columns=[[1,0,0],[0,1,0],[0,0,1]].map(inverseI);
    return [['box','sphere','cylinder','disc','torus'].indexOf(b.shape),...arr(rb.translation()),...q,...b.size.map(x=>x*.5),
      ...arr(rb.linvel()),...arr(rb.angvel()),fixed?0:1/b.mass,...[0,1,2].flatMap(a=>columns.map(c=>c[a])),b.restitution];
  });
}
function advance(dt,endTime){
  engine.loadProgram.apply(engine.time,dt);
  engine.world.timestep=dt;engine.solveGears(dt);engine.world.step();engine.time=endTime??engine.time+dt;engine.steps++;engine.particles.time=engine.time;
  let speed=1;
  for(const [id,b] of engine.bodies){
    const v=arr(b.rb.linvel());engine.acceleration.set(id,mul(sub(v,engine.previousVelocity.get(id)),1/dt));engine.previousVelocity.set(id,v);
    speed=Math.max(speed,norm(v)+norm(arr(b.rb.angvel()))*norm(b.definition.size));
  }
  return speed;
}
function respond(header,data=new Float32Array()){
  const json=Buffer.from(JSON.stringify(header)),size=Buffer.alloc(8);
  size.writeUInt32LE(json.length);size.writeUInt32LE(data.byteLength,4);
  process.stdout.write(Buffer.concat([size,json,Buffer.from(data.buffer,data.byteOffset,data.byteLength)]));
}
function dispatch(d,data){
  if(d.type==='init'){
    const project=validateGpuProject(d.project),model=toLegacy(project),next=new CoupledSimulation(model),s=next.particles;
    let partThermalLoads;try{partThermalLoads=attachParticleThermalLoads(project,next).descriptors();}catch(e){next.free();throw e;}
    const seed=new Float32Array(s.count*19);
    for(let i=0;i<s.count;i++)seed.set([s.x[i],s.y[i],s.z[i],s.model[i],s.enthalpy[i],s.pinned[i],s.yieldStrain[i],s.friction[i],s.mass[i],s.volume[i],s.lab.part[i],s.temperature[i],s.material[i],-1,0,0,0,s.melted[i],s.fluidTransition[i]],i*19);
    const bodyIds=[...next.bodies.keys()];
    const attachments=next.attachments.items.map((item,k)=>{
      for(const {i,local} of item.members)seed.set([k,...local],i*19+13);
      const q=quaternion(item.definition.frame.rotation),columns=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(q,v));
      return {...item.definition,bodyIndex:bodyIds.indexOf(item.definition.body),rotation:[0,1,2].flatMap(a=>columns.map(c=>c[a]))};
    });
    engine?.free();engine=next;active=[];
    grid={N:67,H:s.domain.cellSize,O:s.domain.origin,base:s.mpm.base,mass:new Float64Array(67**3),v:new Float64Array(67**3*3),fixed:new Uint8Array(67**3)};
    respond({ok:true,count:s.count,seedWidth:19,model:engine.model,domain:s.domain,speed:1,attachments,partThermalLoads,contactProfiles:engine.pairContacts.profiles,rigidState:rigidState(),schedule:engine.loadProgram.schedule()},seed);return;
  }
  if(!engine)throw Error('项目尚未初始化');
  if(d.endTime!==undefined&&(!Number.isFinite(d.endTime)||Math.abs(d.endTime-engine.time-d.dt)>1e-9))throw Error('无效物理时钟端点');
  if(d.type==='thermal-command'){
    const c=d.command;
    if(c?.type==='region-heat')engine.setHeater(c.value);
    else if(c?.type==='body-heat')engine.setThermalPower(c.id,c.power);
    else throw Error('不支持的在线热源命令');
    respond({ok:true,heater:engine.model.coupling.heater,powers:[...engine.bodyHeat.values()].map(t=>t.power),loadBindings:engine.model.loadBindings,schedule:engine.loadProgram.schedule()},new Float32Array(rigidState()));return;
  }
  if(d.type==='native-advance'){
    const s=engine.particles,B=engine.bodies.size,F=d.fluids,dt=d.dt;
    if(!Number.isInteger(F)||F<0||F>s.count||data.length!==B*12+F*8||!Number.isFinite(dt)||dt<=0||dt>1/60||data.some(x=>!Number.isFinite(x)))throw Error('无效 GPU 区域反作用数据');
    // Validate the entire compact packet before touching the live rigid state.
    const ids=[],seen=new Set();
    for(let row=0;row<F;row++){const id=data[B*12+row*8],phase=data[B*12+row*8+1];if(!Number.isInteger(id)||id<0||id>=s.count||![2,3,27].includes(phase)||seen.has(id))throw Error('无效 PBF 边界索引或相态');seen.add(id);ids.push(id);}
    if(d.begin){engine.pairContacts.begin();engine.lastDt=d.duration;for(const c of engine.contact.values()){c.impulse=[0,0,0];c.torque=[0,0,0];c.heat=0;}}
    let bindex=0;
    for(const [id,b] of engine.bodies){
      const offset=bindex++*12,c=engine.contact.get(id);
      if(b.definition.type!=='fixed'){b.rb.applyImpulse(obj([...data.subarray(offset,offset+3)]),true);b.rb.applyTorqueImpulse(obj([...data.subarray(offset+3,offset+6)]),true);}
      c.impulse=add(c.impulse,[...data.subarray(offset+6,offset+9)]);c.torque=add(c.torque,[...data.subarray(offset+9,offset+12)]);
    }
    for(const [row,i] of ids.entries()){
      const phase=data[B*12+row*8+1];s.material[i]=phase%16;s.melted[i]=phase>=16?1:0;s.pinned[i]=0;s.invMass[i]=1/s.mass[i];
      for(const members of engine.attachments.excluded.values())members.delete(i);
      for(const [a,k] of ['x','y','z','vx','vy','vz'].entries())s[k][i]=data[B*12+row*8+2+a];
    }
    if(F)engine.particleContact(dt,true,ids);
    const speed=advance(dt,d.endTime),updated=new Float32Array(B*28+F*6);updated.set(rigidState());
    for(const [row,i] of ids.entries())for(const [a,k] of ['x','y','z','vx','vy','vz'].entries())updated[B*28+row*6+a]=s[k][i];
    respond({ok:true,time:engine.time,speed,schedule:engine.loadProgram.schedule(),thermal:engine.loadProgram.thermal()},updated);return;
  }
  if(d.type==='step'){
    const s=engine.particles,n=d.nodes,dt=d.dt;
    if(!Number.isInteger(n)||n<0||n>67**3||data.length!==s.count*3+n*6||!Number.isFinite(dt)||dt<=0||dt>1/60||data.some(v=>!Number.isFinite(v)))throw Error('无效 GPU 接触数据');
    if(d.begin){engine.pairContacts.begin();engine.lastDt=d.duration;engine.maxPenetration=0;for(const c of engine.contact.values()){c.impulse=[0,0,0];c.torque=[0,0,0];c.heat=0;}}
    for(let i=0;i<s.count;i++){s.x[i]=data[3*i];s.y[i]=data[3*i+1];s.z[i]=data[3*i+2];s.mpm.stencil(s,i);}
    for(const index of active){grid.mass[index]=0;grid.fixed[index]=0;}active=[];
    for(let k=0;k<n;k++){const offset=s.count*3+k*6,index=data[offset];if(!Number.isInteger(index)||index<0||index>=67**3)throw Error('无效网格索引');active.push(index);grid.mass[index]=data[offset+1];grid.v.set(data.subarray(offset+2,offset+5),index*3);grid.fixed[index]=data[offset+5];}
    engine.gridContact(grid,dt);
    const updated=new Float32Array(n*3+(d.defer?0:engine.bodies.size*11));
    active.forEach((index,k)=>updated.set(grid.v.subarray(index*3,index*3+3),k*3));
    if(d.defer){respond({ok:true},updated);return;}
    engine.loadProgram.apply(engine.time,dt);
    engine.world.timestep=dt;engine.solveGears(dt);engine.world.step();engine.time=d.endTime??engine.time+dt;engine.steps++;s.time=engine.time;
    let k=n*3,speed=1;
    for(const [id,b] of engine.bodies){
      const v=arr(b.rb.linvel());engine.acceleration.set(id,mul(sub(v,engine.previousVelocity.get(id)),1/dt));engine.previousVelocity.set(id,v);
      speed=Math.max(speed,norm(v)+norm(arr(b.rb.angvel()))*norm(b.definition.size));
      updated.set([['box','sphere','cylinder','disc','torus'].indexOf(b.definition.shape),...arr(b.rb.translation()),...qa(b.rb.rotation()),...b.definition.size.map(x=>x*.5)],k);k+=11;
    }
    respond({ok:true,time:engine.time,speed,schedule:engine.loadProgram.schedule()},updated);return;
  }
  if(d.type==='advance'){
    const s=engine.particles,dt=d.dt;
    if(data.length!==s.count*6||!Number.isFinite(dt)||dt<=0||dt>1/60||data.some(v=>!Number.isFinite(v)))throw Error('无效 PBF 接触数据');
    for(let i=0;i<s.count;i++)for(const [a,k] of ['x','y','z','vx','vy','vz'].entries())s[k][i]=data[6*i+a];
    // PBF pressure has already been solved on GPU. Only boundary contact is
    // solved here; it applies equal/opposite impulses before Rapier advances.
    engine.particleContact(dt,true);
    const updated=new Float32Array(s.count*6+engine.bodies.size*11);
    for(let i=0;i<s.count;i++)for(const [a,k] of ['x','y','z','vx','vy','vz'].entries())updated[6*i+a]=s[k][i];
    engine.loadProgram.apply(engine.time,dt);
    engine.world.timestep=dt;engine.solveGears(dt);engine.world.step();engine.time=d.endTime??engine.time+dt;engine.steps++;
    let offset=s.count*6,speed=1;
    for(const [id,b] of engine.bodies){
      const v=arr(b.rb.linvel());engine.acceleration.set(id,mul(sub(v,engine.previousVelocity.get(id)),1/dt));engine.previousVelocity.set(id,v);
      speed=Math.max(speed,norm(v)+norm(arr(b.rb.angvel()))*norm(b.definition.size));
      updated.set([['box','sphere','cylinder','disc','torus'].indexOf(b.definition.shape),...arr(b.rb.translation()),...qa(b.rb.rotation()),...b.definition.size.map(x=>x*.5)],offset);offset+=11;
    }
    respond({ok:true,time:engine.time,speed,schedule:engine.loadProgram.schedule()},updated);return;
  }
  if(d.type==='snapshot'){
    const frame=MultibodySimulation.prototype.snapshot.call(engine);
    for(const b of frame.bodies){const t=engine.bodyHeat.get(b.id),c=engine.contact.get(b.id);delete b.appearance;b.temperature=t.temperature;b.heatCapacity=t.capacity;b.thermalEnergy=t.energy;b.contactForce=engine.lastDt?mul(c.impulse,1/engine.lastDt):[0,0,0];b.contactTorque=engine.lastDt?mul(c.torque,1/engine.lastDt):[0,0,0];b.contactHeatRate=0;}
    respond({ok:true,frame,pairContactStats:engine.pairContacts.raw()});return;
  }
  throw Error('不支持的本地求解命令');
}
process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length>=8){const jsonLength=buffer.readUInt32LE(),dataLength=buffer.readUInt32LE(4),size=8+jsonLength+dataLength;
    if(jsonLength>1_000_000||dataLength>16_000_000||dataLength%4){process.exitCode=1;process.stdin.destroy();return;}
    if(buffer.length<size)return;
    const packet=buffer.subarray(8,size);buffer=buffer.subarray(size);
    try{const header=JSON.parse(packet.subarray(0,jsonLength)),bytes=packet.subarray(jsonLength),data=new Float32Array(bytes.length/4);for(let i=0;i<data.length;i++)data[i]=bytes.readFloatLE(i*4);dispatch(header,data);}catch(e){respond({ok:false,message:e.message});}
  }
});
process.stdin.on('end',()=>{engine?.free();});
