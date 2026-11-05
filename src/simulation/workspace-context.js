import {projectDevice} from './simple-settings.js';
import {PARAMETRIC_SCHEMA,PARAMETRIC_TEMPLATES} from './cad-parametric.js';

const parametricEnglish={
  templates:{'l-bracket':'L bracket',sleeve:'Hollow sleeve','four-hole-plate':'Four-hole plate'},
  fields:{width:'Width',height:'Height',legThickness:'Leg thickness',depth:'Extrusion depth',innerRadius:'Inner radius',outerRadius:'Outer radius',angle:'Revolution angle',thickness:'Thickness',holeDiameter:'Hole diameter',pitchX:'Hole pitch X',pitchZ:'Hole pitch Z'},
};

// Session documents are replaced on edits. Share one immutable configuration
// per document and stamp frames when produced, including history's cloned frames.
export class ResultOrigins {
  constructor(){this.documents=new WeakMap();this.frames=new WeakMap();}
  capture(frame,project){
    if(!frame||this.frames.has(frame))return;
    if(!this.documents.has(project))this.documents.set(project,structuredClone(project));
    this.frames.set(frame,this.documents.get(project));
  }
  alias(saved,source){if(saved&&this.frames.has(source))this.frames.set(saved,this.frames.get(source));}
  get(frame){return this.frames.get(frame);}
}

