import {transformPoint} from './model.js';
import {validateExplicitMesh,explicitLocalNodes} from './explicit-mesh.js';
import {classifyPartSurfaces} from '../simulation/surface-selections.js';
export const sub=(a,b)=>a.map((x,k)=>x-b[k]);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0);
export function tetraData(nodes,tet){
  const [a,b,c,d]=tet.map(i=>nodes[i]),u=sub(b,a),v=sub(c,a),w=sub(d,a);
  const det=dot(u,cross(v,w));
  if(!(det>0)||!Number.isFinite(det))throw Error('网格含翻转或退化四面体');
  const grads=[cross(v,w),cross(w,u),cross(u,v)].map(v=>v.map(x=>x/det));
  grads.unshift([0,1,2].map(k=>-grads.reduce((s,g)=>s+g[k],0)));
  const edge2=[sub(a,b),sub(a,c),sub(a,d),sub(b,c),sub(b,d),sub(c,d)].reduce((s,e)=>s+dot(e,e),0);
  return {volume:det/6,grads,quality:12*Math.pow(det/2,2/3)/edge2};
}
export function boxMesh(part){
  if(part.geometry.shape==='cad')return cadMesh(part);
  const n=part.discretization.divisions,size=part.geometry.size,nodes=[],local=[],cells=[],faces=new Map();
  const index=(x,y,z)=>x+(n[0]+1)*(y+(n[1]+1)*z);
  for(let z=0;z<=n[2];z++)for(let y=0;y<=n[1];y++)for(let x=0;x<=n[0];x++){
    const p=[x,y,z].map((v,k)=>size[k]*(v/n[k]-.5));local.push(p);nodes.push(transformPoint(part,p));
  }
  const pattern=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
  let minQuality=1,minVolume=Infinity,volume=0;
  for(let z=0;z<n[2];z++)for(let y=0;y<n[1];y++)for(let x=0;x<n[0];x++){
    const corners=Array.from({length:8},(_,i)=>index(x+(i&1),y+((i>>1)&1),z+((i>>2)&1)));
    for(const t of pattern){
      const ids=t.map(i=>corners[i]),data=tetraData(nodes,ids),element=cells.length;
      minQuality=Math.min(minQuality,data.quality);minVolume=Math.min(minVolume,data.volume);volume+=data.volume;
      cells.push({ids,...data});
      for(const f of [[1,2,3],[0,3,2],[0,1,3],[0,2,1]]){
        const idsFace=f.map(i=>ids[i]),key=idsFace.slice().sort((a,b)=>a-b).join(',');
        if(faces.has(key))faces.delete(key);else faces.set(key,{nodes:idsFace,element});
      }
    }
  }
  const surface=[...faces.values()];
  for(const f of surface){
    const [a,b,c]=f.nodes.map(i=>nodes[i]),normal=cross(sub(b,a),sub(c,a)),length=Math.hypot(...normal);
    f.area=length/2;f.normal=normal.map(x=>x/length);
    for(let k=0;k<3;k++)for(const s of [-1,1])if(f.nodes.every(i=>Math.abs(local[i][k]-s*size[k]/2)<size[k]*1e-9))f.face='xyz'[k]+(s<0?'-':'+');
    if(!f.face)throw Error('网格边界拓扑不完整');
  }
  return classifyPartSurfaces(part,{id:part.id,nodes,cells,surface,quality:{minQuality,minVolume,volume,nodes:nodes.length,elements:cells.length}});
}

export function cadMesh(part){
  const {surface,components}=validateExplicitMesh(part.discretization.mesh,part.geometry.cad),local=explicitLocalNodes(part),nodes=local.map(p=>transformPoint(part,p));
  const cells=part.discretization.mesh.elements.map((ids,i)=>({ids:ids.slice(),...tetraData(nodes,ids),component:components[i]}));
  let minEdge=Infinity,maxEdge=0;
  for(const c of cells)for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    const length=Math.hypot(...sub(nodes[c.ids[i]],nodes[c.ids[j]]));minEdge=Math.min(minEdge,length);maxEdge=Math.max(maxEdge,length);
  }
  for(const f of surface){
    const [a,b,c]=f.nodes.map(i=>nodes[i]),normal=cross(sub(b,a),sub(c,a)),length=Math.hypot(...normal);
    f.area=length/2;f.normal=normal.map(v=>v/length);f.component=components[f.element];
    for(let k=0;k<3;k++)for(const sign of [-1,1])if(f.nodes.every(i=>Math.abs(local[i][k]-sign*part.geometry.size[k]/2)<part.geometry.size[k]*1e-7))f.face='xyz'[k]+(sign<0?'-':'+');
    // Curved surfaces and hole walls remain real contact/thermal surfaces;
    // only planar triangles on a local bounding face acquire an XYZ label.
    f.face??='surface';
  }
  const minAltitude=Math.min(...cells.map(c=>Math.min(...c.grads.map(g=>1/Math.hypot(...g)))));
  return classifyPartSurfaces(part,{id:part.id,nodes,cells,surface,explicit:true,quality:{minQuality:Math.min(...cells.map(c=>c.quality)),minVolume:Math.min(...cells.map(c=>c.volume)),volume:cells.reduce((s,c)=>s+c.volume,0),minEdge,maxEdge,minAltitude,nodes:nodes.length,elements:cells.length,components:Math.max(...components)+1}});
}

export function meshLength(state,maximum=false){
  if(state.mesh.explicit)return maximum?state.mesh.quality.maxEdge:state.mesh.quality.minAltitude;
  const cell=state.part.geometry.size.map((v,k)=>v/state.part.discretization.divisions[k]);
  return maximum?Math.max(...cell):Math.min(...cell);
}
