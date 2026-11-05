// All coordinates use the application's existing simulation length unit.
import {compileCAD} from './cad-geometry.js';
export const DEFAULT_DOMAIN={lower:[-64,-48,-64],upper:[64,72,64],cellSize:8,particlesPerAxis:2};
export function domainParameters(input=DEFAULT_DOMAIN){
  if(!input||typeof input!=='object')throw Error('计算域参数无效');
  const {lower,upper,cellSize:h,particlesPerAxis:n}=input;
  if(![lower,upper].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('计算域坐标必须为三个有限数值');
  if(!Number.isFinite(h)||h<4||h>16||!Number.isInteger(n)||n<1||n>4||h/n<1||h/n>4)throw Error('网格尺寸需为 4–16，每轴粒子数为 1–4，粒子间距需为 1–4');
  const size=upper.map((x,a)=>x-lower[a]),cells=upper.map((x,a)=>Math.ceil(x/h-1e-10)-Math.floor(lower[a]/h+1e-10));
  if(lower.some((x,a)=>x < -2400||upper[a]>2400||size[a]<h||cells[a]>60))throw Error('计算域须位于 −2400 至 2400 内，每轴最多 60 个网格且至少一个网格');
  // Snap the background origin to the world grid. Two guard cells provide the
  // full quadratic B-spline stencil even at a domain boundary.
  const origin=lower.map(x=>Math.floor(x/h)*h-2*h),nodes=upper.map((x,a)=>Math.ceil((x-origin[a])/h)+3);
  return {lower:lower.slice(),upper:upper.slice(),cellSize:h,particlesPerAxis:n,spacing:h/n,size,cells,nodes,origin,particlesPerCell:n**3};
}
export function rotationXYZ(degrees=[0,0,0]){
  if(!Array.isArray(degrees)||degrees.length!==3||!degrees.every(x=>Number.isFinite(x)&&Math.abs(x)<=360))throw Error('旋转角度需在 −360° 至 360° 之间');
  const [x,y,z]=degrees.map(x=>x*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return [cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx,sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx,-sy,cy*sx,cy*cx];
}
export const transform=(R,p)=>[0,1,2].map(a=>R[a*3]*p[0]+R[a*3+1]*p[1]+R[a*3+2]*p[2]);
export const untransform=(R,p)=>[0,1,2].map(a=>R[a]*p[0]+R[a+3]*p[1]+R[a+6]*p[2]);
export function geometryParameters(d,domain){
  const shape=d.shape||'box',rotation=d.rotation||[0,0,0];
  const center=d.center??d.a?.map((x,a)=>(x+d.b[a])/2),size=d.size??d.a?.map((x,a)=>Math.abs(d.b[a]-x));
  if(!['box','ellipsoid','cylinder','cad'].includes(shape)||![center,size].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||size.some(x=>x<=0||x>480))throw Error('几何中心与尺寸无效');
  const R=rotationXYZ(rotation),half=size.map(x=>x*.5);
  const extent=[0,1,2].map(a=>['box','cad'].includes(shape)?half.reduce((sum,h,k)=>sum+Math.abs(R[a*3+k])*h,0):shape==='ellipsoid'?Math.hypot(...half.map((h,k)=>R[a*3+k]*h)):Math.hypot(R[a*3]*half[0],R[a*3+2]*half[2])+Math.abs(R[a*3+1])*half[1]);
  const lower=center.map((x,a)=>x-extent[a]),upper=center.map((x,a)=>x+extent[a]);
  if(lower.some((x,a)=>x<domain.lower[a]-1e-8||upper[a]>domain.upper[a]+1e-8))throw Error('旋转后的几何超出计算域，请调整位置、尺寸或计算域');
  const cadContains=shape==='cad'?compileCAD(d.cad):null;
  const fraction=shape==='cad'?d.cad.volume/d.cad.upper.reduce((v,x,k)=>v*(x-d.cad.lower[k]),1):1;
  const volume=size.reduce((a,b)=>a*b,1)*(shape==='ellipsoid'?Math.PI/6:shape==='cylinder'?Math.PI/4:fraction),spacing=domain.spacing;
  const first=lower.map(x=>Math.ceil(x/spacing-.5-1e-10)),last=upper.map(x=>Math.ceil(x/spacing-.5-1e-10)-1);
  const candidates=first.reduce((n,x,a)=>n*Math.max(0,last[a]-x+1),1);
  if(candidates>4_000_000)throw Error('几何候选采样超过 400 万，请增大粒子间距或减小尺寸');
  return {shape,center:center.slice(),size:size.slice(),rotation:rotation.slice(),R,lower,upper,volume,spacing,first,last,candidates,cadContains,estimate:Math.round(volume/spacing**3)};
}
export function insideGeometry(g,p){const q=untransform(g.R,p.map((v,a)=>v-g.center[a])).map((v,a)=>2*v/g.size[a]);return q.every(x=>Math.abs(x)<=1+1e-10)&&(g.shape==='cad'?g.cadContains(q):g.shape==='box'||(g.shape==='ellipsoid'?q[0]**2+q[1]**2+q[2]**2:q[0]**2+q[2]**2)<=1+1e-10);}
export function geometryPoints(g,capacity){
  const points=[];
  for(let z=g.first[2];z<=g.last[2];z++)for(let y=g.first[1];y<=g.last[1];y++)for(let x=g.first[0];x<=g.last[0];x++){
    const p=[x,y,z].map(v=>(v+.5)*g.spacing);
    if(insideGeometry(g,p)){points.push(p);if(points.length>capacity)throw Error('粒子容量不足，请增大粒子间距或减小几何');}
  }
  if(!points.length)throw Error('几何内没有采样点，请减小粒子间距或增大尺寸');
  return points;
}
