import {normalizeProject,PROJECT_SCHEMA} from './project.js';
import {configurationId} from './workspace-context.js';
import {PROJECT_TEXT_LIMIT_BYTES} from './project-io.js';

export const ARCHIVE_LIMITS=Object.freeze({revisions:32,runs:100,bytes:64*1024*1024});
const REVISION='summer-project-revision/1',RUN='summer-run-record/1';
const projectFields=['schema','name','units','parts','connections','loads','frames','selectionSets','curves','loadBindings','contactPairs','environment','discretization','couplings','solver','cadCurves','cadSurfaces'];
const partFields=new Set(['id','name','method','geometry','material','initial','boundary','discretization','modeling']);
// Archive only the project schema, never browser storage, assistant settings or
// conversation state. Nested credentials are also excluded from imported JSON.
const privateField=/^(?:api[-_]?key|key|authorization|bearer|access[-_]?token|refresh[-_]?token|token|password|secret|credentials?|chat|messages|conversation|assistant|aiConfig|provider|baseURL|endpoint|headers|cookies?)$/i;
const unsafeField=new Set(['__proto__','prototype','constructor']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const clone=v=>structuredClone(v),bytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const idValid=v=>typeof v==='string'&&/^[-\w]{1,100}$/.test(v);
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const label=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
function data(value,depth=0){
  if(depth>80)throw Error('项目嵌套层级过深，无法归档');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('项目包含非有限数值，无法归档');return value;}
  if(Array.isArray(value))return Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))throw Error('归档不接受稀疏数组或动态属性');return data(d.value,depth+1);});
  if(!plain(value))throw Error('归档只接受项目 JSON 数据');
  const out={};
  for(const key of Object.keys(value).sort()){
    if(privateField.test(key)||unsafeField.has(key))continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('归档不接受动态属性');
    if(descriptor.value!==undefined)out[key]=data(descriptor.value,depth+1);
  }
  return out;
}
export function archiveProjectSnapshot(input){
  if(!plain(input))throw Error('归档需要统一项目');
  const selected={};
  for(const key of projectFields){
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(!descriptor)continue;
    if(!Object.hasOwn(descriptor,'value'))throw Error('归档不接受动态属性');
    if(descriptor.value!==undefined)selected[key]=descriptor.value;
  }
  if(selected.schema!==PROJECT_SCHEMA)throw Error('归档需要 summer-project/1 项目');
  if(!Array.isArray(selected.parts))throw Error('项目部件格式无效');
  selected.parts=Array.from({length:selected.parts.length},(_,i)=>{
    const descriptor=Object.getOwnPropertyDescriptor(selected.parts,String(i));if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('归档不接受稀疏数组或动态属性');const part=descriptor.value;
    if(!plain(part))throw Error('项目部件格式无效');
    const out={};for(const key of partFields){const d=Object.getOwnPropertyDescriptor(part,key);if(d){if(!Object.hasOwn(d,'value'))throw Error('归档不接受动态属性');if(d.value!==undefined)out[key]=d.value;}}return out;
  });
  const project=data(normalizeProject(data(selected))),encoded=JSON.stringify(project),size=new TextEncoder().encode(encoded).byteLength;
  if(size>PROJECT_TEXT_LIMIT_BYTES)throw Error('单个项目超过 16 MiB，无法归档');
  return {project,encoded,bytes:size,configurationId:configurationId(project)};
}

