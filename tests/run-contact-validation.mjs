import fs from 'node:fs';
import {contactValidationPlan,contactValidationProject,runContactValidation,contactReport} from '../src/simulation/contact-validation.js';
if(process.argv.includes('--projects'))console.log(JSON.stringify(contactValidationPlan().map(spec=>({spec,project:contactValidationProject(spec)}))));
else if(process.argv.includes('--summarize')){
  const rows=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(contactReport(rows)));
}else{
  const report=await runContactValidation({progress:value=>{if(!process.argv.includes('--json'))console.log(JSON.stringify({type:'progress',value}));}});
  if(process.argv.includes('--json'))console.log(JSON.stringify(report));
  else{fs.writeFileSync('artifacts/contact-validation-cpu.json',JSON.stringify(report,null,2));console.log(JSON.stringify({type:'complete',rows:report.rows.map(r=>({id:r.id,status:r.status,error:r.error})),checks:report.checks}));}
}
