import {validateCADRecipe} from '../three/cad-geometry.js';

export const PARAMETRIC_SCHEMA='summer-parametric/1';
const field=(key,label,value,{min=.01,max=12,step=.01,unit='m'}={})=>Object.freeze({key,label,unit,min,max,step,default:value});
export const PARAMETRIC_TEMPLATES=Object.freeze([
  {id:'l-bracket',label:'L 形支架',description:'XY 平面 L 形轮廓，沿局部 Z 对称拉伸。',fields:[
    field('width','外宽',.8),field('height','外高',.6),field('legThickness','腿厚',.2),field('depth','拉伸深度',.5)]},
  {id:'sleeve',label:'空心套筒',description:'矩形截面绕局部 Y 轴旋转，保留内孔。',fields:[
    field('innerRadius','内半径',.2,{max:6}),field('outerRadius','外半径',.4,{max:6}),field('height','高度',.6),field('angle','旋转角度',360,{min:1,max:360,step:1,unit:'deg'})]},
  {id:'four-hole-plate',label:'四孔板',description:'XZ 平面板体，四个沿局部 Y 贯通的圆孔。',fields:[
    field('width','板宽 X',.9),field('height','板高 Z',.7),field('thickness','板厚 Y',.16),field('holeDiameter','孔径',.14),field('pitchX','孔距 X',.5),field('pitchZ','孔距 Z',.4)]},
].map(t=>Object.freeze({...t,fields:Object.freeze(t.fields)})));

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const issue=(code,field,message)=>({code,field,severity:'error',message});
function fail(issues){const error=Error(issues.map(i=>i.message).join('；'));error.issues=issues;throw error;}
function templateFor(id){
  const template=PARAMETRIC_TEMPLATES.find(t=>t.id===id);
  if(!template)fail([issue('parametric.template','template','未知参数化模板')]);
  return template;
}
function parameterObject(parameters,template,{partial=false}={}){
  if(!plain(parameters))fail([issue('parametric.parameters','parameters','参数须为仅包含数值字段的对象')]);
  const issues=[],keys=new Set(template.fields.map(f=>f.key)),result={};
  for(const key of Object.keys(parameters))if(!keys.has(key))issues.push(issue('parametric.unknown',key,'未知参数：'+key));
  for(const f of template.fields){
    if(partial&&!Object.hasOwn(parameters,f.key))continue;
    const value=parameters[f.key];
    if(typeof value!=='number'||!Number.isFinite(value))issues.push(issue('parametric.number',f.key,f.label+'须为有限数值'));
    else if(value<f.min||value>f.max)issues.push(issue('parametric.range',f.key,`${f.label}须为 ${f.min}–${f.max} ${f.unit==='deg'?'°':f.unit}`));
    else result[f.key]=value;
  }
  if(issues.length)fail(issues);
  return result;
}

export function createParametricSpec(template,parameters={}){
  const definition=templateFor(template),patch=parameterObject(parameters,definition,{partial:true});
  return validateParametricSpec({schema:PARAMETRIC_SCHEMA,template,parameters:{...Object.fromEntries(definition.fields.map(f=>[f.key,f.default])),...patch}});
}

export function validateParametricSpec(spec){
  if(!plain(spec))fail([issue('parametric.schema','modeling','参数化建模数据无效')]);
  const fields=['schema','template','parameters'],unknown=Object.keys(spec).filter(k=>!fields.includes(k));
  if(unknown.length)fail(unknown.map(k=>issue('parametric.unknown',k,'未知建模字段：'+k)));
  if(spec.schema!==PARAMETRIC_SCHEMA)fail([issue('parametric.schema','schema','参数化建模格式须为 '+PARAMETRIC_SCHEMA)]);
  const template=templateFor(spec.template),p=parameterObject(spec.parameters,template),issues=[];
  if(template.id==='l-bracket'){
    if(p.legThickness>=p.width)issues.push(issue('parametric.fit','legThickness','腿厚须小于外宽'));
    if(p.legThickness>=p.height)issues.push(issue('parametric.fit','legThickness','腿厚须小于外高'));
  }else if(template.id==='sleeve'){
    if(p.outerRadius<=p.innerRadius)issues.push(issue('parametric.fit','outerRadius','外半径须大于内半径'));
    else if(p.outerRadius-p.innerRadius<.01-1e-12)issues.push(issue('parametric.clearance','outerRadius','套筒壁厚须至少为 0.01 m'));
  }else{
    if(p.holeDiameter>=p.pitchX)issues.push(issue('parametric.clearance','pitchX','X 向孔距须大于孔径，圆孔不能相交或相切'));
    if(p.holeDiameter>=p.pitchZ)issues.push(issue('parametric.clearance','pitchZ','Z 向孔距须大于孔径，圆孔不能相交或相切'));
    if(p.pitchX+p.holeDiameter>=p.width-1e-12)issues.push(issue('parametric.fit','pitchX','X 向孔距加孔径须小于板宽，圆孔须完整位于板内'));
    if(p.pitchZ+p.holeDiameter>=p.height-1e-12)issues.push(issue('parametric.fit','pitchZ','Z 向孔距加孔径须小于板高，圆孔须完整位于板内'));
  }
  if(issues.length)fail(issues);
  const result={schema:PARAMETRIC_SCHEMA,template:template.id,parameters:p};
  try{validateCADRecipe(recipeFor(result));}catch(error){fail([issue('parametric.recipe','parameters',error.message)]);}
  return result;
}