const measurements=Object.freeze({
  particleCount:'count',nodeCount:'count',elementCount:'count',partCount:'count',steps:'count',
  maxDisplacement:'m',maxSpeed:'m/s',maxVonMises:'Pa',minTemperature:'degC',maxTemperature:'degC',
  kineticEnergy:'J',strainEnergy:'J',thermalEnergy:'J',externalWork:'J',frictionHeat:'J',plasticHeat:'J',thermalResidual:'J',energyResidual:'J',
  contactImpulse:'N s',maxPenetration:'m',minDt:'s',maxDt:'s',computeSeconds:'s',simulationRate:'sim s / wall s',
});
export function compactRunSummary(input={}){
  const out={};if(!plain(input))return out;
  for(const key of Object.keys(measurements)){const d=Object.getOwnPropertyDescriptor(input,key);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='number'&&Number.isFinite(d.value))out[key]=d.value;}
  return out;
}
function runInput(input){
  if(!plain(input))throw Error('运行记录格式无效');
  if(!['completed','paused','error','stopped'].includes(input.outcome))throw Error('运行结果状态无效');
  if(!Number.isFinite(input.time)||input.time<0)throw Error('运行记录时间无效');
  if(input.targetTime!=null&&(!Number.isFinite(input.targetTime)||input.targetTime<0))throw Error('运行目标时间无效');
  if(!['cpu','gpu','gpu+cpu','unconfirmed'].includes(input.backend))throw Error('运行记录后端无效');
  return {label:label(input.label),outcome:input.outcome,time:input.time,targetTime:input.targetTime??null,backend:input.backend,summary:compactRunSummary(input.summary),restartable:false};
}
function revisionView(row){
  if(!plain(row)||row.schema!==REVISION||!idValid(row.id)||!timestamp(row.createdAt)||typeof row.label!=='string'||typeof row.reason!=='string')return null;
  try{const snapshot=archiveProjectSnapshot(row.project);if(snapshot.configurationId!==row.configurationId||snapshot.encoded!==JSON.stringify(row.project))return null;return {...snapshot,schema:REVISION,id:row.id,createdAt:row.createdAt,label:label(row.label),reason:label(row.reason,80)};}catch{return null;}
}
function runView(row,revisions){
  if(!plain(row)||row.schema!==RUN||!idValid(row.id)||!timestamp(row.createdAt)||!revisions.some(r=>r.id===row.revisionId&&r.configurationId===row.configurationId)||row.restartable!==false)return null;
  try{return {schema:RUN,id:row.id,revisionId:row.revisionId,configurationId:row.configurationId,createdAt:row.createdAt,...runInput(row)};}catch{return null;}
}
const metadata=r=>({id:r.id,configurationId:r.configurationId,createdAt:r.createdAt,label:r.label,reason:r.reason,name:r.project.name,partCount:r.project.parts.length,bytes:r.bytes});
function inventory(rows){
  const revisions=rows.map(revisionView).filter(Boolean),runs=rows.map(r=>runView(r,revisions)).filter(Boolean);
  const sort=(a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id);revisions.sort(sort);runs.sort(sort);
  let size;try{size=bytes(rows);}catch{size=Infinity;}
  return {revisions,runs,bytes:size,invalidCount:rows.length-revisions.length-runs.length};
}
function randomID(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues)return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
  throw Error('当前环境无法生成安全的归档标识');
}

