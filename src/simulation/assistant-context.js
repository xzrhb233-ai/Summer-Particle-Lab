// Outbound project data only. Never expose the CAD tessellation to the model:
// it is large, not editable feature data, and can exceed a provider's context.
import {validateCurveSpec} from '../three/cad-tools.js';
import {validateSurfaceSpec} from '../three/cad-surfaces.js';
import {validateCADRecipe} from '../three/cad-geometry.js';
import {PARAMETRIC_TEMPLATES,validateParametricSpec} from './cad-parametric.js';
import {listPartSurfaces} from './surface-selections.js';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const blocked=new Set(['__proto__','prototype','constructor']);
function arrayData(value,max=Infinity){
  if(!Array.isArray(value)||value.length>max)return null;
  const result=[];for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!own(d,'value'))return null;result.push(d.value);}return result;
}
const vectorData=(value,limit=Infinity)=>{const a=arrayData(value,3);return a?.length===3&&a.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=limit)?a:null;};
const vector=(value,limit=Infinity)=>!!vectorData(value,limit);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const id=value=>typeof value==='string'&&/^[-\w]{1,40}$/.test(value);

function field(value,key){
  if(!plain(value))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  // Context generation must not execute getters in arbitrary draft data.
  return descriptor&&own(descriptor,'value')?descriptor.value:undefined;
}
function cloneData(value,path=[]){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(Array.isArray(value))return (arrayData(value)??[]).map((v,i)=>cloneData(v,[...path,i]));
  if(!plain(value))throw Error('助手上下文必须为普通项目数据');
  const copy={};
  for(const key of Object.keys(value)){
    if(blocked.has(key))continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!own(descriptor,'value'))continue;
    const item=descriptor.value;
    if(item===undefined)continue;
    if(key==='modeling'&&path.length===2&&path[0]==='parts'){const spec=compactParametricSpec(item);if(spec)copy.modeling=spec;}
    else if(key==='cad'&&path.length===3&&path[0]==='parts'&&path[2]==='geometry')copy.cad=compactCAD(item,value);
    else if(key==='mesh'&&path.length===3&&path[0]==='parts'&&path[2]==='discretization')copy.mesh=compactTetMesh(item);
    else if(key==='data'&&path.length===2&&path[0]==='cadCurves')copy.data=compactCurve(item);
    else if(key==='data'&&path.length===2&&path[0]==='cadSurfaces')copy.data=compactSurface(item);
    else copy[key]=cloneData(item,[...path,key]);
  }
  return copy;
}

function compactParametricSpec(input){
  const template=field(input,'template'),definition=PARAMETRIC_TEMPLATES.find(t=>t.id===template);
  if(!definition)return null;
  const raw=field(input,'parameters'),parameters={};
  for(const f of definition.fields){const value=field(raw,f.key);if(typeof value!=='number'||!Number.isFinite(value))return null;parameters[f.key]=value;}
  try{return validateParametricSpec({schema:field(input,'schema'),template,parameters});}catch{return null;}
}

function editableParameters(spec){
  return PARAMETRIC_TEMPLATES.find(t=>t.id===spec.template).fields.map(f=>({...f,value:spec.parameters[f.key]}));
}

function compactParametricDraft(draft){
  if(draft==null)return null;
  const modeling=compactParametricSpec(field(draft,'modeling')),result=modeling?{valid:true,modeling,editableParameters:editableParameters(modeling)}:{valid:false,reason:'参数化草稿无效；请修正模板参数。'};
  for(const key of ['name'])if(text(field(draft,key),80))result[key]=field(draft,key);
  if(id(field(draft,'sourcePartId')))result.sourcePartId=field(draft,'sourcePartId');
  if(['mpm','pbf','fem'].includes(field(draft,'method')))result.method=field(draft,'method');
  for(const key of ['center','rotation']){const v=vectorData(field(draft,key),key==='center'?100:360);if(v)result[key]=v;}
  for(const key of ['unsavedChanges','previewCurrent'])if(typeof field(draft,key)==='boolean')result[key]=field(draft,key);
  result.coordinateSpace='local-template-with-explicit-part-placement';result.previewIsSimulationResult=false;return result;
}

