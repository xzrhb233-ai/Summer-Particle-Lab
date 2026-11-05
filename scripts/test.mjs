import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {run} from 'node:test';
import {spec} from 'node:test/reporters';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');

// [all top-level tests, native CAD tests]. These reviewed counts deliberately
// require a classification review when mixed files gain or lose a test. Their
// existing explicit skip guards identify cases requiring the Python kernel;
// names such as "native" or "GPU" alone do not identify a dependency.
export const CAD_TEST_FILES=Object.freeze({
  'assistant-cad-tools.test.mjs':[8,2],
  'assistant-cad.test.mjs':[10,1],
  'assistant-parametric.test.mjs':[7,5],
  'assistant-profile.test.mjs':[7,3],
  'assistant-surface.test.mjs':[8,1],
  'cad-curves.test.mjs':[3,3],
  'cad-fem.test.mjs':[7,1],
  'cad-modeling-tools.test.mjs':[3,1],
  'cad-parametric.test.mjs':[5,3],
  'cad-profile-geometry.test.mjs':[5,1],
  'cad-profile-kernel.test.mjs':[6,6],
  'cad-surface-tools.test.mjs':[6,1],
  'cad-surfaces.test.mjs':[4,4],
  'cad-volume-mesh.test.mjs':[5,5],
  'cad.test.mjs':[4,3],
  'http-service-security.test.mjs':[14,0], // Injected children/runners; loopback only.
  'named-surfaces.test.mjs':[8,6],
  'project-archive.test.mjs':[9,1],
  'project-io.test.mjs':[3,1],
  'surface-workflow.test.mjs':[3,1],
});

