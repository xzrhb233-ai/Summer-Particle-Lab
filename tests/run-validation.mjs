import {writeFile,mkdir} from 'node:fs/promises';
import {runValidation,validationCSV} from '../src/simulation/validation.js';
const report=await runValidation({onRow:r=>console.log(`${r.case} ${r.sweep} dt=${r.dt.toPrecision(3)} h=${r.cellSize.toPrecision(3)} ${r.status}: ${r.value.toPrecision(5)}`)});
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/numerical-validation.json',import.meta.url),JSON.stringify(report,null,2));
await writeFile(new URL('../artifacts/numerical-validation.csv',import.meta.url),validationCSV(report));
console.log(JSON.stringify(report.refinement,null,2));
