import { MATERIALS } from './materials.js';

export class Structures {
  constructor(s) { this.s = s; this.edges = []; this.keys = new Set(); this.rigidDirty=true;this.rigidGroups=[]; }
  key(a,b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
  add(a,b,visible = false) {
    if (a === b || this.keys.has(this.key(a,b))) return;
    const s = this.s, rest = Math.hypot(s.x[a]-s.x[b], s.y[a]-s.y[b]);
    if (rest < .5) return;
    this.keys.add(this.key(a,b));
    this.rigidDirty=true;
    this.edges.push({ a,b,rest,visible,material:s.material[a],lambda:0 });
  }
  filter(keep) {
    let write=0;
    for(let read=0;read<this.edges.length;read++){
      const e=this.edges[read];if(keep(e))this.edges[write++]=e;else {this.keys.delete(this.key(e.a,e.b));this.rigidDirty=true;}
    }
    this.edges.length=write;
  }
  removeParticle(i,last) {
    this.rigidDirty=true;
    this.filter(e=>e.a !== i && e.b !== i);
    for (const e of this.edges) { if(e.a === last)e.a = i; if(e.b === last)e.b = i; }
    this.keys = new Set(this.edges.map(e=>this.key(e.a,e.b)));
  }
  solidify(indices) {
    const s = this.s;
    for (const i of indices) {
      if (i >= s.count || s.kind[i] || MATERIALS[s.material[i]].mpm || !MATERIALS[s.material[i]].solid) continue;
      s.forNear(s.x[i],s.y[i],5.6,j=>{
        if (i === j || s.kind[j] || s.material[i] !== s.material[j]) return;
        const d = Math.hypot(s.x[i]-s.x[j],s.y[i]-s.y[j]);
        if(d > 1.6 && d < 5.6) this.add(i,j);
      });
    }
  }
  rebuildRigidGroups(){
    const s=this.s,parent=new Int32Array(s.count);parent.fill(-1);
    const natural=i=>!s.kind[i] && [0,4,5].includes(s.material[i]);
    const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    for(const e of this.edges){
      if(!natural(e.a)||!natural(e.b))continue;
      for(const i of [e.a,e.b])if(parent[i]===-1)parent[i]=i;
      const a=root(e.a),b=root(e.b);if(a!==b)parent[b]=a;
    }
    const groups=new Map();
    for(let i=0;i<s.count;i++)if(parent[i]>=0){const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
    this.rigidGroups=[];
    for(const ids of groups.values()){
      // Reference shape changes only when bonds are formed, cut or melted.
      this.rigidGroups.push({ids,rx:Float64Array.from(ids,i=>s.x[i]),ry:Float64Array.from(ids,i=>s.y[i])});
    }
    this.rigidDirty=false;
  }
  solveRigid(){
    if(this.rigidDirty)this.rebuildRigidGroups();
    const s=this.s;
    for(const {ids,rx,ry} of this.rigidGroups){
      let weight=0,cx=0,cy=0,qx=0,qy=0;
      for(let k=0;k<ids.length;k++){
        const i=ids[k],w=s.mass[i]*(s.pinned[i]?1e6:1);
        weight+=w;cx+=s.x[i]*w;cy+=s.y[i]*w;qx+=rx[k]*w;qy+=ry[k]*w;
      }
      cx/=weight;cy/=weight;qx/=weight;qy/=weight;
      let dot=0,cross=0;
      for(let k=0;k<ids.length;k++){
        const i=ids[k],w=s.mass[i]*(s.pinned[i]?1e6:1),a=rx[k]-qx,b=ry[k]-qy;
        dot+=w*(a*(s.x[i]-cx)+b*(s.y[i]-cy));cross+=w*(a*(s.y[i]-cy)-b*(s.x[i]-cx));
      }
      const angle=Math.atan2(cross,dot),c=Math.cos(angle),sn=Math.sin(angle);
      for(let k=0;k<ids.length;k++){
        const i=ids[k];if(s.pinned[i]){s.x[i]=s.anchorX[i];s.y[i]=s.anchorY[i];continue;}
        const a=rx[k]-qx,b=ry[k]-qy;s.x[i]=cx+c*a-sn*b;s.y[i]=cy+sn*a+c*b;
      }
      if((s.settings.boundary || s.scene==='basin') && !ids.some(i=>s.pinned[i])){
        const bound=s.scene==='basin'?245:555,floor=s.scene==='basin'?-175:-bound;
        let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const i of ids){minX=Math.min(minX,s.x[i]);maxX=Math.max(maxX,s.x[i]);minY=Math.min(minY,s.y[i]);maxY=Math.max(maxY,s.y[i]);}
        const dx=minX < -bound?-bound-minX:maxX>bound?bound-maxX:0;
        const dy=minY<floor?floor-minY:maxY>bound?bound-maxY:0;
        if(dx||dy)for(const i of ids){s.x[i]+=dx;s.y[i]+=dy;}
      }
    }
  }
  pin(i,value) {
    const s = this.s;
    s.pinned[i] = value ? 1 : 0; s.invMass[i] = value ? 0 : 1 / s.mass[i];
    s.anchorX[i] = s.x[i]; s.anchorY[i] = s.y[i];
    if(value)s.vx[i] = s.vy[i] = 0;
  }
  brush(tool,x,y,radius) {
    const s = this.s;
    if (tool === 'cut') {
      this.filter(e=>{
        const dx = s.x[e.b]-s.x[e.a], dy = s.y[e.b]-s.y[e.a];
        const t = Math.max(0,Math.min(1,((x-s.x[e.a])*dx+(y-s.y[e.a])*dy)/(dx*dx+dy*dy || 1)));
        return Math.hypot(x-s.x[e.a]-dx*t,y-s.y[e.a]-dy*t) > radius;
      });
    } else for(let i=0;i<s.count;i++) if(Math.hypot(s.x[i]-x,s.y[i]-y)<radius) this.pin(i,tool === 'anchor');
  }
  create({x1,y1,x2,y2,material=7,shape='beam',fixed=false}) {
    const s = this.s;
    if(MATERIALS[material]?.mpm)return s.mpm.create(s,{x1,y1,x2,y2,material,shape,fixed});
    if (![7,8,9].includes(material) || ![x1,y1,x2,y2].every(Number.isFinite)) return false;
    x1=Math.max(-540,Math.min(540,x1)); x2=Math.max(-540,Math.min(540,x2));
    y1=Math.max(-540,Math.min(540,y1)); y2=Math.max(-540,Math.min(540,y2));
    const length=Math.hypot(x2-x1,y2-y1);
    if(length < 3)return false;
    if(shape==='panel' && material!==9 && (Math.abs(x2-x1)<3 || Math.abs(y2-y1)<3))return false;
    const nx=Math.max(1,Math.ceil((shape === 'panel' && material !== 9 ? Math.abs(x2-x1) : length)/8));
    const ny=material === 9 ? 0 : shape === 'panel' ? Math.max(1,Math.ceil(Math.abs(y2-y1)/8)) : 1;
    if(nx>90 || ny>70 || s.count+(nx+1)*(ny+1)>s.x.length) return false;
    const start=s.count, ux=(x2-x1)/length, uy=(y2-y1)/length;
    for(let row=0;row<=ny;row++) for(let col=0;col<=nx;col++) {
      const x=shape==='panel' && material!==9 ? x1+(x2-x1)*col/nx : x1+(x2-x1)*col/nx-uy*(row-.5)*5;
      const y=shape==='panel' && material!==9 ? y1+(y2-y1)*row/ny : y1+(y2-y1)*col/nx+ux*(row-.5)*5;
      s.add(x,y,material); s.kind[s.count-1]=1;
      if(fixed && col===0)this.pin(s.count-1,true);
    }
    const at=(col,row)=>start+row*(nx+1)+col;
    for(let row=0;row<=ny;row++) for(let col=0;col<=nx;col++) {
      if(col<nx)this.add(at(col,row),at(col+1,row),true);
      if(row<ny)this.add(at(col,row),at(col,row+1),true);
      if(col<nx && row<ny) {
        this.add(at(col,row),at(col+1,row+1),true);
        this.add(at(col+1,row),at(col,row+1),true);
      }
      // Wider steel braces constrain bending without making elastic materials rigid.
      if(material===7 && col+4<=nx){
        this.add(at(col,row),at(col+4,row));
        if(row<ny)this.add(at(col,row),at(col+4,row+1));
      }
    }
    return true;
  }
  begin() {
    const s=this.s;
    this.filter(e=>MATERIALS[s.material[e.a]].solid && MATERIALS[s.material[e.b]].solid);
    for(const e of this.edges)e.lambda=0;
  }
  solve(dt) {
    const s=this.s;
    for(const e of this.edges) {
      const {a,b,rest}=e, dx=s.x[b]-s.x[a], dy=s.y[b]-s.y[a], d=Math.hypot(dx,dy);
      if(d<1e-6)continue;
      const m=MATERIALS[e.material], c=d-rest;
      if(e.material===9 && c<=0)continue; // A rope cannot push.
      const w=s.invMass[a]+s.invMass[b], alpha=m.compliance/(dt*dt);
      if(!w)continue;
      const dl=(-c-alpha*e.lambda)/(w+alpha); e.lambda+=dl;
      s.x[a]-=dx/d*dl*s.invMass[a];s.y[a]-=dy/d*dl*s.invMass[a];
      s.x[b]+=dx/d*dl*s.invMass[b];s.y[b]+=dy/d*dl*s.invMass[b];
    }
    for(let i=0;i<s.count;i++)if(s.pinned[i]) {s.x[i]=s.anchorX[i];s.y[i]=s.anchorY[i];}
  }
  breakOverstretched() {
    const s=this.s;
    this.filter(e=>Math.hypot(s.x[e.a]-s.x[e.b],s.y[e.a]-s.y[e.b])/e.rest < 1+MATERIALS[e.material].breakStrain);
  }
  collide() {
    const s=this.s;
    for(const e of this.edges) {
      if(!e.visible)continue;
      const {a,b}=e, ax=s.x[a],ay=s.y[a],dx=s.x[b]-ax,dy=s.y[b]-ay,d2=dx*dx+dy*dy;
      if(d2<.01)continue;
      s.forNear(ax+dx*.5,ay+dy*.5,Math.sqrt(d2)*.5+3.3,i=>{
        if(i===a || i===b || s.material[i]===3)return;
        if(s.kind[i] && (this.keys.has(this.key(a,i)) || this.keys.has(this.key(b,i))))return;
        const t=Math.max(0,Math.min(1,((s.x[i]-ax)*dx+(s.y[i]-ay)*dy)/d2));
        let nx=s.x[i]-ax-t*dx,ny=s.y[i]-ay-t*dy,d=Math.hypot(nx,ny);
        if(d>=3.1)return;
        if(d<.0001){nx=-dy;ny=dx;const n=Math.sqrt(d2);nx/=n;ny/=n;d=0;}else{nx/=d;ny/=d;}
        const wa=s.invMass[a]*(1-t),wb=s.invMass[b]*t,wi=s.invMass[i];
        const w=wi+wa*(1-t)+wb*t;if(!w)return;
        const c=(3.1-d)/w;
        s.x[i]+=nx*c*wi;s.y[i]+=ny*c*wi;
        s.x[a]-=nx*c*wa;s.y[a]-=ny*c*wa;s.x[b]-=nx*c*wb;s.y[b]-=ny*c*wb;
      });
    }
  }
  snapshot() {
    const s=this.s,lines=[],anchors=[];
    for(const e of this.edges)if(e.visible || (!s.kind[e.a] && [0,4,5].includes(e.material)))lines.push(s.x[e.a],s.y[e.a],s.x[e.b],s.y[e.b],e.material,Math.abs(Math.hypot(s.x[e.a]-s.x[e.b],s.y[e.a]-s.y[e.b])/e.rest-1));
    for(let i=0;i<s.count;i++)if(s.pinned[i])anchors.push(s.x[i],s.y[i]);
    return {lines:new Float32Array(lines),anchors:new Float32Array(anchors),bonds:this.edges.length};
  }
}
