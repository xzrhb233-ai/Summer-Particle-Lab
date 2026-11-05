import {cantileverProject} from './model.js';
import {FEMSimulation} from './solver.js';
export function tipDisplacement(part,face='x+'){
  const triangles=part.surface.filter(t=>t.face===face||t.surfaceKey===face),area=triangles.reduce((s,t)=>s+t.area,0),tip=[0,0,0];
  if(!(area>0))return [null,null,null];
  for(const t of triangles)for(const n of t.nodes)for(let k=0;k<3;k++)tip[k]+=t.area/(3*area)*part.displacement[n*3+k];
  return tip;
}
export function beamReference(project){
  if(project.parts.length!==1||project.environment.gravity.some(x=>x!==0))return null;
  const p=project.parts[0],loads=project.loads.filter(l=>l.target===p.id),force=loads.find(l=>l.type==='fem-force');
  if(p.geometry.shape!=='box')return null;
  const face=l=>{const r=project.selectionSets.find(s=>s.id===l?.selection)?.region;return r?.type==='face'?r.face:r?.surface?.startsWith('box:')?r.surface.slice(4):null;};
  if(p.geometry.rotation.some(x=>x!==0)||loads.length!==2||face(loads.find(l=>l.type==='fem-fixed'))!=='x-'||face(force)!=='x+'||force.force[0]!==0||force.force[2]!==0||force.force[1]===0)return null;
  const [L,h,b]=p.geometry.size,E=p.material.young,I=b*h**3/12;
  return {dy:force.force[1]*L**3/(3*E*I),label:'Euler–Bernoulli · 端面总力 · 不含剪切变形'};
}
export function runFEMValidation(){
  const rows=[];
  for(const divisions of [[12,2,2],[24,4,4],[48,8,8]]){
    const p=cantileverProject({divisions}),s=new FEMSimulation(p),f=s.step().fem.parts[0],reference=beamReference(p),dy=tipDisplacement(f)[1];
    rows.push({divisions,nodes:f.nodes.length,elements:f.cells.length,dy,reference:reference.dy,relativeError:Math.abs(dy/reference.dy-1),iterations:f.iterations,residual:f.relativeResidual,
      forceBalance:Math.hypot(...f.summary.forceBalance),momentBalance:Math.hypot(...f.summary.momentBalance),solveMs:f.summary.solveMs});
  }
  return {schema:'summer-fem-validation/1',rows,checks:{
    residual:rows.every(r=>r.residual<=1.05e-8),forceBalance:rows.every(r=>r.forceBalance<1e-5),momentBalance:rows.every(r=>r.momentBalance<1e-5),
    refinement:rows[2].relativeError<rows[1].relativeError&&rows[1].relativeError<rows[0].relativeError,
    fineBeamError:rows[2].relativeError<.1},
    note:'Tet4 弯曲偏硬；比较端面面积加权平均位移与细长梁理论。固定端局部应力不作为收敛判据。'};
}