function compactRecipe(recipe){
  const items=arrayData(recipe,8);if(!items||items.length<1)return null;
  const steps=[],labels=[];
  for(const [i,source] of items.entries()){
    if(!plain(source))return null;
    const shape=field(source,'shape'),operation=field(source,'operation'),center=vectorData(field(source,'center'),100),rotation=vectorData(field(source,'rotation'),360);
    if(!['box','sphere','cylinder','extrude','revolve'].includes(shape)||!(i?['union','difference','intersection']:['base']).includes(operation)||!center||!rotation)return null;
    const step={shape,operation,center,rotation};
    if(shape==='extrude'||shape==='revolve'){
      const raw=arrayData(field(source,'profile'),32);if(!raw||raw.length<3)return null;
      const profile=raw.map(p=>arrayData(p,2));if(profile.some(p=>!p||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>6)))return null;
      const key=shape==='extrude'?'depth':'angle',amount=field(source,key);if(typeof amount!=='number'||!Number.isFinite(amount))return null;
      step.profile=profile;step[key]=amount;
    }else{
      const size=vectorData(field(source,'size'));if(!size)return null;step.size=size;
    }
    const label={};if(id(field(source,'id')))label.id=field(source,'id');
    if(text(field(source,'name'),80))label.name=field(source,'name');
    labels.push(label);
    steps.push(step);
  }
  // Shared geometric validity catches self-intersecting/degenerate profiles
  // after the field whitelist has removed arbitrary properties and accessors.
  try{return validateCADRecipe(steps).map((step,i)=>({...step,...labels[i]}));}catch{return null;}
}

function compactCAD(cad,geometry){
  const summary={};
  for(const key of ['schema','kernel','version'])if(typeof field(cad,key)==='string')summary[key]=field(cad,key);
  if(typeof field(cad,'closed')==='boolean')summary.closed=field(cad,'closed');
  for(const key of ['lower','upper'])if(vector(field(cad,key)))summary[key]=vectorData(field(cad,key));
  if(Number.isFinite(field(cad,'volume')))summary.volume=field(cad,'volume');
  const recipe=compactRecipe(field(cad,'recipe'));if(recipe)summary.recipe=recipe;
  const vertices=field(cad,'vertices'),indices=field(cad,'indices');
  summary.mesh={omitted:true,vertexCount:Array.isArray(vertices)?vertices.length:0,triangleCount:Array.isArray(indices)?Math.floor(indices.length/3):0};
  summary.recipeCoordinateSpace='original-recipe-before-whole-part-transform';
  const center=vectorData(field(geometry,'center')),size=vectorData(field(geometry,'size')),rotation=vectorData(field(geometry,'rotation'));
  if(vector(center)&&vector(size)&&size.every(n=>n>0)&&vector(rotation)&&summary.lower&&summary.upper&&summary.upper.every((n,k)=>n>summary.lower[k])){
    const scale=size.map((n,k)=>n/(summary.upper[k]-summary.lower[k]));
    summary.worldPlacement={center:center.slice(),size:size.slice(),rotation:rotation.slice(),scaleFromRecipeBounds:scale};
    if(Number.isFinite(summary.volume))summary.worldPlacement.volume=summary.volume*scale.reduce((product,n)=>product*n,1);
  }
  return summary;
}

function compactTetMesh(mesh){
  const result={omitted:true};
  for(const key of ['schema','coordinates'])if(typeof field(mesh,key)==='string')result[key]=field(mesh,key);
  for(const [key,count] of [['nodes','nodeCount'],['elements','elementCount'],['surface','surfaceTriangleCount']]){const a=field(mesh,key);result[count]=Array.isArray(a)?a.length:0;}
  const source=field(mesh,'source'),safe={};
  const recipe=compactRecipe(field(source,'recipe'));if(recipe)safe.recipe=recipe;
  for(const key of ['lower','upper'])if(vector(field(source,key)))safe[key]=vectorData(field(source,key));
  if(Object.keys(safe).length)result.source=safe;
  result.coordinateSpace='original-recipe-before-whole-part-transform';
  result.editing='Regenerate with cad.update after changing CAD features; never supply nodes or connectivity in assistant commands.';
  return result;
}

