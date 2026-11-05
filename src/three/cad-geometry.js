// Analytic CSG occupancy follows the same ordered primitives/operations sent to
// SMLib. Sampling is independent of display tessellation; holes are not filled
// by a bounding-box or convex-hull approximation.
import {validateCADProfile,compileCADProfile} from './cad-profiles.js';
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
// Shared by the UI, the assistant's closed command protocol, and persisted
// geometry validation. Return a canonical data-only copy so key order cannot
// disguise a mismatched kernel response.
export function validateCADRecipe(recipe){
  if(!Array.isArray(recipe)||recipe.length<1||recipe.length>8)throw Error('CAD 特征数量须为 1–8');
  return recipe.map((r,i)=>{
    const profiled=['extrude','revolve'].includes(r?.shape),parameter=r?.shape==='extrude'?'depth':'angle';
    const fields=profiled?['shape','operation','center','profile',parameter,'rotation']:['shape','operation','center','size','rotation'];
    if(!r||Array.isArray(r)||typeof r!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(r))||Object.keys(r).length!==fields.length||Object.keys(r).some(k=>!fields.includes(k))||!['box','sphere','cylinder','extrude','revolve'].includes(r.shape)||!(i?['union','difference','intersection']:['base']).includes(r.operation)||![r.center,r.rotation].every(vec)||r.center.some(v=>Math.abs(v)>100)||r.rotation.some(v=>Math.abs(v)>360))throw Error('CAD 特征参数无效：仅允许已支持形状对应的布尔运算、位置、尺寸或轮廓参数');
    if(profiled){
      const profile=validateCADProfile(r.profile,{radial:r.shape==='revolve'}),value=r[parameter],lo=r.shape==='extrude'?.01:1,hi=r.shape==='extrude'?12:360;
      if(!Number.isFinite(value)||value<lo||value>hi)throw Error(r.shape==='extrude'?'拉伸深度须为 0.01–12 m':'旋转角度须为 1–360°');
      return {shape:r.shape,operation:r.operation,center:r.center.slice(),profile,[parameter]:value,rotation:r.rotation.slice()};
    }
    if(!vec(r.size)||r.size.some(v=>v<.01||v>12))throw Error('CAD 实体尺寸须为三个 0.01–12 m 的有限数值');
    if(r.shape==='sphere'&&Math.max(...r.size)-Math.min(...r.size)>1e-10||r.shape==='cylinder'&&Math.abs(r.size[0]-r.size[2])>1e-10)throw Error('CAD 球 / 圆柱直径不一致');
    return {shape:r.shape,operation:r.operation,center:r.center.slice(),size:r.size.slice(),rotation:r.rotation.slice()};
  });
}
export function validateCAD(c){
  if(c?.schema!=='summer-cad/1'||c.kernel!=='SMLib'||c.closed!==true||!vec(c.lower)||!vec(c.upper)||c.upper.some((x,k)=>x<=c.lower[k])||!Number.isFinite(c.volume)||c.volume<=0)throw Error('SMLib 实体数据无效');
  const boxVolume=c.upper.reduce((v,x,k)=>v*(x-c.lower[k]),1);
  if(c.volume>boxVolume*1.001)throw Error('CAD 体积超过包围盒');
  validateCADRecipe(c.recipe);
  if(!Array.isArray(c.vertices)||c.vertices.length<4||c.vertices.length>50000||!c.vertices.every(vec)||!Array.isArray(c.indices)||c.indices.length<12||c.indices.length>300000||c.indices.length%3||!c.indices.every(i=>Number.isInteger(i)&&i>=0&&i<c.vertices.length))throw Error('CAD 显示网格无效');
  return c;
}

export function compileCAD(c){
  validateCAD(c);
  const features=c.recipe.map(r=>{
    const [x,y,z]=r.rotation.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return {...r,containsProfile:r.profile?compileCADProfile(r.profile):null,R:[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx,sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx,-sy,cy*sx,cy*cx]};
  });
  return q=>{
    const p=q.map((v,k)=>c.lower[k]+(v+1)*.5*(c.upper[k]-c.lower[k]));let inside=false;
    for(const r of features){
      const d=p.map((v,k)=>v-r.center[k]),local=[0,1,2].map(k=>r.R[k]*d[0]+r.R[k+3]*d[1]+r.R[k+6]*d[2]);let hit;
      if(r.shape==='extrude')hit=Math.abs(local[2])<=r.depth/2+1e-10*Math.max(1,r.depth)&&r.containsProfile(local[0],local[1]);
      else if(r.shape==='revolve'){
        const radius=Math.hypot(local[0],local[2]);let angle=Math.atan2(-local[2],local[0]);if(angle<0)angle+=2*Math.PI;if(angle>2*Math.PI-1e-10)angle=0;
        hit=r.containsProfile(radius,local[1])&&(r.angle===360||radius<=1e-10||angle<=r.angle*Math.PI/180+1e-10);
      }else{
        const v=local.map((x,k)=>2*x/r.size[k]);hit=v.every(x=>Math.abs(x)<=1+1e-10)&&(r.shape==='box'||(r.shape==='sphere'?v.reduce((s,x)=>s+x*x,0):v[0]**2+v[2]**2)<=1+1e-10);
      }
      inside=r.operation==='base'?hit:r.operation==='union'?inside||hit:r.operation==='difference'?inside&&!hit:inside&&hit;
    }
    return inside;
  };
}

export function cadDisplayMesh(c){
  const points=c.vertices.map(p=>p.map((v,k)=>(v-c.lower[k])/(c.upper[k]-c.lower[k])-.5)),data=[];
  for(let i=0;i<c.indices.length;i+=3){
    const [a,b,d]=c.indices.slice(i,i+3).map(j=>points[j]),u=b.map((v,k)=>v-a[k]),v=d.map((v,k)=>v-a[k]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;
    for(const p of [a,b,d])data.push(...p,...n.map(x=>x/length));
  }
  return new Float32Array(data);
}
