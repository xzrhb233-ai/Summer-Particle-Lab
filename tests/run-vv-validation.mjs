import {mkdir,writeFile} from 'node:fs/promises';
import {runVVBenchmarks} from '../src/simulation/vv-benchmarks.js';

const report=await runVVBenchmarks();
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/v071-vv-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,limits:report.limits,cases:report.cases.map(c=>({id:c.id,status:c.status,reason:c.reason??c.refinement?.reason??null,checks:c.checks,observedOrder:c.refinement?.observedOrder??null,gci:c.refinement?.gci??null})),artifact:'artifacts/v071-vv-validation.json'},null,2));
// A completed inconclusive refinement is an explicit scientific result, not a
// failed execution. Its status remains in JSON and stdout; never print "all passed".
if(report.cases.some(c=>['failed','limited','cancelled','unsupported'].includes(c.status)))process.exitCode=1;