// Read-only, deterministic AI context. Unknown measurements stay null.
// Text is generated from the same state; user names are rendered as text only.
export function configurationId(project){
  let hash=2166136261;for(const c of JSON.stringify(project)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return 'cfg-'+(hash>>>0).toString(16).padStart(8,'0');
}
export function actualDevice(frame,project){
  if(!frame||frame.preview)return 'unconfirmed';
  if(frame.mixed?.backend)return 'gpu';
  if(frame.backend)return 'gpu+cpu';
  return projectDevice(project)==='gpu'?'unconfirmed':'cpu';
}
export function buildWorkspaceContext({project,frame=null,resultProject=project,selectedPartId=null,draft={},pending=[],status='ready',error='',target=null,field=null,recorded=false}){
  if(!project)return {schema:'summer-ai-context/1',status:'loading',summaries:{}};
  if(frame?.preview){error=error||frame.reason;status='editing';frame=null;}
  const counts=Object.fromEntries(['mpm','fem','pbf','rigid'].map(m=>[m,project.parts.filter(p=>p.method===m).length]));
  const clock=frame?.mixed?.clock,live=frame?.time??null;
  const particleCount=frame?.coupling?.count??(frame?.particles?frame.particles.length/8:null);
  const id=configurationId(project),resultId=frame?configurationId(resultProject):null;
  const context={schema:'summer-ai-context/1',units:project.units,configurationId:id,
    project:structuredClone(project),draft:structuredClone(draft),pending:[...pending],
    model:{counts,particleCount,selectedPartId,cellSize:project.discretization?.mpm?.cellSize??null,particlesPerCell:project.discretization?.mpm?.particlesPerAxis**3||null},
    physics:{gravity:project.environment?.gravity??null,thermal:project.solver.thermal??project.couplings?.some(c=>c.thermal)??false,
      mechanicalPairs:project.contactPairs?.filter(p=>p.mechanical).length??0,thermalPairs:project.contactPairs?.filter(p=>p.thermal).length??0,loads:structuredClone(project.loads??[])},
    solver:{requestedDevice:projectDevice(project),confirmedDevice:actualDevice(frame,resultProject),status,error:error||null,
      coupling:project.solver.couplingMode??'native',requestedDt:project.solver.dt,timeStepMode:project.solver.timeStepMode??'custom',actualDt:clock?.steps>0?clock.minDt:frame?.fem?.dynamics?.lastDt||null,targetTime:target??project.solver.duration??null},
    result:frame?{configurationId:resultId,configuration:structuredClone(resultProject),matchesCurrentConfiguration:id===resultId,time:live,field,
      backend:actualDevice(frame,resultProject),coupling:frame.mixed?.framework?.couplingMode??resultProject.solver.couplingMode??'native',
      recorded,thermalResidual:frame.thermal?.residual??frame.results?.balance?.thermalResidual??frame.coupling?.thermalResidual??null,
      progress:target>0&&live!==null?Math.min(1,Math.max(0,live/target)):null,retries:frame.mixed?.contactSafety?.retries??null}:null,
    capabilities:{readContext:true,executeAICommands:false},
  };
  return context;
}

export function summaryTokens(c,chapter,en=false){
  const t=(zh,english)=>en?english:zh,n=v=>Number.isFinite(v)?Number(v.toPrecision(5)).toString():'—';
  const out=[],add=(text,tone='')=>out.push({text,tone});
  if(!c.project){add(t('正在加载项目，尚无已确认配置。','Loading; no confirmed configuration.'),'pending');return out;}
  const m=c.model,s=c.solver,p=c.physics,r=c.result;
  if(chapter==='geometry'){
    add(t('已应用模型包含 ','Applied model contains '));
    add(Object.entries(m.counts).map(([k,v])=>`${v} ${k==='rigid'?t('刚体','rigid'):k.toUpperCase()}`).join(' · '),'info');
    add(t('。粒子总数 ','; particles '));add(m.particleCount===null?t('尚未获得','not available'):String(m.particleCount),'info');
    if(m.cellSize!==null){add(t('，MPM 网格间距 ','. MPM cell size '));add(n(m.cellSize)+' m','info');add(t('，每完整网格 ', '; per full cell '));add(String(m.particlesPerCell)+t(' 点',' particles'),'info');}
    add('。');
    const part=c.project.parts.find(p=>p.id===m.selectedPartId);
    if(part){add(t(' 当前部件 ',' Selected part '));add(part.name,'info');add(t('，中心 ','; center '));add(part.geometry.center.map(n).join(', ')+' m','info');add(t('，尺寸 ','; size '));add(part.geometry.size.map(n).join(' × ')+' m','info');add('。');}
    const modeling=part?.modeling,template=modeling?.schema===PARAMETRIC_SCHEMA?PARAMETRIC_TEMPLATES.find(t=>t.id===modeling.template):null;
    if(template&&template.fields.every(f=>Number.isFinite(modeling.parameters?.[f.key]))){
      // Summarize the applied authoring model, never values from an unsaved form.
      // These are local template dimensions; the part may have a separate scale.
      add(t(' 已应用参数化模板 ',' Applied parametric template '));add(en?parametricEnglish.templates[template.id]??template.label:template.label,'info');
      add(t('，原始局部参数：','; original local parameters: '));
      template.fields.forEach((f,i)=>{if(i)add(' · ');add((en?parametricEnglish.fields[f.key]??f.key:f.label)+' ');add(n(modeling.parameters[f.key])+' '+(f.unit==='deg'?'°':f.unit),'info');});
      add('。');
    }
  }else if(chapter==='loads'){
    add(t('已应用重力 ','Applied gravity '));add((p.gravity??[]).map(n).join(', ')+' m/s²','info');
    add(t('；温度场','; thermal field '));add(p.thermal?t('开启','on'):t('关闭','off'),p.thermal?'enabled':'');
    add(t('。显式接触对中，','; explicit pairs: '));add(`${p.mechanicalPairs}`+t(' 对力学接触',' mechanical'),'info');add('，');add(`${p.thermalPairs}`+t(' 对换热',' thermal'),'enabled');
    add(t(`。已定义 ${p.loads.length} 项载荷/约束；初始温度 `,`. ${p.loads.length} loads/constraints; initial temperatures `));
    const ts=c.project.parts.map(b=>b.initial?.temperature).filter(Number.isFinite);
    add(ts.length?`${n(Math.min(...ts))}–${n(Math.max(...ts))} °C`:'—','info');add('。');
  }else if(chapter==='solver'){
    add(t('已应用设备 ','Configured device '));add(s.requestedDevice.toUpperCase(),'info');
    add(t('；实际后端 ','; confirmed backend '));add(s.confirmedDevice==='unconfirmed'?t('尚未确认','unconfirmed'):s.confirmedDevice.toUpperCase(),s.confirmedDevice==='unconfirmed'?'pending':'enabled');
    if(c.project.solver.adapter==='cpu-fem-static'){
      add(t('。FEM 线弹性静力分析，使用 PCG；不进行时间推进。相对残差容差 ','. FEM linear statics with PCG; no time integration. Relative residual tolerance '));add(n(c.project.solver.tolerance),'info');
      add(t('，最多 ', '; up to '));add(String(c.project.solver.maxIterations)+t(' 次迭代。',' iterations.'),'info');
    }else{
    add(t('。耦合方式 ','. Coupling '));add(s.coupling==='unified-pbd'?'Unified PBD':t('原有耦合','native coupling'),'info');
    add(t('，目标 ','; target '));add(n(s.targetTime)+' s','info');
    add(t('，步长上限 ','; step limit '));add(n(s.requestedDt)+' s','info');
    add(t('，实际步长 ','; actual step '));add(s.actualDt===null?(r?.time>0?t('后端未上报','not reported'):t('尚未推进','not advanced')):n(s.actualDt)+' s',s.actualDt!==null&&s.actualDt<s.requestedDt*.99?'pending':'enabled');add('。');
    }
  }else{
    if(!r){add(s.status==='editing'?t('模型编辑中，仅有初始几何预览。','Editing; initial geometry preview only.') :t('尚无结果。','No results yet.'));if(s.error)add(' '+s.error,'pending');return out;}
    add(r.recorded?t('当前为已记录回放；','Recorded playback; '):t('当前结果时刻 ','Result time '));add(n(r.time)+' s','info');
    add(t('，显示 ','; display '));add(r.field??t('默认场量','default field'),'info');
    add(t('。该结果使用 ','. Result used '));add(r.backend==='unconfirmed'?t('未确认后端','unconfirmed backend'):r.backend.toUpperCase(),'info');
    add(' / '+(r.coupling==='unified-pbd'?'Unified PBD':t('原有耦合','native coupling'))+'。');
    if(r.progress!==null){add(t(' 进度 ',' Progress '));add(n(r.progress*100)+'%','enabled');}
    if(!r.matchesCurrentConfiguration)add(t('这是修改前配置的结果。','This result predates the current configuration.'),'pending');
    if(Number.isFinite(r.thermalResidual)){add(t(' 热量残差 ',' Thermal residual '));add(n(r.thermalResidual)+' J','info');}
  }
  if(c.pending.length){add(' ');add(t('待应用：','Pending: ')+c.pending.join('、')+t('。上述已应用设置尚未改变。','. Applied settings above are unchanged.'),'pending');}
  if(s.error){add(' ');add((s.status==='editing'?t('待满足的求解条件：','Solver requirement: '):t('异常：','Error: '))+s.error,s.status==='editing'?'pending':'error');}
  return out;
}
