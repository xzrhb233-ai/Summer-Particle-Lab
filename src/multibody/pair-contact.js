import {contactProfiles,materialProfiles,contactPairResult} from '../simulation/contact-pairs.js';
import {materialGridContact} from './material-contact.js';
import {surface,contactBounds,withinBounds,contactImpulse,arr,obj,cross} from './contact.js';
import {sub,mul,norm,dot} from './model.js';
import {LENGTH as L} from './coupling-model.js';

export class PairContacts{
  constructor(engine){
    this.engine=engine;this.definitions=engine.model.contactPairs;
    this.enabled=!!this.definitions.length;this.profiles=contactProfiles(engine.model);
    this.materials=materialProfiles(engine.model);
    this.bodyIds=[...engine.bodies.keys()];this.bodyIndices=new Map(this.bodyIds.map((id,i)=>[id,i]));
    const parts=engine.model.coupling.parts;
    this.fluidIds=new Set(this.definitions.filter(p=>{const a=parts.find(b=>b.id===p.a),b=parts.find(b=>b.id===p.b);return a&&b&&a.method!==b.method;}).map(p=>p.id));
    this.stats=new Map(this.definitions.map(p=>[p.id,new Float64Array(this.fluidIds.has(p.id)?19:16)]));
    this.mass=null;this.delta=null;
  }
  config(body,particle){return this.profiles[this.bodyIndices.get(body)][this.engine.particles.lab.part[particle]-1];}
  fluidProfile(i,j){
    const s=this.engine.particles,a=s.lab.part[i]-1,b=s.lab.part[j]-1,c=this.engine.model.coupling;
    if(a===b||c.parts[a].method===c.parts[b].method)return null;
    const p=this.materials[a][b];return p.explicit?p:null;
  }
  recordPressure(i,j,J){
    const profile=this.fluidProfile(i,j);if(!profile)return;
    const v=this.stats.get(profile.id),s=this.engine.particles,force=J.map(x=>x*profile.sign);
    // Torque about the reference centre of authored A; impulse is the velocity
    // part of PBF projection only, excluding position-only stabilization.
    const center=this.engine.model.coupling.parts.find(p=>p.id===profile.a).center;
    const point=[s.x[i],s.y[i],s.z[i]].map(x=>x*L),torque=cross(sub(point,center),force);
    for(let k=0;k<3;k++){v[k]+=force[k];v[k+3]+=torque[k];v[16+k]+=force[k];}
    v[6]+=norm(J);v[11]++;
  }
  begin(){for(const v of this.stats.values()){const total=v[14],impulse=v.slice(16);v.fill(0);v[14]=total;v.set(impulse,16);}}
  record(profile,result,point,normal,slip){
    const v=this.stats.get(profile.id);if(!v)return;
    const body=this.engine.bodies.get(profile.a),J=result.impulse,jn=Math.max(0,dot(J,normal)),torque=cross(sub(point,arr(body.rb.translation())),mul(J,-1));
    for(let a=0;a<3;a++){v[a]-=J[a];v[3+a]+=torque[a];v[7+a]-=J[a]-jn*normal[a];}
    v[6]+=jn;v[10]+=slip;v[11]++;
  }
  depth(profile,value){const v=this.stats.get(profile.id);if(v)v[12]=Math.max(v[12],value);}
  heat(profile,intoBody){const v=this.stats.get(profile.id);if(v){v[13]+=intoBody;v[14]+=intoBody;v[15]++;}}
  results(duration){return this.definitions.map(p=>{
    const result=contactPairResult(p,this.stats.get(p.id),duration),parts=this.engine.model.coupling.parts;
    const a=parts.find(b=>b.id===p.a),b=parts.find(b=>b.id===p.b);
    if(a&&b&&a.method!==b.method)Object.assign(result,{scheme:'mpm-pbf-pressure/1',oppositeForce:result.force.map(x=>-x),totalImpulse:Array.from(this.stats.get(p.id).slice(16)),maxPenetration:null,slipSpeed:null});
    return result;
  });}
  raw(){return this.definitions.map(p=>({id:p.id,values:[...this.stats.get(p.id)]}));}
  slip(body,point,velocity,normal){
    const relative=sub(velocity,body.definition.type==='fixed'?[0,0,0]:arr(body.rb.velocityAtPoint(obj(point))));
    return norm(sub(relative,mul(normal,dot(relative,normal))));
  }
  gridContact(grid,dt){
    const {engine:e}=this,s=e.particles,{N,H,O,v,fixed}=grid,parts=e.model.coupling.parts.length;
    if(grid.fields){
      s.contactGridDeltas=null;materialGridContact(e,grid,dt);
      this.mass=grid.fields.slice(1).map(f=>f.mass);
    }else{
    if(!this.mass||this.mass[0].length!==grid.mass.length){
      this.mass=Array.from({length:parts},()=>new Float64Array(grid.mass.length));
      this.delta=Array.from({length:parts},()=>new Float64Array(v.length));
    }
    for(const x of this.mass)x.fill(0);for(const x of this.delta)x.fill(0);
    s.contactGridDeltas=[null,...this.delta];
    for(let p=0;p<s.count;p++)if(s.isSolid(p)){
      const [bx,by,bz]=grid.base.subarray(p*3,p*3+3),w=grid.weights,t=p*9,m=this.mass[s.lab.part[p]-1];
      for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)m[((bz+z)*N+by+y)*N+bx+x]+=s.mass[p]*w[t+x]*w[t+3+y]*w[t+6+z];
    }
    }
    for(const [bi,id] of this.bodyIds.entries()){
      const b=e.bodies.get(id),band=s.domain.spacing*L*.6,bounds=contactBounds(b,band),nodes=Array.from({length:parts},()=>new Set());
      for(let p=0;p<s.count;p++){
        const part=s.lab.part[p]-1;
        if(!this.profiles[bi][part].mechanical||e.attachments.ignores(id,p)||!s.isSolid(p)||s.pinned[p])continue;
        if(!withinBounds(bounds,s.x[p]*L,s.y[p]*L,s.z[p]*L)||surface(b,[s.x[p]*L,s.y[p]*L,s.z[p]*L]).distance>band)continue;
        const [bx,by,bz]=grid.base.subarray(p*3,p*3+3);
        for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)nodes[part].add(((bz+z)*N+by+y)*N+bx+x);
      }
      for(let part=0;part<parts;part++)for(const n of nodes[part]){
        const mass=this.mass[part][n],field=grid.fields?.[part+1],d=field?.v??this.delta[part],profile=this.profiles[bi][part];
        if(mass<=1e-10||(field?.fixed??fixed)[n])continue;
        const point=[O[0]+n%N*H,O[1]+Math.floor(n/N)%N*H,O[2]+Math.floor(n/(N*N))*H].map(x=>x*L),hit=surface(b,point);
        if(hit.distance>H*L*.25)continue;
        const velocity=[0,1,2].map(a=>((field?0:v[n*3+a])+d[n*3+a])*L),slip=this.slip(b,point,velocity,hit.normal);
        const result=contactImpulse(b,point,velocity,mass,hit.normal,profile.friction,b.definition.restitution);
        for(let a=0;a<3;a++)d[n*3+a]=result.velocity[a]/L-(field?0:v[n*3+a]);
        e.bodyImpulse(id,result.impulse,point);e.diagnostics?.recordContact(result);this.record(profile,result,point,hit.normal,slip);
      }
    }
  }
}
