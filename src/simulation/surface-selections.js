import {validateParametricPart} from './cad-parametric.js';

const AXIS_FACES=['x-','x+','y-','y+','z-','z+'];
const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a);
const signature=part=>JSON.stringify([part.id,part.geometry.shape,part.geometry.size,part.geometry.center,part.geometry.rotation,part.modeling,part.geometry.cad?.recipe,part.geometry.cad?.lower,part.geometry.cad?.upper]);
const failure=(part,key,reason)=>Error(`${part?.name??part?.id??'部件'} 的命名表面 ${key??''} ${reason}；请重新选择实际存在的表面`);

// Keys describe template features, never kernel face numbers or mesh indices.
// Analytic predicates classify the native CAD tessellation. TetGen's boundary
// is then matched against those exact triangles, including Steiner points on
// chords of curved faces. Radius tolerances alone cannot safely do this.
function definitions(part){
  if(part?.method!=='fem')return [];
  const g=part.geometry,out=[];
  const add=(key,label,kind,test)=>out.push({key,label,kind,region:{type:'surface',surface:key},test});
  const plane=(prefix,face,value,label)=>{const k='xyz'.indexOf(face[0]);add(`${prefix}:${face}`,label??`局部 ${face} 面`,'plane',(p,t)=>Math.abs(p[k]-value)<=t);};
  if(g?.shape==='box'){
    AXIS_FACES.forEach(face=>plane('box',face,(face[1]==='-'?-1:1)*g.size['xyz'.indexOf(face[0])]/2));return out;
  }
  if(g?.shape!=='cad'||!part.modeling)return out;
  const spec=validateParametricPart(part),p=spec.parameters,id=spec.template;
  // Native facets on a curved wall can have a small axial tilt when adjacent
  // tessellation rings are staggered. Exact radius tests identify the wall;
  // the lateral normal check only separates its planar end-cap triangles.
  if(id==='four-hole-plate'||id==='l-bracket'){
    const size=id==='four-hole-plate'?[p.width,p.thickness,p.height]:[p.width,p.height,p.depth];
    AXIS_FACES.forEach(face=>plane(id,face,(face[1]==='-'?-1:1)*size['xyz'.indexOf(face[0])]/2));
    if(id==='l-bracket'){
      add(`${id}:inner-x`,'L 形内侧竖直面','plane',(q,t)=>Math.abs(q[0]-(-p.width/2+p.legThickness))<=t);
      add(`${id}:inner-y`,'L 形内侧水平面','plane',(q,t)=>Math.abs(q[1]-(-p.height/2+p.legThickness))<=t);
    }else for(const x of [-1,1])for(const z of [-1,1]){
      const sx=x<0?'-':'+',sz=z<0?'-':'+',cx=x*p.pitchX/2,cz=z*p.pitchZ/2;
      add(`${id}:hole:x${sx}:z${sz}`,`孔壁 X${sx} / Z${sz}`,'cylinder',(q,t,n)=>Math.abs(Math.hypot(q[0]-cx,q[2]-cz)-p.holeDiameter/2)<=t&&Math.abs(n[1])<.5);
    }
  }else if(id==='sleeve'){
    const c=g.cad.recipe[0].center;
    plane(id,'y-',-p.height/2,'套筒下端面');plane(id,'y+',p.height/2,'套筒上端面');
    for(const [name,r,label] of [['inner-wall',p.innerRadius,'套筒内壁'],['outer-wall',p.outerRadius,'套筒外壁']])add(`${id}:${name}`,label,'cylinder',(q,t,n)=>Math.abs(Math.hypot(q[0]-c[0],q[2]-c[2])-r)<=t&&Math.abs(n[1])<.5);
    if(p.angle<360)for(const [name,angle,label] of [['cut-start',0,'套筒起始切面'],['cut-end',p.angle*Math.PI/180,'套筒终止切面']]){
      const direction=[Math.cos(angle),0,-Math.sin(angle)],normal=[Math.sin(angle),0,Math.cos(angle)];
      add(`${id}:${name}`,label,'plane',(q,t)=>{const d=sub(q,c),r=dot(d,direction);return Math.abs(dot(d,normal))<=t&&r>=p.innerRadius-t&&r<=p.outerRadius+t;});
    }
  }
  return out;
}

export function listPartSurfaces(part){
  try{return definitions(part).map(({test,...descriptor})=>descriptor);}catch{return [];}
}

export function validateSurfaceRegion(part,region){
  if(region?.type!=='surface'||typeof region.surface!=='string'||Object.keys(region).some(k=>!['type','surface'].includes(k)))throw failure(part,region?.surface,'描述无效');
  let candidates;try{candidates=definitions(part).filter(d=>d.key===region.surface);}catch{throw failure(part,region.surface,'参数化来源已失效');}
  if(candidates.length!==1)throw failure(part,region.surface,candidates.length?'存在歧义':'不存在或不受支持');
  const {test,...descriptor}=candidates[0];return descriptor;
}