function compactCurveSpec(input){
  const kind=field(input,'kind');if(!['line','circle','arc','bezier','bspline'].includes(kind))return null;
  const fields={line:['points'],circle:['center','radius','rotation'],arc:['center','radius','rotation','startAngle','endAngle'],bezier:['controlPoints'],bspline:['controlPoints','degree']}[kind];
  const spec={kind};
  for(const key of [...fields,'samples']){
    const value=field(input,key);if(value===undefined)continue;
    if(['center','rotation'].includes(key)){const v=vectorData(value,key==='rotation'?360:100);if(!v)return null;spec[key]=v;}
    else if(['points','controlPoints'].includes(key)){
      const a=arrayData(value,kind==='line'?2:kind==='bezier'?9:32);if(!a)return null;
      const points=a.map(p=>vectorData(p,100));if(points.some(p=>!p))return null;spec[key]=points;
    }else if(typeof value==='number'&&Number.isFinite(value))spec[key]=value;
    else return null;
  }
  try{return validateCurveSpec(spec);}catch{return null;}
}

function compactCurve(curve){
  const result={};
  for(const key of ['schema','kernel','version'])if(typeof field(curve,key)==='string')result[key]=field(curve,key);
  const spec=compactCurveSpec(field(curve,'spec'));if(spec)result.spec=spec;
  for(const key of ['closed','boundsApproximate'])if(typeof field(curve,key)==='boolean')result[key]=field(curve,key);
  if(Number.isFinite(field(curve,'length'))&&field(curve,'length')>0)result.length=field(curve,'length');
  const bounds=field(curve,'bounds'),lower=vectorData(field(bounds,'lower')),upper=vectorData(field(bounds,'upper'));
  if(lower&&upper)result.bounds={lower,upper};
  const points=field(curve,'points');result.pointCount=Array.isArray(points)?points.length:0;result.pointsOmitted=true;
  result.coordinateSpace='world';result.role='construction-geometry; not a physical part, beam element, motion constraint, or load-time curve';
  return result;
}

function compactCurveDraft(draft){
  if(draft==null)return null;
  const spec=compactCurveSpec(field(draft,'spec')),result=spec?{valid:true,spec}:{valid:false,reason:'曲线草稿参数无效；请先修正曲线定义。'};
  for(const key of ['unsavedChanges','previewCurrent'])if(typeof field(draft,key)==='boolean')result[key]=field(draft,key);
  if(text(field(draft,'name'),80))result.name=field(draft,'name');
  if(id(field(draft,'id')))result.id=field(draft,'id');
  result.coordinateSpace='world';result.previewIsSimulationResult=false;
  return result;
}

function compactSurfaceSpec(input){
  const kind=field(input,'kind');if(!['bilinear','bezier','bspline'].includes(kind))return null;
  const source=arrayData(field(input,'controlPoints'),8);if(!source)return null;
  const controlPoints=[];
  for(const raw of source){const row=arrayData(raw,8);if(!row)return null;const points=row.map(p=>vectorData(p,100));if(points.some(p=>!p))return null;controlPoints.push(points);}
  const spec={kind,controlPoints};
  for(const key of ['segmentsU','segmentsV']){
    const n=field(input,key);if(n!==undefined){if(typeof n!=='number'||!Number.isFinite(n))return null;spec[key]=n;}
  }
  try{return validateSurfaceSpec(spec);}catch{return null;}
}

function compactSurface(surface){
  const result={};
  for(const key of ['schema','kernel','version'])if(typeof field(surface,key)==='string')result[key]=field(surface,key);
  const spec=compactSurfaceSpec(field(surface,'spec'));if(spec)result.spec=spec;
  for(const key of ['closed','areaApproximate','boundsApproximate'])if(typeof field(surface,key)==='boolean')result[key]=field(surface,key);
  if(Number.isFinite(field(surface,'area'))&&field(surface,'area')>0)result.area=field(surface,'area');
  for(const key of ['degreeU','degreeV'])if([1,3].includes(field(surface,key)))result[key]=field(surface,key);
  const bounds=field(surface,'bounds'),lower=vectorData(field(bounds,'lower')),upper=vectorData(field(bounds,'upper'));
  if(lower&&upper)result.bounds={lower,upper};
  const nodes=field(surface,'nodes'),elements=field(surface,'elements'),normals=field(surface,'normals');
  result.mesh={omitted:true,nodeCount:Array.isArray(nodes)?nodes.length:0,triangleCount:Array.isArray(elements)?elements.length:0,normalCount:Array.isArray(normals)?normals.length:0};
  result.coordinateSpace='world';result.role='open reference surface; no closed volume; not an MPM/PBF/FEM/rigid body, shell element, or collision surface';
  return result;
}

