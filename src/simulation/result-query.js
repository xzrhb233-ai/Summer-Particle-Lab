// Read-only bounded numerical queries. Mesh arrays stay inside the application.
import {configurationId} from './workspace-context.js';
import {assessSimulation} from './vv-diagnostics.js';

export const RESULT_QUERY_FIELDS=Object.freeze(['displacement','temperature','stress','maxDisplacement','maxTemperature','maxVonMises','normalForce','heatRate','maxPenetration']);
export const RESULT_QUERY_ARGS=Object.freeze(['kind','partId','field','contactId','limit']);
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const vector=v=>(Array.isArray(v)||ArrayBuffer.isView(v))&&v.length===3&&Array.from(v).every(Number.isFinite)?Array.from(v):null;
const norm=v=>vector(v)?Math.hypot(...v):null;
const values=v=>Array.isArray(v)||ArrayBuffer.isView(v)?v:null;
export function validateResultQuery(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||![Object.prototype,null].includes(Object.getPrototypeOf(args)))throw Error('结果查询须为普通对象');
  for(const k of Object.keys(args))if(!RESULT_QUERY_ARGS.includes(k))throw Error('结果查询不允许字段：'+k);
  if(!['extrema','contacts','series','quality'].includes(args.kind))throw Error('结果查询类型须为 extrema/contacts/series/quality');
  if(args.kind==='quality'&&Object.keys(args).some(k=>k!=='kind'))throw Error('可信度查询仅接受 kind:quality，使用软件预设筛查阈值');
  for(const k of ['partId','contactId'])if(args[k]!==undefined&&(typeof args[k]!=='string'||!/^[-\w]{1,40}$/.test(args[k])))throw Error('结果查询 ID 无效');
  if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<2||args.limit>100))throw Error('查询数量须为 2–100');
  if(args.kind==='extrema'&&(!['displacement','temperature','stress'].includes(args.field)||args.contactId!==undefined))throw Error('极值查询需要 displacement/temperature/stress');
  if(args.kind==='contacts'&&(args.field!==undefined||args.partId!==undefined))throw Error('接触摘要只接受 contactId 和 limit');
  if(args.kind==='series'){
    const fields=args.contactId?['normalForce','heatRate','maxPenetration']:['maxDisplacement','temperature','maxTemperature','maxVonMises'];
    if(!fields.includes(args.field)||args.contactId&&args.partId||!args.contactId&&!args.partId)throw Error('时程查询须指定一个部件或接触对及支持的字段');
  }
  return {...args};
}
const available=f=>!!f&&!f.preview&&!(f.fem?.analysis==='linear-static'&&!f.fem.solved);
const rows=f=>f.results?.parts??[];
const femPart=(f,id)=>f.fem?.parts?.find(p=>p.id===id);
const unit=field=>({displacement:'m',maxDisplacement:'m',temperature:'degC',maxTemperature:'degC',stress:'Pa',maxVonMises:'Pa',normalForce:'N',heatRate:'W',maxPenetration:'m'}[field]);
function location(part,index,element=false){
  if(!part?.nodes)return null;
  if(!element)return vector(part.nodes[index]);
  const cell=part.cells?.[index];if(!Array.isArray(cell)||cell.length!==4)return null;
  const points=cell.map(n=>vector(part.nodes[n]));return points.every(Boolean)?[0,1,2].map(k=>points.reduce((s,p)=>s+p[k],0)/4):null;
}
function extrema(f,id,field){
  const p=femPart(f,id),v=rows(f).find(p=>p.id===id)?.values??{},s=p?.summary??v;
  let array,source='summary',element=false;
  if(field==='displacement'&&values(p?.displacement)?.length){array=[];for(let i=0;i<p.displacement.length;i+=3)array.push(norm(Array.from(p.displacement.slice(i,i+3))));source='FEM nodal displacement magnitude';}
  if(field==='temperature'&&values(p?.temperature)?.length){array=p.temperature;source='FEM nodal temperature';}
  if(field==='stress'&&values(p?.vonMises)?.length){array=p.vonMises;source='FEM element von Mises stress';element=true;}
  let min=null,max=null,minIndex=null,maxIndex=null;
  if(array){for(let i=0;i<array.length;i++){const n=finite(array[i]);if(n===null)continue;if(min===null||n<min){min=n;minIndex=i;}if(max===null||n>max){max=n;maxIndex=i;}}}
  else if(field==='temperature'){
    min=finite(s.minTemperature);max=finite(s.maxTemperature);
    const body=f.bodies?.find(b=>b.id===id);if(body&&min===null&&max===null){min=max=finite(body.temperature??v.temperature);source='lumped body temperature';}
  }else if(field==='displacement'){
    max=finite(s.maxDisplacement);const d=norm(v.displacement);if(max===null&&d!==null){min=max=d;source='body reference displacement magnitude';}
  }else max=finite(s.maxVonMises);
  return {partId:id,field,unit:unit(field),available:min!==null||max!==null,min,max,minLocation:location(p,minIndex,element),maxLocation:location(p,maxIndex,element),locationSpace:'undeformed world coordinates',source,reason:min===null&&max===null?'此帧未提供该场量；未从材料参数或显示颜色推算。':null};
}
function contactSummary(r){
  return {id:r.id,a:r.a,b:r.b,force:vector(r.force),normalForce:finite(r.normalForce),tangentialForce:norm(r.tangentialForce),heatRate:finite(r.heatRate),accumulatedHeat:finite(r.accumulatedHeat),maxPenetration:finite(r.maxPenetration),samples:finite(r.samples),thermalSamples:finite(r.thermalSamples)};
}
function scalar(f,args){
  if(args.contactId)return finite((f.contactPairs??f.results?.contactPairs??[]).find(p=>p.id===args.contactId)?.[args.field]);
  const summary=femPart(f,args.partId)?.summary??rows(f).find(p=>p.id===args.partId)?.values;
  return finite(summary?.[args.field]);
}

