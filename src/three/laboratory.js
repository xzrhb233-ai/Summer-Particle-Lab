export const MAX_PARTS=128;
export class Laboratory {
  constructor(s,capacity){this.s=s;this.part=new Int32Array(capacity);this.reference=new Float64Array(capacity*3);this.reset();}
  reset(){this.names=new Map([[0,'未分组']]);this.definitions=new Map();this.nextId=1;}
  insert(i){this.part[i]=0;this.reference.set([this.s.x[i],this.s.y[i],this.s.z[i]],i*3);}
  remove(i,last){this.part[i]=this.part[last];this.reference.copyWithin(i*3,last*3,last*3+3);}
  register(start,name=''){const id=this.nextId++;this.names.set(id,String(name).trim().slice(0,48)||`部件 ${id}`);this.part.fill(id,start,this.s.count);return id;}
  snapshot(){
    const s=this.s,parts=new Map();
    for(let i=0;i<s.count;i++){
      const id=this.part[i];if(!parts.has(id))parts.set(id,{id,name:this.names.get(id),count:0,mass:0,center:[0,0,0],velocity:[0,0,0],kinetic:0,maxSpeed:0,displacement:0,pinned:0,stress:0,plastic:0,bounds:[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]});
      const p=parts.get(id),m=s.mass[i],x=[s.x[i],s.y[i],s.z[i]],v=[s.vx[i],s.vy[i],s.vz[i]];
      p.count++;p.mass+=m;p.pinned+=s.pinned[i];
      for(let a=0;a<3;a++){p.center[a]+=m*x[a];p.velocity[a]+=m*v[a];p.bounds[0][a]=Math.min(p.bounds[0][a],x[a]);p.bounds[1][a]=Math.max(p.bounds[1][a],x[a]);}
      p.kinetic+=.5*m*(v[0]**2+v[1]**2+v[2]**2);p.maxSpeed=Math.max(p.maxSpeed,Math.hypot(...v));
      p.displacement=Math.max(p.displacement,Math.hypot(...x.map((v,a)=>v-this.reference[i*3+a])));
      p.stress=Math.max(p.stress,s.mpm.stress[i]);p.plastic=Math.max(p.plastic,s.mpm.plastic[i]);
    }
    for(const p of parts.values()){p.center=p.center.map(x=>x/p.mass);p.velocity=p.velocity.map(v=>v/p.mass);p.geometry=this.definitions.get(p.id)||null;}return [...parts.values()];
  }
  command(d){
    const id=d.id??-1,s=this.s;
    if(!Number.isInteger(id)||id < -1||id!==-1&&!this.names.has(id))return false;
    if(d.action==='rename'){if(id<0||typeof d.name!=='string'||!d.name.trim())return false;this.names.set(id,d.name.trim().slice(0,48));return true;}
    if(!['velocity','pin','release'].includes(d.action))return false;
    const v=d.velocity??[0,0,0],w=d.angular??[0,0,0];
    if(![[v,80],[w,1]].every(([a,max])=>Array.isArray(a)&&a.length===3&&a.every(x=>Number.isFinite(x)&&Math.abs(x)<=max)))return false;
    const parts=this.snapshot().filter(p=>id<0||p.id===id);if(!parts.length)return false;
    const mass=parts.reduce((a,p)=>a+p.mass,0),center=[0,1,2].map(a=>parts.reduce((sum,p)=>sum+p.center[a]*p.mass,0)/mass);
    for(let i=0;i<s.count;i++)if(id<0||this.part[i]===id){
      if(d.action==='velocity'&&!s.pinned[i]){
        const r=[s.x[i]-center[0],s.y[i]-center[1],s.z[i]-center[2]],cross=[w[1]*r[2]-w[2]*r[1],w[2]*r[0]-w[0]*r[2],w[0]*r[1]-w[1]*r[0]];
        [s.vx[i],s.vy[i],s.vz[i]]=v.map((x,a)=>Math.max(-160,Math.min(160,x+cross[a])));
        s.mpm.C.set([0,-w[2],w[1],w[2],0,-w[0],-w[1],w[0],0],i*9);
      }else if(d.action!=='velocity'){s.pin(i,d.action==='pin');s.vx[i]=s.vy[i]=s.vz[i]=0;s.mpm.C.fill(0,i*9,i*9+9);}
    }
    s.drag=null;return true;
  }
}