function compactSurfaceDraft(draft){
  if(draft==null)return null;
  const spec=compactSurfaceSpec(field(draft,'spec')),result=spec?{valid:true,spec}:{valid:false,reason:'曲面草稿参数无效；请先修正控制网格。'};
  for(const key of ['unsavedChanges','previewCurrent'])if(typeof field(draft,key)==='boolean')result[key]=field(draft,key);
  if(text(field(draft,'name'),80))result.name=field(draft,'name');
  if(id(field(draft,'id')))result.id=field(draft,'id');
  result.coordinateSpace='world';result.previewIsSimulationResult=false;result.role='open reference surface';
  return result;
}

function compactDraft(draft){
  if(draft==null)return null;
  const recipe=compactRecipe(field(draft,'recipe')),curveDraft=compactCurveDraft(field(draft,'curveDraft')),surfaceDraft=compactSurfaceDraft(field(draft,'surfaceDraft')),parametricDraft=compactParametricDraft(field(draft,'parametricDraft'));
  if(!recipe)return {valid:false,reason:'CAD 草稿参数无效；请先修正并保存建模步骤。',...(curveDraft?{curveDraft}:{}),...(surfaceDraft?{surfaceDraft}:{}),...(parametricDraft?{parametricDraft}:{})};
  const result={valid:true,recipe};
  if(curveDraft)result.curveDraft=curveDraft;
  if(surfaceDraft)result.surfaceDraft=surfaceDraft;
  if(parametricDraft)result.parametricDraft=parametricDraft;
  if(text(field(draft,'name'),80))result.name=field(draft,'name');
  if(['mpm','pbf','fem'].includes(field(draft,'method')))result.method=field(draft,'method');
  const selected=field(draft,'selectedStep');if(Number.isInteger(selected)&&selected>=0&&selected<recipe.length)result.selectedStep=selected;
  for(const key of ['unsavedChanges','previewCurrent'])if(typeof field(draft,key)==='boolean')result[key]=field(draft,key);
  if(id(field(draft,'sourcePartId')))result.sourcePartId=field(draft,'sourcePartId');
  const geometry=field(draft,'sourceGeometry');
  if(plain(geometry)){
    const safe={};for(const key of ['center','size','rotation'])if(vector(field(geometry,key)))safe[key]=vectorData(field(geometry,key));
    if(Object.keys(safe).length===3&&safe.size.every(n=>n>0))result.sourceGeometry=safe;
  }
  result.coordinateSpace=result.sourcePartId?'original-recipe-before-whole-part-transform':'world';
  result.previewIsSimulationResult=false;
  return result;
}