export function queryProjectResults({project,frame=null,frames=[],resultProject=null},input){
  const origins=new WeakMap(),originID=p=>{if(!p)return null;if(!origins.has(p))origins.set(p,configurationId(p));return origins.get(p);};
  const args=validateResultQuery(input),currentConfigurationId=originID(project),resultConfigurationId=originID(resultProject);
  const meta={kind:args.kind,currentConfigurationId,resultConfigurationId,matchesCurrentConfiguration:resultConfigurationId!==null&&resultConfigurationId===currentConfigurationId,time:finite(frame?.time)};
  if(args.kind==='quality')return {...meta,available:available(frame)&&!!resultProject,data:assessSimulation({project,frame,resultProject,history:frames}),reason:'仅返回已有测量和适用性筛查，未建立实验确认；not-assessed 不能解释为通过。'};
  if(!available(frame))return {...meta,available:false,reason:frame?.preview?'当前只有几何预览，没有求解结果。':'当前没有已求解结果。',data:null};
  if(!resultProject)return {...meta,available:false,reason:'结果配置来源未知，不能将其归属于当前模型。',data:null};
  if(args.kind==='series'){
    // A raw frame is allowed only when the caller supplies its shared run origin.
    // Wrapped samples can carry independent origins; never merge different runs.
    const eligible=[];let omitted=0;
    for(const item of frames){
      const f=item.frame??item,origin=item.frame?item.resultProject:resultProject;
      if(!available(f)||!origin||originID(origin)!==resultConfigurationId||finite(f.time)===null||f.time>frame.time+1e-9){omitted++;continue;}
      eligible.push({time:f.time,value:scalar(f,args)});
    }
    eligible.sort((a,b)=>a.time-b.time);const limit=args.limit??50;
    const data=eligible.length<=limit?eligible:Array.from({length:limit},(_,i)=>eligible[Math.round(i*(eligible.length-1)/(limit-1))]);
    return {...meta,available:data.some(p=>p.value!==null),field:args.field,unit:unit(args.field),partId:args.partId??null,contactId:args.contactId??null,data,sampleCount:eligible.length,returnedCount:data.length,omittedSamples:omitted,downsampled:eligible.length>limit,reason:data.some(p=>p.value!==null)?null:'没有来自该配置且包含所请求量的已记录时程；缺失值为 null。'};
  }
  if(args.kind==='contacts'){
    const list=(frame.contactPairs??frame.results?.contactPairs??[]).filter(r=>!args.contactId||r.id===args.contactId),limit=Math.min(args.limit??32,64),data=list.slice(0,limit).map(contactSummary);
    return {...meta,available:!!data.length,data,totalCount:list.length,truncated:list.length>limit,units:{force:'N',normalForce:'N',tangentialForce:'N',heatRate:'W',accumulatedHeat:'J',maxPenetration:'m'},reason:data.length?null:'此帧没有所请求接触对的测量。'};
  }
  const limit=Math.min(args.limit??16,64),ids=args.partId?[args.partId]:resultProject.parts.slice(0,limit).map(p=>p.id),data=ids.map(id=>extrema(frame,id,args.field));
  return {...meta,available:data.some(v=>v.available),data,totalCount:args.partId?1:resultProject.parts.length,truncated:!args.partId&&resultProject.parts.length>limit};
}
