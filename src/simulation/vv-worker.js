import {runVVBenchmarks,runVVProjectStudy} from './vv-benchmarks.js';

// A fresh worker is disposable: the UI cancels a running study with terminate().
// No workspace or persistent store is imported or modified here.
export async function handleVVWorkerMessage(message,post){
  const {id,type,plan={},project}=message??{};
  if(typeof id!=='string'&&typeof id!=='number'){post({type:'error',id:null,error:'A study request ID is required.'});return;}
  if(type!=='run'&&type!=='project-study'){post({type:'error',id,error:'Unsupported V&V worker request.'});return;}
  try{
    const hooks={onProgress:progress=>post({type:'progress',id,progress})},report=type==='project-study'?await runVVProjectStudy(project,plan,hooks):await runVVBenchmarks(plan,hooks);
    post({type:'result',id,report});
  }catch(e){post({type:'error',id,error:String(e?.message??e).slice(0,500)});}
}
if(typeof self!=='undefined'&&typeof self.postMessage==='function'){
  let busy=false;
  self.addEventListener('message',async event=>{
    if(busy){self.postMessage({type:'error',id:event.data?.id,error:'Worker is already running a study; cancel by terminating this worker.'});return;}
    busy=true;try{await handleVVWorkerMessage(event.data,message=>self.postMessage(message));}finally{busy=false;}
  });
}