export function buildAssistantContext(project,status,cadDraft=null){
  const safeProject=cloneData(project);
  for(const part of safeProject.parts??[]){
    // Catalog generation uses the sanitized data copy; arbitrary authoring
    // accessors must never execute merely because the assistant reads context.
    part.selectableSurfaces=listPartSurfaces(part).map(({key,label,kind,region})=>({key,label,kind,region}));
    if(!part.modeling||part.geometry?.shape!=='cad')continue;
    part.editableParameters=editableParameters(part.modeling);
    const cad=part.geometry.cad,nativeSize=cad.upper?.map((n,k)=>n-cad.lower[k]);
    const allowed=Array.isArray(nativeSize)&&part.geometry.size?.every((n,k)=>Math.abs(n-nativeSize[k])<=1e-7*Math.max(1,Math.abs(n),Math.abs(nativeSize[k])));
    part.parametricEditing={allowed:!!allowed,nativeSize,coordinateSpace:'local-template-with-explicit-part-placement',...(allowed?{}:{reason:'Whole-part scale differs from native CAD bounds. Restore geometry.size to nativeSize before editing parameters; parameter values are original dimensions.'})};
  }
  return {
    project:safeProject,status:cloneData(status),cadDraft:compactDraft(cadDraft),
    capabilities:{
      physics:{selections:['whole','box','face','surface'],loads:['fem-fixed','fem-force','fem-pressure','fixed-selection','thermal-power','thermal-temperature','thermal-convection'],timeCurves:['linear','smooth','step','sine'],bindings:['fem-force','fem-pressure'],thermalSwitch:'solver.configure {thermal:boolean}, explicit CPU transient FEM or CPU MPM–FEM only; never enabled implicitly by a load command.',namedSurfaces:'Use each FEM part.selectableSurfaces catalog. Stable region.surface keys are not arbitrary display labels; unresolved references must be repaired explicitly.'},
      resultQueries:{command:'result.query',kinds:['extrema','contacts','series','quality'],extrema:['displacement','temperature','stress'],partSeries:['maxDisplacement','temperature','maxTemperature','maxVonMises'],contactSeries:['normalForce','heatRate','maxPenetration'],maxQueries:4,maxSeriesPoints:100,readOnly:true,provenance:'Use returned configuration IDs, matchesCurrentConfiguration, availability and null values. No inferred results, mesh arrays, or uncomputed safety conclusions.'},
      cad:{
        kernel:'SMLib',commands:['cad.create','cad.update','cad.parametric.create','cad.parametric.update','cad.mesh','cad.curve.create','cad.curve.update','cad.curve.delete','cad.surface.create','cad.surface.update','cad.surface.delete'],methods:['mpm','pbf','fem'],device:'cpu',
        parametric:{
          schema:'summer-parametric/1',templates:PARAMETRIC_TEMPLATES.map(({id,label,fields})=>({id,label,fields:fields.map(f=>({...f}))})),
          create:'cad.parametric.create: id, method, template, optional parameters, center (default [0,0.7,0]), rotation (default [0,0,0]), name and supported material/support/mesh settings.',
          update:'cad.parametric.update: existing id and partial parameters; no template switch. Preserves part ID, actual center/rotation, unspecified materials, loads and contacts. FEM remeshes automatically. No code, expressions or mesh arrays.',
          constraints:{'l-bracket':'legThickness < width and height','sleeve':'outerRadius - innerRadius >= 0.01 m','four-hole-plate':'holeDiameter < pitchX and pitchZ; pitchX + holeDiameter < width; pitchZ + holeDiameter < height'},
          placement:'Templates build locally at the origin. geometry.center is actual bounds-center placement; geometry.rotation is actual XYZ rotation. Parameters describe native dimensions and cannot be updated while geometry.size is scaled.',
          draft:'cadDraft.parametricDraft is independent of the raw recipe. Valid parameter drafts remain editable when cadDraft.valid is false; unsaved drafts are not saved parts.',
          rawReplacement:'cad.update replaces the recipe and clears parametric modeling metadata.'
        },
        shapes:['box','sphere','cylinder','extrude','revolve'],operations:['base','union','difference','intersection'],
        limits:{maxFeatures:8,maxAbsCoordinate:100,minSize:.01,maxSize:12,maxAbsRotationDegrees:360},
        units:{length:'m',rotation:'XYZ degrees'},cylinderAxis:'Y',
        shapeRules:'sphere requires equal XYZ diameters; cylinder requires equal X/Z diameters; extrude/revolve use profile with depth/angle and have no size field; first feature is base',
        profiles:{
          limits:{minVertices:3,maxVertices:32,maxAbsCoordinate:6,minSpan:.01,maxSpan:12,minDepth:.01,maxDepth:12,minRevolveAngle:1,maxRevolveAngle:360},
          polygon:'One implicitly closed simple polygon; single concave polygons are allowed. No duplicate vertices, repeated closing point, self-intersections, zero area, multiple loops or nested holes.',
          extrude:'Local XY polygon profile, extruded over local Z [-depth/2,+depth/2], then XYZ rotation and center translation. Required profile/depth; forbidden size/angle.',
          revolve:'Local profile coordinates are (r,y), r>=0. Right-handed sweep around +Y starts at +X and moves toward -Z for positive angle, then XYZ rotation and center translation. Required profile/angle; forbidden size/depth.',
          placement:'center is a translation offset of the primitive origin, not necessarily the final bounds center. Part geometry center/size comes from the built kernel bounds.',
          simulation:'Closed profile solids support CPU MPM/PBF and CPU Tet4 FEM through the existing cad.create/update/mesh workflow. They are distinct from reference curves and open surfaces.',
          inputs:'Only explicit polygon coordinates are accepted; no code, expressions, path/curve/surface references or arbitrary sweep scripts.'
        },
        preview:'CAD commands generate a real kernel preview before project changes; viewing a preview does not start simulation or commit a part',
        coordinates:{
          create:'The complete recipe uses world coordinates.',
          update:'The complete replacement recipe uses WORLD coordinates. Do not append world-coordinate features to an original-space recipe without transforming all features.',
          existing:'Stored recipe, lower, upper and volume describe the original CAD before whole-part translation/scaling/rotation. Current geometry center/size/rotation and worldPlacement describe the authoring placement, not the deformed result.',
          mapping:'world = center + Rz(rotation.z) * Ry(rotation.y) * Rx(rotation.x) * (((original - (lower + upper)/2) / (upper - lower)) * size); rotation is in degrees',
          nonuniformScale:'Nonuniform whole-part scaling can turn a sphere/cylinder into a shape this primitive recipe cannot represent; do not silently substitute an equal-diameter primitive.'
        },
        curves:{
          kinds:['line','circle','arc','bezier','bspline'],storage:'project.cadCurves',coordinateSpace:'world',
          limits:{maxCurves:32,minSamples:8,maxSamples:512,maxAbsCoordinate:100,minRadius:.001,maxRadius:12,maxBezierControlPoints:9,maxBSplineControlPoints:32,maxBSplineDegree:5},
          role:'Reference construction geometry, distinct from project.curves load-time functions. Not a physical part or motion constraint.',
          rules:'line: exactly 2 points; circle/arc: XY plane before XYZ rotation; arc: positive sweep below 360 degrees; bezier: 2–9 control points; bspline: degree 1–5 and below control point count.',
          draft:'cadDraft.curveDraft is independent of the solid recipe. A valid curveDraft remains usable even when cadDraft.valid is false; unsaved inputs and preview are not saved project curves.'
        },
        surfaces:{
          kinds:['bilinear','bezier','bspline'],storage:'project.cadSurfaces',coordinateSpace:'world',
          limits:{maxSurfaces:16,minSegmentsPerAxis:4,maxSegmentsPerAxis:64,defaultSegmentsPerAxis:16,maxAbsCoordinate:100,maxControlPointsPerAxis:8},
          rules:'controlPoints[U row][V column][XYZ] is a rectangular world-coordinate grid. bilinear: 2×2 degree 1; bezier: 4×4 degree 3; bspline: 4–8 per axis degree 3. Degrees are chosen by the software, not model parameters.',
          role:'Open reference surfaces with no closed volume. They cannot directly become FEM shell/Tet4 elements, MPM/PBF particles, rigid bodies or collision surfaces; cad.mesh only accepts closed CAD parts.',
          accuracy:'area and bounds are sampled approximations; normals and triangles are display data. Do not report a solid volume.',
          draft:'cadDraft.surfaceDraft is independent of both the solid recipe and curveDraft. A valid surfaceDraft remains usable when those other drafts are invalid. A preview is not a saved project surface.',
          ids:'Surface IDs are independent of curve and physical-part IDs; mutate only the requested namespace.'
        },
        meshing:{
          kinds:['surface','volume'],surface:'SMLib triangle mesh preview; not FEM shell elements',volume:'Positive Tet4 volume elements for CPU FEM',
          options:{targetSize:{default:.15,min:.005,max:12,unit:'m'},angleTolerance:{default:15,min:3,max:45,unit:'degrees'},chordTolerance:{default:.002,min:.00001,max:.1,unit:'m'}},
          limits:{maxVolumeNodes:5000,maxVolumeElements:24000,maxSurfaceNodes:50000,maxSurfaceTriangles:100000,maxBuildsPerPlan:4},
          preview:'cad.mesh is read-only and uses the original CAD recipe coordinates, before whole-part placement. It does not change a part or start simulation.',
          fem:'cad.create method=fem generates a new Tet4 mesh; cad.update existing FEM remeshes the replacement world-coordinate recipe. Only volume meshes are physical FEM bodies. Default fixedFace=y-; every disconnected component needs enough support.',
          gpu:'CAD particle sampling and CAD Tet4 FEM are CPU-only; never silently change the selected device. Reference curve creation and read-only mesh previews do not select a solver.'
        },
        unsupported:['CAD GPU particle sampling','CAD GPU Tet4 FEM','CAD rigid-body collision geometry','FEM shell elements from surface mesh','open reference surface to Tet4/MPM/PBF/rigid conversion','curve extrusion/sweep to solids','STEP/IGES import','fillets','arbitrary scripts']
      }
    },
    scope:'project-only; no source-code or filesystem access'
  };
}
