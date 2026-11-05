import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const python=fileURLToPath(new URL(process.platform==='win32'?'./.venv-cad/Scripts/python.exe':'./.venv-cad/bin/python',import.meta.url));
const worker=fileURLToPath(new URL('./cad/worker.py',import.meta.url));
class CADError extends Error {constructor(code,message){super(message);this.code=code;}}
const inputLimit=64000,outputLimit=16_000_000;
export function cadWorkerEnvironment(source=process.env){
  const allowed=new Set(['systemroot','windir','temp','tmp','tmpdir','path','lang','lc_all','ld_library_path','dyld_library_path']);
  const env=Object.fromEntries(Object.keys(source).filter(key=>allowed.has(key.toLowerCase())).map(key=>[key,source[key]]));
  // API credentials, NODE_OPTIONS, PYTHONPATH/HOME and user-site startup hooks
  // are unrelated to CAD and must not be inherited by the native worker.
  return {...env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'};
}
function serializeCADRequest(data){
  const fields={health:['action'],build:['action','recipe'],export:['action','recipe'],mesh:['action','recipe','options'],curve:['action','spec'],surface:['action','spec']},expected=Object.hasOwn(fields,data?.action)?fields[data.action]:null;
  if(!data||typeof data!=='object'||Array.isArray(data)||!expected||Object.keys(data).length!==expected.length||Object.keys(data).some(k=>!expected.includes(k)))throw new CADError('CAD_INPUT','SMLib：Invalid CAD request');
  let text;try{text=JSON.stringify(data);}catch{throw new CADError('CAD_INPUT','SMLib：Invalid CAD request');}
  if(Buffer.byteLength(text,'utf8')>inputLimit)throw new CADError('CAD_INPUT','CAD 请求超过容量');return text;
}
export function runCAD(data,{timeout=45000,signal,spawnProcess=spawn}={}){
  return new Promise((resolve,reject)=>{
    if(!Number.isFinite(timeout)||timeout<=0||timeout>45000)throw new CADError('CAD_INPUT','CAD timeout must be in (0, 45000] ms');
    const input=serializeCADRequest(data);
    if(signal?.aborted)throw new CADError('CAD_CANCELLED','CAD 操作已取消');
    const child=spawnProcess(python,[worker],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:cadWorkerEnvironment(),shell:false}),chunks=[];
    let size=0,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();finish(new CADError('CAD_CANCELLED','CAD 操作已取消'));};
    const timer=setTimeout(()=>{child.kill();finish(new CADError('CAD_TIMEOUT','SMLib 运算超时，请简化几何或调整相交位置'));},timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(new CADError('CAD_UNAVAILABLE','SMLib 未安装。请运行 Install-CAD.ps1')));
    child.stdout.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>outputLimit){child.kill();finish(new CADError('CAD_OUTPUT','CAD 输出超过容量'));}else chunks.push(chunk);});
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(done)return;
      if(code!==0){finish(new CADError('CAD_KERNEL','SMLib 内核异常退出，请检查几何或独立 Python 环境'));return;}
      const line=Buffer.concat(chunks).toString('utf8').split(/\r?\n/).findLast(s=>s.startsWith('SUMMER_CAD_RESULT='));
      try{const reply=JSON.parse(line?.slice(18));if(!reply||typeof reply!=='object'||typeof reply.ok!=='boolean'||reply.ok&&(!reply.result||typeof reply.result!=='object'))throw Error('Invalid kernel response');if(!reply.ok)throw Error(String(reply.error).slice(0,1000));finish(null,reply.result);}
      catch(e){finish(new CADError('CAD_KERNEL','SMLib：'+(line?e.message:'内核未返回有效结果，请检查独立 Python 环境')));}
    });
    child.stdin.end(input);
  });
}

export function createCADHandler({origins=['http://127.0.0.1:5173','http://localhost:5173'],runner=runCAD,timeout=45000}={}){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>45000)throw Error('CAD timeout must be in (0, 45000] ms');
  let active=false;
  return async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(code,data)=>{if(res.destroyed||res.writableEnded)return;const body=JSON.stringify(data);if(Buffer.byteLength(body,'utf8')>outputLimit)throw new CADError('CAD_OUTPUT','CAD 输出超过容量');if(code>=400&&!req.complete)res.setHeader('Connection','close');res.writeHead(code).end(body);};
    if(!origins.includes(req.headers.origin))return send(403,{error:'CAD 请求来源不允许'});
    if(req.method!=='POST'||req.url!=='/api/cad')return send(405,{error:'仅支持 CAD POST'});
    if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json')return send(415,{error:'需要 JSON 请求'});
    if(active)return send(409,{error:'SMLib 正在建模，请等待当前操作完成'});
    active=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    let rejectAbort;const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const abort=()=>rejectAbort(new CADError('CAD_TIMEOUT','CAD 操作已取消或超时'));
    controller.signal.addEventListener('abort',abort,{once:true});
    try{
      const chunks=[],iterator=req[Symbol.asyncIterator]();let size=0;
      while(true){const {done,value}=await Promise.race([iterator.next(),aborted]);if(done)break;size+=value.length;if(size>inputLimit)throw new CADError('CAD_INPUT','CAD 请求超过容量');chunks.push(value);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CADError('CAD_INPUT','CAD 请求 JSON 无效');}
      serializeCADRequest(data);
      send(200,await Promise.race([runner(data,{signal:controller.signal,timeout}),aborted]));
    }catch(e){
      const safe=e instanceof CADError&&['CAD_INPUT','CAD_TIMEOUT','CAD_UNAVAILABLE','CAD_OUTPUT','CAD_CANCELLED'].includes(e.code);
      send(e?.code==='CAD_TIMEOUT'?408:400,{code:safe?e.code:'CAD_FAILED',error:safe?e.message:'CAD 建模失败，请检查几何、网格参数与独立 Python 环境'});
    }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);controller.abort();active=false;if(!req.complete){if(res.writableFinished)req.destroy();else res.once('finish',()=>req.destroy());}}
  };
}
