import {validateCAD,validateCADRecipe} from '../three/cad-geometry.js';

export const EXPLICIT_MESH_LIMITS=Object.freeze({nodes:5000,elements:24000});
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const facePattern=[[1,2,3],[0,3,2],[0,1,3],[0,2,1]];
const key=ids=>ids.slice().sort((a,b)=>a-b).join(',');

// Nodes are in the original SMLib coordinate system. Placement/scaling are
// separate project operations; changing the CAD recipe requires remeshing.
export function validateExplicitMesh(mesh,cad){
  validateCAD(cad);
  if(mesh?.schema!=='summer-tet4/1'||mesh.coordinates!=='cad'||!Array.isArray(mesh.nodes)||mesh.nodes.length<4||mesh.nodes.length>EXPLICIT_MESH_LIMITS.nodes||!mesh.nodes.every(vec)||!Array.isArray(mesh.elements)||!mesh.elements.length||mesh.elements.length>EXPLICIT_MESH_LIMITS.elements)throw Error('CAD Tet4 网格格式无效或超过 5000 节点 / 24000 单元');
  const source=mesh.source;
  if(!source||!vec(source.lower)||!vec(source.upper)||JSON.stringify(validateCADRecipe(source.recipe))!==JSON.stringify(validateCADRecipe(cad.recipe))||[0,1,2].some(k=>Math.abs(source.lower[k]-cad.lower[k])>1e-9||Math.abs(source.upper[k]-cad.upper[k])>1e-9))throw Error('CAD 几何已变化，请重新生成四面体网格');
  const span=cad.upper.map((v,k)=>v-cad.lower[k]),tol=Math.max(...span)*1e-7;
  if(mesh.nodes.some(p=>p.some((v,k)=>v<cad.lower[k]-tol||v>cad.upper[k]+tol)))throw Error('四面体节点超出 CAD 包围盒');
  const used=new Uint8Array(mesh.nodes.length),seen=new Set(),faces=new Map(),parents=mesh.elements.map((_,i)=>i);
  const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  let volume=0,minEdge=Infinity,maxEdge=0;
  for(const [element,ids] of mesh.elements.entries()){
    if(!Array.isArray(ids)||ids.length!==4||new Set(ids).size!==4||ids.some(i=>!Number.isInteger(i)||i<0||i>=mesh.nodes.length))throw Error('四面体索引无效');
    const tetKey=key(ids);if(seen.has(tetKey))throw Error('四面体单元重复');seen.add(tetKey);
    const [a,b,c,d]=ids.map(i=>mesh.nodes[i]),det=dot(sub(b,a),cross(sub(c,a),sub(d,a)));
    const edge=ids.flatMap((i,k)=>ids.slice(k+1).map(j=>Math.hypot(...sub(mesh.nodes[i],mesh.nodes[j]))));
    if(!Number.isFinite(det)||det<=Math.max(...edge)**3*1e-12)throw Error('网格含翻转或退化四面体');
    minEdge=Math.min(minEdge,...edge);maxEdge=Math.max(maxEdge,...edge);volume+=det/6;
    for(const i of ids)used[i]=1;
    for(const pattern of facePattern){
      const nodes=pattern.map(i=>ids[i]),k=key(nodes),old=faces.get(k);
      if(old){
        if(++old.count>2)throw Error('四面体网格存在非流形面');
        const [p,q,r]=old.nodes.map(i=>mesh.nodes[i]);
        const opposite=ids.find(i=>!old.nodes.includes(i));
        if(dot(cross(sub(q,p),sub(r,p)),sub(mesh.nodes[opposite],p))<=0)throw Error('四面体在共享面同侧重叠');
        parents[find(element)]=find(old.element);
      }else faces.set(k,{nodes,element,count:1});
    }
  }
  if(used.some(v=>!v))throw Error('四面体网格含未连接的孤立节点');
  const surface=[...faces.values()].filter(f=>f.count===1).map(({nodes,element})=>({nodes,element}));
  if(!surface.length||volume>span.reduce((a,v)=>a*v,1)*1.001)throw Error('四面体网格边界或总体积无效');
  if(mesh.surface!==undefined){
    if(!Array.isArray(mesh.surface)||mesh.surface.length!==surface.length)throw Error('四面体表面与单元边界不一致');
    const boundary=new Set(surface.map(f=>key(f.nodes)));
    for(const f of mesh.surface)if(!Array.isArray(f)||f.length!==3||!boundary.delete(key(f)))throw Error('四面体表面与单元边界不一致');
  }
  const componentIds=new Map(),components=mesh.elements.map((_,i)=>{const root=find(i);if(!componentIds.has(root))componentIds.set(root,componentIds.size);return componentIds.get(root);});
  return {surface,components,volume,minEdge,maxEdge};
}

export function explicitLocalNodes(part){
  const {cad,size}=part.geometry;
  return part.discretization.mesh.nodes.map(p=>p.map((v,k)=>((v-cad.lower[k])/(cad.upper[k]-cad.lower[k])-.5)*size[k]));
}
