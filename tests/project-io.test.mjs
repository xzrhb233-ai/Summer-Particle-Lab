import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseProjectText,PROJECT_TEXT_LIMIT_BYTES} from '../src/simulation/project-io.js';
import {emptyProject} from '../src/simulation/part-builder.js';
import {addCADFEM} from '../src/simulation/cad-mesh-model.js';
import {validateFEM} from '../src/fem/model.js';
import {runCAD} from '../cad-server.mjs';

test('project text supports pretty JSON and UTF-8 BOM without mutating the source document',()=>{
  const project=emptyProject({name:'中文项目 · CAD 网格'}),text=JSON.stringify(project,null,2),parsed=parseProjectText('\ufeff'+text);
  assert.deepEqual(parsed,project);parsed.name='edited';assert.notEqual(project.name,parsed.name);
  for(const invalid of ['',null,'{','[]','null','42','"project"'])assert.throws(()=>parseProjectText(invalid),/项目 JSON/);
});

test('project text enforces the 16 MiB UTF-8 byte bound before JSON parsing',()=>{
  assert.equal(PROJECT_TEXT_LIMIT_BYTES,16*1024*1024);
  assert.throws(()=>parseProjectText(' '.repeat(PROJECT_TEXT_LIMIT_BYTES)+'{'),/16 MiB/);
  const multibyte=JSON.stringify({name:'中'.repeat(Math.floor(PROJECT_TEXT_LIMIT_BYTES/3)+1)});
  assert.ok(multibyte.length<PROJECT_TEXT_LIMIT_BYTES);assert.throws(()=>parseProjectText(multibyte),/16 MiB/);
  const wrapper=JSON.stringify({text:''}),boundary=JSON.stringify({text:'x'.repeat(PROJECT_TEXT_LIMIT_BYTES-wrapper.length)});
  assert.equal(new TextEncoder().encode(boundary).byteLength,PROJECT_TEXT_LIMIT_BYTES);
  assert.equal(parseProjectText(boundary).text.length,PROJECT_TEXT_LIMIT_BYTES-wrapper.length);
});

const python=fileURLToPath(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const available=existsSync(python)&&spawnSync(python,['-c','import usd_brep, meshpy.tet'],{windowsHide:true}).status===0;
test('a real CAD Tet4 pretty export beyond the old 500k limit round-trips with complete geometry and valid FEM',{skip:!available},async()=>{
  const seed=JSON.parse(readFileSync(new URL('../cad/examples/perforated-block.json',import.meta.url),'utf8'));
  const mesh=await runCAD({action:'mesh',recipe:seed.parts[0].geometry.cad.recipe,options:{kind:'volume',targetSize:.1}});
  const project=addCADFEM(emptyProject(),mesh),text=JSON.stringify(project,null,2);
  assert.ok(text.length>500000);assert.ok(new TextEncoder().encode(text).byteLength<PROJECT_TEXT_LIMIT_BYTES);
  const loaded=parseProjectText(text);assert.deepEqual(loaded,project);
  assert.deepEqual(loaded.parts[0].discretization.mesh.elements,mesh.elements);
  assert.doesNotThrow(()=>validateFEM(loaded));
});
