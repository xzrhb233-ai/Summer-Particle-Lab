import {dot,norm,sub,mul} from './model.js';
import {cross} from './contact.js';
const L=.025;

// Local point-cloud gap + mass-gradient normal; no tensile contact impulse.
// Particle domains are ellipsoids transported by F, not an exact surface mesh.
export function materialGridContact(engine,grid,dt){
  if(!grid.fields)return;
  const s=engine.particles,profiles=engine.pairContacts.materials,N=grid.N,H=grid.H,fields=grid.fields;
  // Grid support overlap is insufficient for contact. Broad-phase bins plus
  // directional particle-domain distances prevent projection-only false hits.
  const masks=new Uint32Array(s.count),bins=new Map();let bin=H*.5,maxSpeed=0;
  const radius=(p,n)=>{
    const F=s.mpm.F,t=p*9;
    return .5*Math.cbrt(64*s.volume[p])*Math.hypot(...[0,1,2].map(a=>F[t+a]*n[0]+F[t+3+a]*n[1]+F[t+6+a]*n[2]));
  };
  for(let p=0;p<s.count;p++)if(s.isSolid(p)){
    bin=Math.max(bin,Math.cbrt(64*s.volume[p])*Math.hypot(...s.mpm.F.subarray(p*9,p*9+9)));
    maxSpeed=Math.max(maxSpeed,Math.hypot(s.vx[p],s.vy[p],s.vz[p]));
  }
  bin+=2*maxSpeed*dt+H*.002;
  const cell=p=>[Math.floor(s.x[p]/bin),Math.floor(s.y[p]/bin),Math.floor(s.z[p]/bin)];
  for(let p=0;p<s.count;p++)if(s.isSolid(p)){const key=cell(p).join(',');if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}
  for(let p=0;p<s.count;p++)if(s.isSolid(p)){
    const [cx,cy,cz]=cell(p),a=s.lab.part[p];
    for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const q of bins.get([cx+x,cy+y,cz+z].join(','))??[]){
      const b=s.lab.part[q];if(q<=p||a===b||!profiles[a-1][b-1].mechanical)continue;
      const d=[s.x[q]-s.x[p],s.y[q]-s.y[p],s.z[q]-s.z[p]],r=norm(d);if(r<1e-10)continue;
      const normal=mul(d,1/r),gap=r-radius(p,normal)-radius(q,normal),vn=dot([s.vx[q]-s.vx[p],s.vy[q]-s.vy[p],s.vz[q]-s.vz[p]],normal);
      if(gap>H*.002+Math.max(0,-vn*dt))continue;
      masks[p]|=1<<b;masks[q]|=1<<a;
      const depth=Math.max(0,-gap)*L;engine.maxPenetration=Math.max(engine.maxPenetration,depth);engine.pairContacts.depth(profiles[a-1][b-1],depth);
    }
  }
  const clouds=new Map(),com=fields.map(()=>[0,0,0]),total=new Float64Array(fields.length);
  for(let p=0;p<s.count;p++)if(s.isSolid(p)){
    const part=s.lab.part[p],mass=s.mass[p],position=[s.x[p],s.y[p],s.z[p]];
    total[part]+=mass;for(let a=0;a<3;a++)com[part][a]+=mass*position[a]*L;
    const b=p*3,t=p*9,[bx,by,bz]=grid.base.subarray(b,b+3),w=grid.weights;
    const dw=[0,1,2].map(a=>{const f=grid.fraction[b+a];return [(f-1.5)/H,-2*(f-1)/H,(f-.5)/H];});
    for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++){
      const weight=w[t+x]*w[t+3+y]*w[t+6+z];if(weight<=1e-10)continue;
      const n=((bz+z)*N+by+y)*N+bx+x;
      if(!clouds.has(n))clouds.set(n,new Map());
      const row=clouds.get(n);if(!row.has(part))row.set(part,{ids:[],g:[0,0,0],center:[0,0,0],mask:0});
      const c=row.get(part);c.ids.push(p);c.mask|=masks[p];
      c.g[0]+=mass*dw[0][x]*w[t+3+y]*w[t+6+z];c.g[1]+=mass*w[t+x]*dw[1][y]*w[t+6+z];c.g[2]+=mass*w[t+x]*w[t+3+y]*dw[2][z];
      for(let a=0;a<3;a++)c.center[a]+=mass*weight*position[a];
    }
  }
  for(let a=1;a<fields.length;a++)if(total[a])com[a]=mul(com[a],1/total[a]);
  for(const [n,cloud] of clouds){
    const parts=[...cloud.keys()].sort((a,b)=>a-b);
    for(let u=0;u<parts.length;u++)for(let v=u+1;v<parts.length;v++){
      const a=parts[u],b=parts[v],profile=profiles[a-1][b-1];if(!profile.mechanical)continue;
      const fa=fields[a],fb=fields[b],ma=fa.mass[n],mb=fb.mass[n];if(ma<1e-10||mb<1e-10)continue;
      const ca=cloud.get(a),cb=cloud.get(b),difference=sub(mul(cb.center,1/mb),mul(ca.center,1/ma));
      if(!(ca.mask&(1<<b))||!(cb.mask&(1<<a)))continue;
      let normal=sub(mul(cb.g,1/mb),mul(ca.g,1/ma));if(norm(normal)<1e-8)normal=difference;
      if(norm(normal)<1e-10)continue;normal=mul(normal,1/norm(normal));if(dot(normal,difference)<0)normal=mul(normal,-1);
      const extent=p=>{
        const F=s.mpm.F,t=p*9,ft=[0,1,2].map(a=>F[t+a]*normal[0]+F[t+3+a]*normal[1]+F[t+6+a]*normal[2]);
        return .5*Math.cbrt(64*s.volume[p])*norm(ft);
      };
      let upper=-Infinity,lower=Infinity;
      for(const p of ca.ids)upper=Math.max(upper,dot([s.x[p],s.y[p],s.z[p]],normal)+extent(p));
      for(const p of cb.ids)lower=Math.min(lower,dot([s.x[p],s.y[p],s.z[p]],normal)-extent(p));
      const gap=(lower-upper)*L,va=Array.from(fa.v.subarray(n*3,n*3+3),x=>x*L),vb=Array.from(fb.v.subarray(n*3,n*3+3),x=>x*L);
      const relative=sub(vb,va),vn=dot(relative,normal),skin=H*L*.002;
      if(gap>skin+Math.max(0,-vn*dt))continue;
      const ia=fa.fixed[n]?0:1/ma,ib=fb.fixed[n]?0:1/mb,W=ia+ib;if(!W)continue;
      const jn=Math.max(0,-vn-Math.max(0,gap-skin)/dt)/W,tangent=sub(relative,mul(normal,vn)),speed=norm(tangent);
      const jt=Math.min(profile.friction*jn,speed/W),J=normal.map((v,k)=>jn*v-(speed>1e-12?jt*tangent[k]/speed:0));
      for(let k=0;k<3;k++){fa.v[n*3+k]-=J[k]*ia/L;fb.v[n*3+k]+=J[k]*ib/L;}
      engine.diagnostics?.recordContact({normalWork:jn*vn+.5*jn*jn*W,frictionWork:-jt*speed+.5*jt*jt*W});
      const stats=engine.pairContacts.stats.get(profile.id);if(!stats)continue;
      const point=[grid.O[0]+n%N*H,grid.O[1]+Math.floor(n/N)%N*H,grid.O[2]+Math.floor(n/N/N)*H].map(x=>x*L);
      const force=mul(J,-profile.sign),torque=cross(sub(point,com[profile.sign===1?a:b]),force);
      for(let k=0;k<3;k++){stats[k]+=force[k];stats[k+3]+=torque[k];stats[k+7]+=(J[k]-jn*normal[k])*-profile.sign;}
      stats[6]+=jn;stats[10]+=speed;stats[11]++;
    }
  }
}