export function classifyTestSources(entries,registry=CAD_TEST_FILES){
  const files=[],coreFiles=[],nativeFiles=[],nativeTests=[],found=new Set();
  for(const {file,source} of entries){
    if(found.has(file))throw Error('Duplicate test file: '+file);
    found.add(file);files.push(file);
    const expected=registry[file],declared=[...source.matchAll(/^\s*test\(/gm)].length;
    const guarded=[...source.matchAll(/^\s*test\(\s*(?:'([^'\r\n]*)'|"([^"\r\n]*)")\s*,\s*\{\s*skip\s*:\s*!\s*(?:available|native|kernelAvailable)\s*\}\s*,/gm)];
    const allGuards=[...source.matchAll(/^\s*test[^\r\n]*\bskip\s*:/gm)].length;
    if(/^\s*test\.(?:skip|todo|only)\(/m.test(source)||allGuards!==guarded.length)throw Error('Unclassified skip/only/todo annotation in '+file);
    const importsCAD=/^import[^\r\n]*from\s*['"][^'"]*cad-server\.mjs['"]/m.test(source);
    const cadPath=/['"](?:\.\.?\/)*\.venv-cad\//.test(source);
    if(!expected&&(guarded.length||importsCAD||cadPath))throw Error('Native CAD dependency is not classified: '+file+'; update CAD_TEST_FILES after review.');
    if(expected){
      if(!importsCAD||declared!==expected[0]||guarded.length!==expected[1])throw Error('Native CAD classification changed in '+file+'; review every added/removed test and update CAD_TEST_FILES.');
      if(guarded.length)nativeFiles.push(file);
      for(const match of guarded)nativeTests.push({file,name:match[1]??match[2]});
      // Avoid reporting an empty, fully filtered file as a successful test.
      if(declared>guarded.length)coreFiles.push(file);
    }else coreFiles.push(file);
  }
  for(const file of Object.keys(registry))if(!found.has(file))throw Error('Classified native test file is missing: '+file);
  const names=new Set();for(const {name} of nativeTests){if(names.has(name))throw Error('Native test names must be unique: '+name);names.add(name);}
  if(!files.length)throw Error('No test files discovered.');
  return {files,coreFiles,nativeFiles,nativeTests};
}

export async function discoverTests(root=ROOT){
  const files=(await readdir(join(root,'tests'))).filter(f=>f.endsWith('.test.mjs')).sort();
  return classifyTestSources(await Promise.all(files.map(async file=>({file,source:await readFile(join(root,'tests',file),'utf8')}))));
}

const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function suiteOptions(catalog,suite,{root=ROOT,concurrency=2}={}){
  if(!['core','native-cad','all'].includes(suite))throw Error('Unknown suite: '+suite);
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw Error('Concurrency must be an integer from 1 to 16.');
  const selected=suite==='core'?catalog.coreFiles:suite==='native-cad'?catalog.nativeFiles:catalog.files;
  if(!selected.length||!catalog.nativeTests.length)throw Error('Test suite selection is empty or lacks its native classification.');
  const pattern=new RegExp('^(?:'+catalog.nativeTests.map(t=>escapeRegex(t.name)).join('|')+')$');
  return {files:selected.map(f=>join(root,'tests',f)),concurrency,isolation:'process',execArgv:[],
    ...(suite==='core'?{testSkipPatterns:pattern}:suite==='native-cad'?{testNamePatterns:pattern}:{})};
}

export function assertNativeCAD({root=ROOT,platform=process.platform,spawn=spawnSync}={}){
  const python=join(root,'.venv-cad',platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');
  const code='import sys,json,importlib.metadata as m\nassert sys.version_info[:2] == (3,12), "CAD requires CPython 3.12"\nimport usd_brep,meshpy.tet,numpy\nprint(json.dumps({"python":sys.version.split()[0],"packages":{p:m.version(p) for p in ("usd-brep","meshpy","numpy")}}))';
  const result=spawn(python,['-c',code],{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});
  if(result.error||result.status!==0)throw Error('Native CAD prerequisites are unavailable; no native tests ran. Create .venv-cad with Python 3.12 and install cad/requirements.txt.\n'+String(result.error?.message||result.stderr||'Python import failed').trim());
  try{return JSON.parse(result.stdout.trim());}catch{throw Error('Native CAD preflight returned invalid metadata; no native tests ran.');}
}

export function assertCompletedSummary(summary){
  if(!summary||!summary.success||summary.counts.failed||summary.counts.cancelled||summary.counts.skipped||summary.counts.todo||!summary.counts.tests){
    throw Error('Test run did not complete with every selected test passing (skipped/TODO/cancelled/empty runs are failures).');
  }
}

export function parseRunnerArgs(args){
  const {values}=parseArgs({args,options:{suite:{type:'string',default:'core'},concurrency:{type:'string',default:'2'},list:{type:'boolean'},preflight:{type:'boolean'},help:{type:'boolean'}},allowPositionals:false,strict:true});
  if(!['core','native-cad','all'].includes(values.suite))throw Error('Suite must be core, native-cad, or all.');
  const concurrency=Number(values.concurrency);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>16)throw Error('Concurrency must be an integer from 1 to 16.');
  if(values.preflight&&values.suite==='core')throw Error('--preflight requires --suite native-cad or all.');
  return {...values,concurrency};
}

export async function main(args=process.argv.slice(2)){
  const options=parseRunnerArgs(args);
  if(options.help){console.log('Usage: node scripts/test.mjs [--suite core|native-cad|all] [--concurrency 1..16] [--list] [--preflight]\ncore: CPU JS/WASM, CAD-independent cases, and GPU protocol/mocks; no GPU hardware validation.\nnative-cad: actual SMLib/TetGen cases; Python 3.12 + cad/requirements.txt are mandatory.\nall: both Node suites; the same mandatory CAD preflight.\n--list shows the exact native cases without executing tests.');return;}
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22||major===22&&minor<10)throw Error('Node.js 22.10 or newer is required; CI covers Node 22 and 24.');
  const catalog=await discoverTests();
  if(options.list){console.log(JSON.stringify({suite:options.suite,...catalog},null,2));return;}
  console.log(`Suite: ${options.suite}; discovered ${catalog.files.length} test files; classified ${catalog.nativeTests.length} native CAD cases in ${catalog.nativeFiles.length} files.`);
  console.log('GPU-named Node tests cover JavaScript preparation/protocols/mocks, not GPU hardware. Python GPU and browser tests are outside these Node suites.');
  if(options.suite==='core')console.log(`Explicitly excluded ${catalog.nativeTests.length} native CAD cases. Run --suite native-cad or --suite all for those mandatory-dependency tests.`);
  else console.log('Native CAD preflight: '+JSON.stringify(assertNativeCAD()));
  if(options.preflight)return;
  let summary;const stream=run(suiteOptions(catalog,options.suite,{concurrency:options.concurrency}));
  stream.on('test:summary',data=>{if(!data.file)summary=data;});
  for await(const chunk of stream.compose(spec))process.stdout.write(chunk);
  assertCompletedSummary(summary);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
