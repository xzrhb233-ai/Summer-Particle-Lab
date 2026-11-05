import {validateFEM} from './model.js';
import {boxMesh,cross,dot} from './mesh.js';
import {resolveSurfaceSelection} from '../simulation/surface-selections.js';

const norm=v=>Math.sqrt(v.reduce((s,x)=>s+x*x,0));
export function assemble(mesh,material){
  const {young:E,poisson:nu}=material,mu=E/(2*(1+nu)),lambda=E*nu/((1+nu)*(1-2*nu));
  const rows=Array.from({length:mesh.nodes.length*3},()=>new Map());
  for(const {ids,grads:g,volume:V} of mesh.cells)for(let a=0;a<4;a++)for(let b=0;b<4;b++){
    const gg=dot(g[a],g[b]);
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const row=rows[3*ids[a]+i],col=3*ids[b]+j;
      const v=V*(lambda*g[a][i]*g[b][j]+mu*((i===j?gg:0)+g[a][j]*g[b][i]));
      row.set(col,(row.get(col)??0)+v);
    }
  }
  const offsets=new Int32Array(rows.length+1);
  rows.forEach((r,i)=>offsets[i+1]=offsets[i]+r.size);
  const indices=new Int32Array(offsets.at(-1)),values=new Float64Array(indices.length),diagonal=new Float64Array(rows.length);
  rows.forEach((r,i)=>{let k=offsets[i];for(const [j,v] of r){indices[k]=j;values[k++]=v;if(i===j)diagonal[i]=v;}rows[i]=null;});
  return {offsets,indices,values,diagonal,mu,lambda};
}
export function multiply(A,x,out=new Float64Array(x.length)){
  const {offsets:o,indices:c,values:v}=A;
  for(let i=0;i<x.length;i++){let s=0;for(let j=o[i];j<o[i+1];j++)s+=v[j]*x[c[j]];out[i]=s;}
  return out;
}
export function pcg(A,f,fixed,{tolerance,maxIterations}){
  const N=f.length,u=new Float64Array(N),r=f.slice(),z=new Float64Array(N),p=new Float64Array(N),q=new Float64Array(N),log=[];
  for(let i=0;i<N;i++){if(fixed[i])r[i]=0;z[i]=r[i]/A.diagonal[i];p[i]=z[i];}
  const scale=norm(r);if(scale===0)return {u,iterations:0,relativeResidual:0,log:[[0,0]]};
  let rz=dot(r,z),relative=1;
  for(let it=1;it<=maxIterations;it++){
    multiply(A,p,q);for(let i=0;i<N;i++)if(fixed[i])q[i]=0;
    const pq=dot(p,q);if(!(pq>0)||!Number.isFinite(pq))throw Error('刚度矩阵非正定；请检查约束、单元和材料');
    const alpha=rz/pq;
    for(let i=0;i<N;i++){u[i]+=alpha*p[i];r[i]-=alpha*q[i];}
    relative=norm(r)/scale;
    if(it===1||it%10===0||relative<tolerance)log.push([it,relative]);
    if(relative<tolerance){
      // Check the actual residual rather than only the recursive CG residual.
      multiply(A,u,q);for(let i=0;i<N;i++)r[i]=fixed[i]?0:f[i]-q[i];
      relative=norm(r)/scale;
      if(relative<tolerance*1.05)return {u,iterations:it,relativeResidual:relative,log};
      for(let i=0;i<N;i++)p[i]=z[i]=r[i]/A.diagonal[i];rz=dot(r,z);continue;
    }
    for(let i=0;i<N;i++)z[i]=r[i]/A.diagonal[i];
    const next=dot(r,z),beta=next/rz;for(let i=0;i<N;i++)p[i]=z[i]+beta*p[i];rz=next;
  }
  throw Error(`静力未收敛：${maxIterations} 次迭代，残差 ${relative.toExponential(3)}；请检查网格或提高迭代上限`);
}
export function boundaryData(project,part,mesh){
  const f=new Float64Array(mesh.nodes.length*3),fixed=new Uint8Array(f.length),fixedFaces=[],loadedFaces=[],fixedSurfaceKeys=[],loadedSurfaceKeys=[],fixedTriangles=[],loadedTriangles=[];
  for(const c of mesh.cells)for(const i of c.ids)for(let k=0;k<3;k++)f[3*i+k]+=part.material.density*c.volume/4*project.environment.gravity[k];
  for(const load of project.loads.filter(l=>l.target===part.id&&['fem-fixed','fem-force','fem-pressure'].includes(l.type))){
    const set=project.selectionSets.find(s=>s.id===load.selection),{key,triangles,triangleIndices,area}=resolveSurfaceSelection(part,mesh,set);
    const named=set.region.type==='surface';
    if(load.type==='fem-fixed'){
      (named?fixedSurfaceKeys:fixedFaces).push(key);fixedTriangles.push(...triangleIndices);for(const t of triangles)for(const i of t.nodes)for(let k=0;k<3;k++)fixed[3*i+k]=1;
    }else{
      (named?loadedSurfaceKeys:loadedFaces).push(key);loadedTriangles.push(...triangleIndices);
      for(const t of triangles)for(const i of t.nodes)for(let k=0;k<3;k++)f[3*i+k]+=t.area/3*(load.type==='fem-force'?load.force[k]/area:-load.pressure*t.normal[k]);
    }
  }
  if(mesh.explicit)for(let component=0;component<mesh.quality.components;component++){
    const candidates=[...new Set(mesh.cells.filter(c=>c.component===component).flatMap(c=>c.ids))].filter(n=>fixed[3*n]);
    const a=mesh.nodes[candidates[0]],b=candidates.length>1?mesh.nodes[candidates[1]]:null;
    if(!a||!b||!candidates.slice(2).some(n=>Math.hypot(...cross(b.map((v,k)=>v-a[k]),mesh.nodes[n].map((v,k)=>v-a[k])))>mesh.quality.minEdge**2*1e-10))throw Error(`${part.name} 有未充分固定的独立网格区域；每个连通区域需要至少三个不共线的固定节点`);
  }
  return {f,fixed,fixedFaces,loadedFaces,fixedSurfaceKeys,loadedSurfaceKeys,fixedTriangles:[...new Set(fixedTriangles)],loadedTriangles:[...new Set(loadedTriangles)]};
}
export function recover(mesh,A,u,temperature=null,material=null){
  const stress=[],strain=[],vonMises=[];
  for(const {ids,grads} of mesh.cells){
    const g=Array(9).fill(0);
    for(let a=0;a<4;a++)for(let i=0;i<3;i++)for(let j=0;j<3;j++)g[3*i+j]+=u[3*ids[a]+i]*grads[a][j];
    const e=[g[0],g[4],g[8],g[1]+g[3],g[5]+g[7],g[2]+g[6]],tr=e[0]+e[1]+e[2];
    const theta=temperature?(material.expansion??0)*(ids.reduce((s,n)=>s+temperature[n],0)/4-(material.referenceTemperature??20)):0;
    const s=e.map((x,k)=>k<3?A.lambda*tr+2*A.mu*x-(3*A.lambda+2*A.mu)*theta:A.mu*x);
    strain.push(e);stress.push(s);
    vonMises.push(Math.sqrt(((s[0]-s[1])**2+(s[1]-s[2])**2+(s[2]-s[0])**2)/2+3*(s[3]**2+s[4]**2+s[5]**2)));
  }
  return {stress,strain,vonMises};
}
export function solvePart(project,part,mesh){
  const start=performance.now(),A=assemble(mesh,part.material),bc=boundaryData(project,part,mesh);
  const solved=pcg(A,bc.f,bc.fixed,project.solver),internal=multiply(A,solved.u),reaction=new Float64Array(internal.length);
  const force=[0,0,0],reactionSum=[0,0,0],moment=[0,0,0],reactionMoment=[0,0,0];
  for(let n=0;n<mesh.nodes.length;n++){
    const F=[0,1,2].map(k=>bc.f[n*3+k]),R=[0,1,2].map(k=>bc.fixed[n*3+k]?internal[n*3+k]-F[k]:0);
    const arm=mesh.nodes[n].map((x,k)=>x-part.geometry.center[k]),mf=cross(arm,F),mr=cross(arm,R);
    for(let k=0;k<3;k++){reaction[n*3+k]=R[k];force[k]+=F[k];reactionSum[k]+=R[k];moment[k]+=mf[k];reactionMoment[k]+=mr[k];}
  }
  const fields=recover(mesh,A,solved.u),maxDisplacement=Math.max(...mesh.nodes.map((_,i)=>Math.hypot(...solved.u.subarray(i*3,i*3+3))));
  if(![...solved.u,...internal,...fields.vonMises].every(Number.isFinite))throw Error('FEM 解含非有限数值，请检查载荷与材料数量级');
  const maxStrain=Math.max(...fields.strain.map(e=>Math.max(...e.map(Math.abs))));
  const warnings=[];
  if(maxStrain>.01||maxDisplacement>Math.min(...part.geometry.size)*.1)warnings.push('变形较大，可能超出小变形线弹性适用范围；变形放大仅影响显示。');
  if(part.material.poisson>.45)warnings.push('接近不可压缩：Tet4 可能发生体积锁死。');
  const energy=dot(solved.u,internal)/2;
  return {id:part.id,...fields,displacement:solved.u,reaction,force:bc.f,...bc,iterations:solved.iterations,relativeResidual:solved.relativeResidual,log:solved.log,
    summary:{maxDisplacement,maxVonMises:Math.max(...fields.vonMises),maxStrain,energy,externalWork:dot(solved.u,bc.f),force,reaction:reactionSum,
      forceBalance:force.map((x,k)=>x+reactionSum[k]),moment,reactionMoment,momentBalance:moment.map((x,k)=>x+reactionMoment[k]),warnings,solveMs:performance.now()-start}};
}
export class FEMSimulation{
  constructor(input){this.project=validateFEM(input);this.meshes=this.project.parts.map(boxMesh);this.solution=null;this.time=0;}
  step(){
    const solutions=this.project.parts.map((p,i)=>solvePart(this.project,p,this.meshes[i]));
    this.solution=solutions;return this.snapshot();
  }
  snapshot(){
    const parts=this.project.parts.map((p,i)=>{
      const mesh=this.meshes[i],s=this.solution?.[i],bc=boundaryData(this.project,p,mesh);
      return {id:p.id,name:p.name,nodes:mesh.nodes,surface:mesh.surface,cells:mesh.cells.map(c=>c.ids),quality:mesh.quality,
        displacement:s?.displacement??new Float64Array(mesh.nodes.length*3),stress:s?.stress??[],strain:s?.strain??[],vonMises:s?.vonMises??[],reaction:s?.reaction??null,
        fixedFaces:bc.fixedFaces,loadedFaces:bc.loadedFaces,fixedSurfaceKeys:bc.fixedSurfaceKeys,loadedSurfaceKeys:bc.loadedSurfaceKeys,fixedTriangles:bc.fixedTriangles,loadedTriangles:bc.loadedTriangles,summary:s?.summary??null,log:s?.log??[],iterations:s?.iterations??0,relativeResidual:s?.relativeResidual??null};
    });
    return {time:0,bodies:[],joints:[],energy:this.solution?.reduce((s,p)=>s+p.summary.energy,0)??0,maxError:0,
      fem:{analysis:'linear-static',solved:!!this.solution,parts},results:{schema:'summer-results/1',time:0,analysis:'linear-static',parts:parts.map((r,i)=>({
        id:r.id,method:'fem',values:{position:this.project.parts[i].geometry.center,temperature:null,nodeCount:r.nodes.length,elementCount:r.cells.length,...r.summary}})),connections:[],balance:null}};
  }
  free(){}
}
