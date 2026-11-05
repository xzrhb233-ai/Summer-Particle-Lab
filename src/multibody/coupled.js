import {PairContacts} from './pair-contact.js';
import {MultibodySimulation} from './engine.js';
import {Simulation3} from '../three/simulation.js';
import {MATERIALS} from '../materials.js';
import {enthalpyAt} from '../thermal.js';
import {LENGTH as L,MAX_COUPLED_PARTICLES,couplingParameters} from './coupling-model.js';
import {surface,contactImpulse,contactBounds,withinBounds,arr,qa,cross} from './contact.js';
import {add,sub,mul,norm,rotate,inverse,quaternion} from './model.js';
import {geometryParameters,insideGeometry} from '../three/discretization.js';
import {RegionAttachments} from './attachments.js';
import {PhysicsClock} from '../simulation/physics-clock.js';

export class CoupledSimulation extends MultibodySimulation{
  constructor(input){
    super(input);this.particles=null;
    if(!this.model.coupling?.enabled)return;
    try{
      const c=this.model.coupling,s=this.particles=new Simulation3();s.reset('empty');s.settings.gravity=false;s.settings.thermal=false;s.settings.stiffness=c.stiffness;s.energySafePressure=true;
      const d=c.domain;s.configureDomain({...d,lower:d.lower.map(x=>x/L),upper:d.upper.map(x=>x/L),cellSize:d.cellSize/L});
      const geometries=[];
      for(const p of c.parts){
        const definition={...p,material:p.method==='pbf'?2:11,center:p.center.map(x=>x/L),size:p.size.map(x=>x/L),velocity:p.velocity.map(x=>x/L)},geometry=geometryParameters(definition,s.domain),start=s.count;
        for(let i=0;i<start;i++)if(insideGeometry(geometry,[s.x[i],s.y[i],s.z[i]]))throw Error('MPM 试样互相重叠，请调整位置');
        s.createGeometry(definition);
        const fixedCounts=(p.fixedRegions??[]).map(()=>0);
        for(let i=start;i<s.count;i++){
          s.mass[i]*=p.density/MATERIALS[s.material[i]].density;s.invMass[i]=s.pinned[i]?0:1/s.mass[i];
          if(p.fixedRegions){
            const local=rotate(inverse(quaternion(p.rotation)),sub([s.x[i]*L,s.y[i]*L,s.z[i]*L],p.center));
            let pinned=false;
            p.fixedRegions.forEach((r,k)=>{if(r.type==='whole'||local.every((x,k)=>x>=r.lower[k]-1e-9&&x<=r.upper[k]+1e-9)){fixedCounts[k]++;pinned=true;}});
            if(pinned)s.pin(i,true);
          }
          // A directly sampled pool has no inherited solid packing to relax.
          // Melt handoff would repeatedly accept a compressed density baseline.
          if(p.method==='pbf')s.fluidTransition[i]=0;
        }
        if(fixedCounts.some(n=>!n))throw Error('固定选择集未包含材料点，请检查局部坐标和粒子间距');
        for(let i=start;i<s.count;i++)if(geometries.some(g=>insideGeometry(g,[s.x[i],s.y[i],s.z[i]])))throw Error('MPM 试样互相重叠，请调整位置');
        geometries.push(geometry);if(s.count>MAX_COUPLED_PARTICLES)throw Error('耦合工作区最多 16384 粒子，请增大间距');
      }
      s.projectDensityRatios=[1,...c.parts.map(p=>p.density/MATERIALS[p.method==='pbf'?2:11].density)];
      s.projectPartCount=c.parts.length;s.separatePartGrids=c.parts.length>1;
      this.bodyHeat=new Map();this.contact=new Map();this.externalHeat=0;this.exchanged=0;this.maxPenetration=0;
      for(const [id,b] of this.bodies){b.rb.recomputeMassPropertiesFromColliders();this.bodyHeat.set(id,{...b.definition.thermal,capacity:b.definition.mass*b.definition.thermal.cp,energy:b.definition.mass*b.definition.thermal.cp*b.definition.thermal.temperature});this.contact.set(id,{impulse:[0,0,0],torque:[0,0,0],heat:0});}
      this.attachments=new RegionAttachments(this);this.pairContacts=new PairContacts(this);
      s.particlePairAllowed=(i,j)=>this.pairContacts.fluidProfile(i,j)?.mechanical!==false;
      s.particlePairExplicit=(i,j)=>!!this.pairContacts.fluidProfile(i,j);
      s.recordPressurePair=(i,j,J)=>this.pairContacts.recordPressure(i,j,J);
      // Bound material may lie inside its own clamp; every other deep overlap
      // remains invalid. The bound pair does not also receive contact impulses.
      for(let i=0;i<s.count;i++)for(const b of this.bodies.values())if(this.pairContacts.config(b.definition.id,i).mechanical&&!this.attachments.ignores(b.definition.id,i)&&surface(b,[s.x[i]*L,s.y[i]*L,s.z[i]*L]).distance<-.1*s.domain.spacing*L)throw Error('MPM 初始几何与刚体重叠，请调整位置');
      s.externalGridContact=(grid,dt)=>{this.gridContact(grid,dt);this.attachments.solve(grid,dt);};
      this.initialThermal=this.totalThermal();this.lastDt=0;
      this.clock=new PhysicsClock(Math.min(this.model.dt,1/480));
    }catch(e){this.free();throw e;}
  }
  bodyImpulse(id,impulse,point){const c=this.contact.get(id),b=this.bodies.get(id);c.impulse=add(c.impulse,mul(impulse,-1));c.torque=add(c.torque,cross(sub(point,arr(b.rb.translation())),mul(impulse,-1)));}
  gridContact(grid,dt){
    if(this.pairContacts.enabled||grid.fields)return this.pairContacts.gridContact(grid,dt);
    if(!this.model.coupling.mechanical)return;
    const {mass,v,N,O,H}=grid,skin=H*L*.25,s=this.particles;
    for(const [id,b] of this.bodies){
      // Activate only the stencils of particles whose represented volumes touch
      // the collider. Otherwise B-spline tails create a visible insulating gap.
      const nodes=new Set(),band=s.domain.spacing*L*.6,bounds=contactBounds(b,band);
      for(let p=0;p<s.count;p++)if(!this.attachments?.ignores(id,p)&&s.isSolid(p)&&!s.pinned[p]&&withinBounds(bounds,s.x[p]*L,s.y[p]*L,s.z[p]*L)&&surface(b,[s.x[p]*L,s.y[p]*L,s.z[p]*L]).distance<=band){
        const [x,y,z]=grid.base.subarray(p*3,p*3+3);
        for(let k=0;k<3;k++)for(let j=0;j<3;j++)for(let i=0;i<3;i++)nodes.add(((z+k)*N+y+j)*N+x+i);
      }
      for(const n of nodes)if(mass[n]>1e-10&&!grid.fixed[n]){
        const point=[O[0]+(n%N)*H,O[1]+(Math.floor(n/N)%N)*H,O[2]+Math.floor(n/(N*N))*H].map(x=>x*L);
        const hit=surface(b,point),velocity=[v[n*3]*L,v[n*3+1]*L,v[n*3+2]*L];
        if(hit.distance>skin)continue;
        const result=contactImpulse(b,point,velocity,mass[n],hit.normal,this.model.coupling.friction,b.definition.restitution);
        for(let a=0;a<3;a++)v[n*3+a]=result.velocity[a]/L;this.bodyImpulse(id,result.impulse,point);this.diagnostics?.recordContact(result);
      }
    }
  }
  particleContact(dt,fluidOnly=false,indices=null){
    const s=this.particles,radius=s.domain.spacing*L*.4,bodies=[...this.bodies].map(([id,b])=>[id,b,contactBounds(b,radius)]);
    for(let row=0;row<(indices?.length??s.count);row++){const i=indices?indices[row]:row;if(!s.pinned[i]&&(!fluidOnly||!s.isSolid(i)))for(const [id,b,bounds] of bodies){
      const profile=this.pairContacts.config(id,i);if(!profile.mechanical||this.attachments?.ignores(id,i))continue;
      if(!withinBounds(bounds,s.x[i]*L,s.y[i]*L,s.z[i]*L))continue;
      const point=[s.x[i]*L,s.y[i]*L,s.z[i]*L],hit=surface(b,point);
      // PBF has no grid transfer: resolve its contact at the particle instead.
      if(!s.isSolid(i)&&hit.distance<=radius){const slip=this.pairContacts.slip(b,point,[s.vx[i]*L,s.vy[i]*L,s.vz[i]*L],hit.normal);const result=contactImpulse(b,point,[s.vx[i]*L,s.vy[i]*L,s.vz[i]*L],s.mass[i],hit.normal,profile.friction,b.definition.restitution);for(const [a,k] of ['vx','vy','vz'].entries())s[k][i]=result.velocity[a]/L;this.bodyImpulse(id,result.impulse,point);this.diagnostics?.recordContact(result);this.pairContacts.record(profile,result,point,hit.normal,slip);}
      // Position-only cleanup, never divided by dt or fed back as velocity.
      const penetration=Math.max(0,radius-hit.distance);this.maxPenetration=Math.max(this.maxPenetration,penetration);this.pairContacts.depth(profile,penetration);
      if(penetration>0){const shift=Math.min(penetration,s.domain.cellSize*L*.25);for(const [a,k] of ['x','y','z'].entries())s[k][i]+=hit.normal[a]*shift/L;}
    }}
  }
  totalThermal(){let sum=0;const s=this.particles;for(let i=0;i<s.count;i++)sum+=s.mass[i]*s.enthalpy[i];for(const t of this.bodyHeat.values())sum+=t.energy;return sum;}
  heatStep(dt){
    const s=this.particles,c=this.model.coupling,records=[...this.bodyHeat.entries()],count=s.count;
    // Continuous heaters/coolers use actual watts, including a finite lower bound.
    for(const [,t] of records){const next=Math.max(-273.15*t.capacity,t.energy+t.power*dt);this.externalHeat+=next-t.energy;t.energy=next;t.temperature=t.energy/t.capacity;}
    const heater=this.effectiveHeater??c.heater,heated=[];let heatedMass=0;
    if(heater.power)for(let i=0;i<count;i++)if(Math.hypot(s.x[i]*L-heater.center[0],s.y[i]*L-heater.center[1],s.z[i]*L-heater.center[2])<=heater.radius){heated.push(i);heatedMass+=s.mass[i];}
    for(const i of heated){const mat=s.material[i],cold=[2,3,4].includes(mat)?4:mat;const next=Math.max(enthalpyAt(cold,-273.15),s.enthalpy[i]+heater.power*dt/heatedMass);this.externalHeat+=s.mass[i]*(next-s.enthalpy[i]);s.enthalpy[i]=next;s.phaseTransition(i);}
    if(!c.thermal&&!this.pairContacts.definitions.some(p=>p.thermal))return;
    const capacity=new Float64Array(count+records.length),temperature=new Float64Array(capacity.length),budget=new Float64Array(capacity.length),heat=new Float64Array(capacity.length),pairs=[];
    for(let i=0;i<count;i++){capacity[i]=s.mass[i]*MATERIALS[s.material[i]].cp;temperature[i]=s.temperature[i];}
    records.forEach(([,t],k)=>{capacity[count+k]=t.capacity;temperature[count+k]=t.temperature;});
    const pair=(i,j,g)=>{if(g>0){pairs.push({i,j,g});budget[i]+=g;budget[j]+=g;}};
    s.buildGrid();
    for(let i=0;i<count;i++)s.near(i,(j,x,y,z,r,q)=>{
      if(j<=i)return;
      const a=MATERIALS[s.material[i]],b=MATERIALS[s.material[j]],pi=s.lab.part[i]-1,pj=s.lab.part[j]-1,profile=this.pairContacts.materials[pi][pj];
      const li=Math.cbrt(s.volume[i]*.001),lj=Math.cbrt(s.volume[j]*.001),area=Math.min(li*li,lj*lj);
      if(pi!==pj&&(profile.explicit||(c.parts[pi].method==='mpm'&&c.parts[pj].method==='mpm'))){
        if(!profile.thermal||!profile.contactConductance)return;
        const reach=(li+lj)*.55,distance=r*L;if(distance>=reach)return;
        const g=c.thermalScale*area*Math.max(0,1-distance/reach)/(1/profile.contactConductance+li*.5/a.conductivity+lj*.5/b.conductivity);
        pair(i,j,g);if(g>0){pairs.at(-1).profile=profile;pairs.at(-1).sign=profile.sign;}
      }else if(c.thermal)pair(i,j,c.thermalScale*2*a.conductivity*b.conductivity/(a.conductivity+b.conductivity)*area/(r*L)*q*q);
    });
    for(let i=0;i<count;i++){
      const p=[s.x[i]*L,s.y[i]*L,s.z[i]*L],mat=MATERIALS[s.material[i]],length=Math.cbrt(s.volume[i]*.001),radius=length*.5;
      records.forEach(([id,t],k)=>{const profile=this.pairContacts.config(id,i);if(!profile.thermal||!profile.contactConductance)return;const b=this.bodies.get(id),d=surface(b,p).distance;if(d>radius*1.5)return;const area=length*length*Math.max(0,Math.min(1,1-d/(radius*1.5)));const g=area/(1/profile.contactConductance+radius/mat.conductivity+Math.min(...b.definition.size)*.5/t.conductivity);pair(i,count+k,g*c.thermalScale);if(g>0)pairs.at(-1).profile=profile;});
    }
    for(let i=0;i<budget.length;i++)budget[i]=budget[i]?Math.min(1,.45*capacity[i]/(dt*budget[i])):1;
    for(const {i,j,g,profile,sign} of pairs){const Q=(temperature[j]-temperature[i])*g*dt*Math.min(budget[i],budget[j]);heat[i]+=Q;heat[j]-=Q;this.exchanged+=Math.abs(Q);if(profile)this.pairContacts.heat(profile,sign===undefined?-Q:Q*sign);}
    for(let i=0;i<count;i++){s.enthalpy[i]+=heat[i]/s.mass[i];s.phaseTransition(i);}
    records.forEach(([id,t],k)=>{t.energy+=heat[count+k];t.temperature=t.energy/t.capacity;this.contact.get(id).heat+=heat[count+k];});
  }
  step(dt=this.model.dt,emit=true){
    if(!this.particles)return super.step(dt);
    if(!Number.isFinite(dt)||dt<=0||dt>1/60)throw Error('时间步无效');
    const s=this.particles,initial=new Map([...this.bodies].map(([id,b])=>[id,arr(b.rb.linvel())])),end=this.time+dt;let substeps=0;
    this.lastDt=dt;this.partThermalLoads?.begin();this.pairContacts.begin();this.attachments.begin();this.maxPenetration=0;for(const c of this.contact.values()){c.impulse=[0,0,0];c.torque=[0,0,0];c.heat=0;}
    s.profile={constitutive:0,transfer:0,grid:0,fluid:0,thermal:0,diagnostics:0};
    while(end-this.time>1e-10){
      if(++substeps>512)throw Error('耦合子步过多，已暂停；请减小载荷或检查模型');
      const solid=s.material.subarray(0,s.count).some((_,i)=>s.isSolid(i));
      let speed=1;for(const b of this.bodies.values())speed=Math.max(speed,norm(arr(b.rb.linvel()))+norm(arr(b.rb.angvel()))*norm(b.definition.size));
      const stable=Math.min(this.model.dt,1/480,solid?s.mpm.stableStep(s):1/480,s.domain.spacing*L*.2/speed);
      if(stable<1e-7)throw Error('耦合稳定步长过小，请减小载荷或检查接触');
      const tick=this.clock.next(this.time,end,stable,this.loadProgram.schedule()),h=tick.dt;
      this.advanceShared(tick,solid);
    }
    for(const [id,b] of this.bodies){const v=arr(b.rb.linvel());this.acceleration.set(id,mul(sub(v,initial.get(id)),1/dt));this.previousVelocity.set(id,v);}
    if(emit){s.mpm.refreshDiagnostics(s);return this.snapshot();}
  }
  // One externally scheduled tick; standalone step() uses the same kernel.
  advanceShared(tick,solid=this.particles.material.subarray(0,this.particles.count).some((_,i)=>this.particles.isSolid(i))){
    const s=this.particles,h=tick.dt;
      this.loadProgram.apply(this.time,h);
      for(let i=0;i<s.count;i++)if(!s.pinned[i])for(const [a,k] of ['vx','vy','vz'].entries())s[k][i]+=this.model.gravity[a]*h/L;
      s.substep(h,solid);this.world.timestep=h;this.diagnostics?.beforeRigid(h);this.solveGears(h);this.world.step();this.diagnostics?.afterRigid(h);this.time=tick.end;this.steps++;s.time=this.time;
      this.particleContact(h);const beforeHeat=s.energyObserver?.mark();this.heatStep(h);this.externalHeat+=this.partThermalLoads?.step(h)??0;this.attachments.releaseMelted();s.energyObserver?.record('phase',beforeHeat);
  }
  snapshot(){
    const frame=super.snapshot();if(!this.particles)return frame;
    const s=this.particles,data=new Float32Array(s.count*8);let mass=0,T=0,min=Infinity,max=-Infinity,stress=0,plastic=0,solids=0;
    for(let i=0;i<s.count;i++){data.set([s.x[i]*L,s.y[i]*L,s.z[i]*L,s.material[i]===2?2:s.damage[i]>=1?25:s.fractureMaterials[s.lab.part[i]]?.enabled?24:s.melted[i]?23:11+s.model[i],s.temperature[i],s.pinned[i],s.mpm.stress[i],s.mpm.plastic[i]],i*8);mass+=s.mass[i];T+=s.mass[i]*s.temperature[i];min=Math.min(min,s.temperature[i]);max=Math.max(max,s.temperature[i]);stress=Math.max(stress,s.mpm.stress[i]);plastic=Math.max(plastic,s.mpm.plastic[i]);solids+=s.isSolid(i)?1:0;}
    for(const b of frame.bodies){const t=this.bodyHeat.get(b.id),c=this.contact.get(b.id);b.temperature=t.temperature;b.heatCapacity=t.capacity;b.thermalEnergy=t.energy;b.contactForce=this.lastDt?mul(c.impulse,1/this.lastDt):[0,0,0];b.contactTorque=this.lastDt?mul(c.torque,1/this.lastDt):[0,0,0];b.contactHeatRate=this.lastDt?c.heat/this.lastDt:0;}
    frame.particleColorMode=this.model.coupling.parts.some(p=>p.method==='pbf'||p.fracture.enabled)?'material':'temperature';
    frame.particles=data;frame.particleRadius=s.domain.spacing*L*.35;
    frame.joints.push(...this.attachments.results(this.lastDt));
    frame.maxError=Math.max(frame.maxError,...frame.joints.map(j=>j.error));
    frame.coupling={damaged:Array.from(s.damage.subarray(0,s.count)).filter(d=>d>=1).length,count:s.count,solids,liquids:s.count-solids,mass,meanTemperature:mass?T/mass:0,minTemperature:s.count?min:0,maxTemperature:s.count?max:0,maxStress:stress,maxPlastic:plastic,thermalEnergy:this.totalThermal(),externalHeat:this.externalHeat,thermalResidual:this.totalThermal()-this.initialThermal-this.externalHeat,maxPenetration:this.maxPenetration,exchangedHeat:this.exchanged};
    if(!Number.isFinite(frame.coupling.thermalEnergy)||data.some(x=>!Number.isFinite(x)))throw Error('耦合求解出现非有限数值');
    frame.thermalLoads=this.partThermalLoads?.results(this.lastDt)??[];
    frame.contactPairs=this.pairContacts.results(this.lastDt);frame.loadResponses=this.loadProgram.results(frame);frame.clock=this.clock.snapshot();
    return frame;
  }
  setHeater(value){if(!this.particles)throw Error('请先启用耦合');const next=couplingParameters({...this.model.coupling,heater:{...this.model.coupling.heater,...value}}).heater;this.loadProgram.override('region-heat','mpm');this.model.coupling.heater=next;this.effectiveHeater={...next};}
  setThermalPower(id,power){if(!this.particles)throw Error('请先启用耦合');if(!Number.isFinite(power)||Math.abs(power)>1e7||!this.bodyHeat.has(id))throw Error('热源目标或功率无效');this.loadProgram.override('body-heat',id);this.bodyHeat.get(id).power=power;this.bodies.get(id).definition.thermal.power=power;}
}
