import {runValidation} from './validation.js';
import {runContactValidation} from './contact-validation.js';
self.onmessage=async({data})=>{
  try{
    const run=data?.kind==='contact'?runContactValidation:runValidation;
    const report=await run({progress:value=>self.postMessage({type:'progress',value}),onRow:row=>self.postMessage({type:'row',row})});
    self.postMessage({type:'complete',report});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