// Storage mutation callbacks are synchronous and atomic across tabs. Retention
// never silently deletes history: reaching a bound asks the user to make room.
export function createProjectArchive({storage=createIndexedDBArchiveStorage(),now=()=>new Date(),idFactory=randomID,limits={}}={}){
  const cap={...ARCHIVE_LIMITS,...limits};
  for(const value of Object.values(cap))if(!Number.isInteger(value)||value<1)throw Error('归档容量配置无效');
  const stamp=()=>{const v=now();const t=v instanceof Date?v.toISOString():new Date(v).toISOString();if(!timestamp(t))throw Error('归档时间无效');return t;};
  function newID(kind,rows){for(let i=0;i<4;i++){const id=kind+'-'+idFactory();if(!idValid(id))throw Error('归档标识无效');if(!rows.some(r=>r?.id===id))return id;}throw Error('归档标识冲突，请重试');}
  function capacity(rows){const state=inventory(rows);if(rows.filter(r=>r?.schema===REVISION).length>cap.revisions||rows.filter(r=>r?.schema===RUN).length>cap.runs||state.bytes>cap.bytes)throw Error('本地归档容量已满；请手动删除旧版本或记录后重试');}
  function ensureRevision(rows,snapshot,{label:requested='',reason='edit'}={}){
    const title=label(requested),found=inventory(rows).revisions.find(r=>r.encoded===snapshot.encoded&&(!title||r.label===title));
    if(found)return {record:found,rows,created:false};
    const record={schema:REVISION,id:newID('revision',rows),configurationId:snapshot.configurationId,createdAt:stamp(),label:title,reason:label(reason,80)||'edit',project:snapshot.project,bytes:snapshot.bytes};
    return {record,rows:[...rows,record],created:true};
  }
  return {
    limits:Object.freeze(cap),
    async list(){const state=inventory(await storage.read());return {revisions:state.revisions.map(metadata),runs:clone(state.runs),bytes:state.bytes,invalidCount:state.invalidCount,limits:{...cap}};},
    async getRevision(id){if(!idValid(id))throw Error('版本标识无效');const found=inventory(await storage.read()).revisions.find(r=>r.id===id);if(!found)throw Error('归档版本不存在或已损坏');return clone({schema:REVISION,...metadata(found),project:found.project});},
    saveRevision(project,options={}){
      const snapshot=archiveProjectSnapshot(project);
      return storage.mutate(rows=>{const result=ensureRevision(rows,snapshot,options);capacity(result.rows);return {records:result.rows,result:{...metadata(result.record),created:result.created}};});
    },
    recordRun(input){
      const snapshot=archiveProjectSnapshot(input.project),details=runInput(input);
      return storage.mutate(rows=>{
        const saved=ensureRevision(rows,snapshot,{reason:'run'}),record={schema:RUN,id:newID('run',saved.rows),revisionId:saved.record.id,configurationId:snapshot.configurationId,createdAt:stamp(),...details},records=[...saved.rows,record];
        capacity(records);return {records,result:record};
      });
    },
    deleteRevision(id){if(!idValid(id))throw Error('版本标识无效');return storage.mutate(rows=>({records:rows.filter(r=>r?.id!==id&&r?.revisionId!==id),result:true}));},
    deleteRun(id){if(!idValid(id))throw Error('记录标识无效');return storage.mutate(rows=>({records:rows.filter(r=>!(r?.schema===RUN&&r.id===id)),result:true}));},
    clear(){return storage.mutate(()=>({records:[],result:true}));},
  };
}

export function createMemoryArchiveStorage(initial=[]){
  let records=clone(initial),queue=Promise.resolve();
  return {async read(){await queue;return clone(records);},mutate(fn){const work=queue.then(()=>{const change=fn(clone(records));if(!change||!Array.isArray(change.records))throw Error('归档事务无效');records=clone(change.records);return clone(change.result);});queue=work.catch(()=>{});return work;}};
}

export function createIndexedDBArchiveStorage({indexedDB=globalThis.indexedDB,name='summer-project-archive-v1'}={}){
  let opening;
  function open(){
    if(!indexedDB)return Promise.reject(Error('浏览器不支持本地归档；模拟仍可继续，请保存项目 JSON'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      let request,blocked=false;try{request=indexedDB.open(name,1);}catch(error){reject(error);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('entries'))request.result.createObjectStore('entries',{keyPath:'id'});};
      request.onerror=()=>reject(request.error??Error('无法打开本地归档'));
      request.onblocked=()=>{blocked=true;reject(Error('其他页面阻止了归档升级，请关闭旧页面后重试'));};
      request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  async function transaction(write,fn){
    const db=await open();return new Promise((resolve,reject)=>{
      let tx,result,failure;try{tx=db.transaction('entries',write?'readwrite':'readonly');}catch(error){reject(error);return;}
      tx.onerror=()=>{};tx.onabort=()=>reject(failure??tx.error??Error('本地归档写入失败'));tx.oncomplete=()=>resolve(result);
      const store=tx.objectStore('entries'),request=store.getAll();
      request.onerror=()=>{failure=request.error;};
      request.onsuccess=()=>{
        try{
          const rows=request.result;if(!write){result=rows;return;}
          const change=fn(rows);if(!change||!Array.isArray(change.records))throw Error('归档事务无效');
          const before=new Map(rows.map(r=>[r.id,r])),after=new Map(change.records.map(r=>[r.id,r]));
          for(const id of before.keys())if(!after.has(id))store.delete(id);
          for(const [id,row]of after)if(before.get(id)!==row)store.put(row);
          result=change.result;
        }catch(error){failure=error;tx.abort();}
      };
    });
  }
  return {read:()=>transaction(false),mutate:fn=>transaction(true,fn)};
}