function triangleData(points){
  const [a,b,c]=points,u=sub(b,a),v=sub(c,a),n=cross(u,v),length=norm(n);
  return {points,a,u,v,normal:n.map(x=>x/length),area:length/2,uu:dot(u,u),uv:dot(u,v),vv:dot(v,v)};
}
function overlapArea(triangle,points,tolerance){
  const offsets=points.map(p=>sub(p,triangle.a));
  if(offsets.some(d=>Math.abs(dot(d,triangle.normal))>tolerance))return 0;
  const {uu,uv,vv,u,v}=triangle,den=uu*vv-uv*uv;
  let polygon=offsets.map(d=>{const du=dot(d,u),dv=dot(d,v);return [(vv*du-uv*dv)/den,(uu*dv-uv*du)/den];});
  // Clip in the source triangle's barycentric plane. TetGen may retriangulate
  // a coplanar patch, so containment in one source triangle is insufficient.
  for(const distance of [q=>q[0],q=>q[1],q=>1-q[0]-q[1]]){
    const next=[];for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b);
      if(da>=0)next.push(a);
      if((da>=0)!==(db>=0)){const f=da/(da-db);next.push(a.map((v,k)=>v+f*(b[k]-v)));}
    }polygon=next;if(polygon.length<3)return 0;
  }
  return Math.abs(polygon.reduce((area,p,i)=>{const q=polygon[(i+1)%polygon.length];return area+p[0]*q[1]-p[1]*q[0];},0))*triangle.area;
}

// Called once for each new solver mesh. Metadata is derived, never persisted.
// Every claimed named region must have the same boundary area as its native
// source facets, so a partially missing wall cannot silently accept a load.
export function classifyPartSurfaces(part,mesh){
  mesh.surfaceSelectionSignature=signature(part);mesh.surfaceAreas={};mesh.surfaceErrors={};
  const descriptors=definitions(part);if(!descriptors.length)return mesh;
  if(part.geometry.shape==='box'){
    for(const t of mesh.surface){t.surfaceKey='box:'+t.face;mesh.surfaceAreas[t.surfaceKey]=(mesh.surfaceAreas[t.surfaceKey]??0)+t.area;}return mesh;
  }
  const cad=part.geometry.cad,extent=Math.max(...cad.upper.map((x,k)=>x-cad.lower[k])),tol=extent*1e-7;
  const scale=part.geometry.size.map((v,k)=>v/(cad.upper[k]-cad.lower[k])),source=[];
  for(let i=0;i<cad.indices.length;i+=3){
    const points=cad.indices.slice(i,i+3).map(n=>cad.vertices[n]),data=triangleData(points);
    if(!(data.area>0))continue;
    const matches=descriptors.filter(d=>points.every(p=>d.test(p,tol,data.normal)));
    if(matches.length!==1)throw failure(part,matches.map(d=>d.key).join(', '),'原生表面无法唯一识别');
    const key=matches[0].key,area=triangleData(points.map(p=>p.map((v,k)=>v*scale[k]))).area;
    mesh.surfaceAreas[key]=(mesh.surfaceAreas[key]??0)+area;source.push({...data,key});
  }
  // The explicit mesh uses CAD coordinates before the independent part pose.
  const nodes=part.discretization.mesh.nodes;
  for(const t of mesh.surface){
    const points=t.nodes.map(n=>nodes[n]),area=triangleData(points).area,coverage=new Map();
    for(const s of source){const overlap=overlapArea(s,points,tol);if(overlap>0)coverage.set(s.key,(coverage.get(s.key)??0)+overlap);}
    const keys=[...coverage].filter(([,covered])=>Math.abs(covered-area)<=area*1e-5).map(([key])=>key);
    if(keys.length===1)t.surfaceKey=keys[0];
    else if(keys.length>1)throw failure(part,keys.join(', '),'网格边界匹配存在歧义');
  }
  for(const descriptor of descriptors){
    const expected=mesh.surfaceAreas[descriptor.key]??0,actual=mesh.surface.filter(t=>t.surfaceKey===descriptor.key).reduce((sum,t)=>sum+t.area,0);
    if(!(expected>0)||Math.abs(actual-expected)>Math.max(expected*1e-6,extent*extent*1e-12))mesh.surfaceErrors[descriptor.key]='网格边界缺失或与原生表面不一致，请重新生成四面体网格';
  }
  return mesh;
}

export function resolveSurfaceSelection(part,mesh,setOrRegion){
  const set=setOrRegion?.region?setOrRegion:null,region=set?.region??setOrRegion;
  if(set&&(set.part!==part.id||set.entity!=='face'))throw failure(part,region?.surface,'选择集所属部件或实体无效');
  let key,label,predicate;
  if(region?.type==='face'&&AXIS_FACES.includes(region.face)){key=region.face;label=key;predicate=t=>t.face===key;}
  else{
    const descriptor=validateSurfaceRegion(part,region);key=descriptor.key;label=descriptor.label;
    if(mesh.surfaceSelectionSignature!==signature(part))throw failure(part,key,'网格来源已变化，请重新生成网格');
    if(mesh.surfaceErrors?.[key])throw failure(part,key,mesh.surfaceErrors[key]);
    predicate=t=>t.surfaceKey===key;
  }
  const triangleIndices=[],triangles=[];
  mesh.surface.forEach((t,i)=>{if(predicate(t)){triangles.push(t);triangleIndices.push(i);}});
  const area=triangles.reduce((sum,t)=>sum+t.area,0),nodes=[...new Set(triangles.flatMap(t=>t.nodes))];
  if(!(area>0)||!Number.isFinite(area))throw failure(part,key,region.type==='face'?'没有平面网格面':'没有匹配的网格边界');
  if(region.type==='surface'&&Math.abs(area-(mesh.surfaceAreas[key]??0))>Math.max(area*1e-6,1e-14))throw failure(part,key,'网格边界缺失或不一致');
  return {key,label,triangles,triangleIndices,nodes,area};
}
