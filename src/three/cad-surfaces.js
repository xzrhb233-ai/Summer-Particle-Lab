// Declarative open CAD surfaces. These are reference geometry, never solids or
// shell finite elements. The fixed cubic degrees match the native Python API.
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const keys=(o,allowed)=>{if(!plain(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw Error('曲面参数字段无效');};
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const vec=p=>Array.isArray(p)&&p.length===3&&p.every(x=>finite(x,-100.000001,100.000001));
export function validateSurfaceSpec(input){
  keys(input,['kind','controlPoints','segmentsU','segmentsV']);
  const kind=input.kind;if(!['bilinear','bezier','bspline'].includes(kind))throw Error('请选择四角、Bézier 或 B 样条曲面');
  const rows=input.controlPoints,lo=kind==='bilinear'?2:4,hi=kind==='bilinear'?2:kind==='bezier'?4:8;
  if(!Array.isArray(rows)||rows.length<lo||rows.length>hi||!Array.isArray(rows[0])||rows[0].length<lo||rows[0].length>hi||!rows.every(row=>Array.isArray(row)&&row.length===rows[0].length&&row.every(p=>vec(p)&&p.every(x=>Math.abs(x)<=100))))throw Error(`曲面需要 ${lo===hi?lo:lo+'–'+hi} × ${lo===hi?lo:lo+'–'+hi} 的规则控制点网，每点为三个 ±100 m 内坐标`);
  const segmentsU=input.segmentsU??16,segmentsV=input.segmentsV??16;
  if(![segmentsU,segmentsV].every(n=>Number.isInteger(n)&&n>=4&&n<=64))throw Error('曲面 U / V 分段数须为 4–64 的整数');
  return {kind,controlPoints:structuredClone(rows),segmentsU,segmentsV};
}
export function validateSurface(s){
  if(s?.schema!=='summer-cad-surface/1'||s.kernel!=='SMLib'||s.closed!==false)throw Error('SMLib 开放曲面数据无效');
  const spec=validateSurfaceSpec(s.spec),n=(spec.segmentsU+1)*(spec.segmentsV+1),t=2*spec.segmentsU*spec.segmentsV;
  if(!Array.isArray(s.nodes)||s.nodes.length!==n||!s.nodes.every(vec)||!Array.isArray(s.elements)||s.elements.length!==t||!s.elements.every(e=>Array.isArray(e)&&e.length===3&&new Set(e).size===3&&e.every(i=>Number.isInteger(i)&&i>=0&&i<n)))throw Error('曲面节点或三角网格无效');
  if(!Array.isArray(s.normals)||s.normals.length!==n||!s.normals.every(p=>vec(p)&&Math.abs(Math.hypot(...p)-1)<1e-4))throw Error('曲面法向量无效');
  if(!finite(s.area,1e-12,1e8)||s.areaApproximate!==true||s.boundsApproximate!==true||!s.bounds||!vec(s.bounds.lower)||!vec(s.bounds.upper)||s.bounds.upper.some((x,k)=>x<s.bounds.lower[k]))throw Error('曲面面积或包围盒无效');
  if(s.degreeU!==(spec.kind==='bilinear'?1:3)||s.degreeV!==s.degreeU)throw Error('曲面次数与类型不一致');
  return s;
}
export function normalizeCADSurfaces(input){
  if(input===undefined)return undefined;
  if(!Array.isArray(input)||input.length>16)throw Error('每个项目最多 16 个参考曲面');
  const ids=new Set();return input.map(entry=>{
    keys(entry,['id','name','data']);if(typeof entry.id!=='string'||!/^[-\w]{1,40}$/.test(entry.id)||ids.has(entry.id)||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>80)throw Error('曲面名称或 ID 无效');ids.add(entry.id);
    return {id:entry.id,name:entry.name,data:structuredClone(validateSurface(entry.data))};
  });
}
export function surfaceToOBJ(surface){
  validateSurface(surface);return ['# Summer open CAD surface; not a solid or FEM shell',...surface.nodes.map(p=>'v '+p.join(' ')),...surface.normals.map(p=>'vn '+p.join(' ')),...surface.elements.map(e=>'f '+e.map(i=>`${i+1}//${i+1}`).join(' ')),''].join('\n');
}
export function surfaceToVTK(surface){
  validateSurface(surface);return ['# vtk DataFile Version 3.0','Summer open CAD surface','ASCII','DATASET POLYDATA',`POINTS ${surface.nodes.length} double`,...surface.nodes.map(p=>p.join(' ')),`POLYGONS ${surface.elements.length} ${surface.elements.length*4}`,...surface.elements.map(e=>'3 '+e.join(' ')),`POINT_DATA ${surface.nodes.length}`,'NORMALS surface_normals double',...surface.normals.map(p=>p.join(' ')),''].join('\n');
}
export function createSurfaceTemplate(kind='bezier',rows=4,columns=4,style='saddle'){
  if(kind==='bilinear')rows=columns=2;else if(kind==='bezier')rows=columns=4;
  if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<2||rows>8||columns<2||columns>8)throw Error('控制网尺寸无效');
  const controlPoints=Array.from({length:rows},(_,i)=>Array.from({length:columns},(_,j)=>{
    const u=i/(rows-1)*2-1,v=j/(columns-1)*2-1;
    const height=style==='dome'?.35*(1-u*u)*(1-v*v):style==='wave'?.22*Math.sin(Math.PI*(u+1)/2)*v:.22*u*v;
    return [Number((u*.6).toFixed(6)),Number((.7+height).toFixed(6)),Number((v*.5).toFixed(6))];
  }));
  return validateSurfaceSpec({kind,controlPoints,segmentsU:16,segmentsV:16});
}