export function patchParametricSpec(spec,patch){
  const before=validateParametricSpec(spec),parameters=parameterObject(patch,templateFor(before.template),{partial:true});
  return validateParametricSpec({...before,parameters:{...before.parameters,...parameters}});
}

// Every recipe uses local coordinates. Bounds are centered even for a partial
// revolution; only the part's geometry.center/rotation determine placement.
function sleeveCenter({innerRadius,outerRadius,angle}){
  if(angle===360)return [0,0,0];
  const angles=[0,angle,...[90,180,270].filter(a=>a<angle)],points=angles.flatMap(a=>[innerRadius,outerRadius].map(r=>[r*Math.cos(a*Math.PI/180),-r*Math.sin(a*Math.PI/180)]));
  const axis=k=>-(Math.min(...points.map(p=>p[k]))+Math.max(...points.map(p=>p[k])))/2;
  return [axis(0),0,axis(1)].map(v=>Math.abs(v)<1e-14?0:v);
}
function recipeFor({template,parameters:p}){
  const base={operation:'base',center:[0,0,0],rotation:[0,0,0]};let recipe;
  if(template==='l-bracket'){
    const x=-p.width/2,y=-p.height/2,t=p.legThickness;
    recipe=[{...base,shape:'extrude',profile:[[x,y],[-x,y],[-x,y+t],[x+t,y+t],[x+t,-y],[x,-y]],depth:p.depth}];
  }else if(template==='sleeve')recipe=[{...base,center:sleeveCenter(p),shape:'revolve',profile:[[p.innerRadius,-p.height/2],[p.outerRadius,-p.height/2],[p.outerRadius,p.height/2],[p.innerRadius,p.height/2]],angle:p.angle}];
  else recipe=[{...base,shape:'box',size:[p.width,p.thickness,p.height]},...[-p.pitchX/2,p.pitchX/2].flatMap(x=>[-p.pitchZ/2,p.pitchZ/2].map(z=>({shape:'cylinder',operation:'difference',center:[x,0,z],size:[p.holeDiameter,Math.min(12,p.thickness+Math.max(.02,p.thickness*.1)),p.holeDiameter],rotation:[0,0,0]})))];
  return recipe;
}
export function compileParametricRecipe(spec){
  return validateCADRecipe(recipeFor(validateParametricSpec(spec)));
}

export function diffParametricSpec(before,after){
  const a=before==null?null:validateParametricSpec(before),b=validateParametricSpec(after),template=templateFor(b.template);
  return template.fields.filter(f=>!a||a.template!==b.template||a.parameters[f.key]!==b.parameters[f.key]).map(f=>({field:f.key,label:f.label,before:a?.template===b.template?a.parameters[f.key]:null,after:b.parameters[f.key],unit:f.unit}));
}

// The spec is authoring provenance and is never projected into a material or
// solver input. Scaling keeps that provenance; parameter update tools separately
// reject scaled bodies until their size is restored to the native CAD bounds.
export function validateParametricPart(part){
  if(part.modeling==null)return undefined;
  try{
    const spec=validateParametricSpec(part.modeling);
    if(part.geometry?.shape!=='cad'||!part.geometry.cad)fail([issue('parametric.geometry','modeling','参数化建模数据需要 CAD 实体')]);
    let actual;
    try{actual=validateCADRecipe(part.geometry.cad.recipe);}catch(error){fail([issue('parametric.recipe','geometry.cad.recipe',error.message)]);}
    if(JSON.stringify(actual)!==JSON.stringify(compileParametricRecipe(spec)))fail([issue('parametric.stale','modeling','参数化参数与 CAD 特征不一致，请重新生成实体或移除参数化建模数据')]);
    return spec;
  }catch(error){
    if(error.issues)error.issues=error.issues.map(i=>({...i,...(part.id?{target:part.id}:{})}));
    throw error;
  }
}
