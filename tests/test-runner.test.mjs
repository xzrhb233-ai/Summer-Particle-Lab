import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTestSources,discoverTests,suiteOptions,assertNativeCAD,assertCompletedSummary,parseRunnerArgs} from '../scripts/test.mjs';

const fixture=()=>[
  {file:'mixed.test.mjs',source:"import {runCAD} from '../cad-"+"server.mjs';\ntest('pure CAD validation',()=>{});\ntest('real shape (a+b)',{skip:!available},()=>{});"},
  {file:'kernel.test.mjs',source:"import {runCAD} from '../cad-"+"server.mjs';\ntest('real mesh [1]',{skip:!kernelAvailable},()=>{});"},
  {file:'cpu.test.mjs',source:"test('CPU mechanics',()=>{});"},
];
const registry={'mixed.test.mjs':[2,1],'kernel.test.mjs':[1,1]};

test('test classification preserves pure cases inside mixed files and excludes only reviewed native cases',()=>{
  const catalog=classifyTestSources(fixture(),registry);
  assert.deepEqual(catalog.coreFiles,['mixed.test.mjs','cpu.test.mjs']);
  assert.deepEqual(catalog.nativeFiles,['mixed.test.mjs','kernel.test.mjs']);
  const core=suiteOptions(catalog,'core'),native=suiteOptions(catalog,'native-cad'),all=suiteOptions(catalog,'all');
  assert.equal(core.testSkipPatterns.test('real shape (a+b)'),true);
  assert.equal(core.testSkipPatterns.test('real shape aaab'),false);
  assert.equal(core.testSkipPatterns.test('pure CAD validation'),false);
  assert.equal(native.testNamePatterns.test('real mesh [1]'),true);
  assert.equal(native.testNamePatterns.test('CPU mechanics'),false);
  assert.equal(all.files.length,3);assert.equal(all.testSkipPatterns,undefined);assert.equal(all.testNamePatterns,undefined);
  assert.equal(core.isolation,'process');assert.deepEqual(core.execArgv,[]);
});

test('new unclassified native dependencies, new unguarded cases, changed guards and missing files fail closed',()=>{
  const fresh=fixture();fresh.push({file:'new.test.mjs',source:fixture()[1].source});
  assert.throws(()=>classifyTestSources(fresh,registry),/not classified/);
  const unguarded=fixture();unguarded[0].source+="\ntest('new kernel call',()=>runCAD({}));";
  assert.throws(()=>classifyTestSources(unguarded,registry),/classification changed/);
  const guard=fixture();guard[0].source=guard[0].source.replace('skip:!available','skip:true');
  assert.throws(()=>classifyTestSources(guard,registry),/Unclassified/);
  assert.throws(()=>classifyTestSources(fixture().slice(1),registry),/missing/);
  assert.throws(()=>classifyTestSources([{file:'only.test.mjs',source:"test.only('hidden suite',()=>{});"}],{}),/Unclassified/);
});

test('actual catalog includes every Node test file and retains GPU mock tests in core',async()=>{
  const catalog=await discoverTests();
  assert.ok(catalog.files.includes('test-runner.test.mjs'));
  assert.ok(catalog.coreFiles.includes('gpu-project.test.mjs'));
  assert.ok(catalog.coreFiles.includes('assistant-cad.test.mjs'));
  assert.ok(catalog.coreFiles.includes('http-service-security.test.mjs'));
  assert.ok(!catalog.nativeFiles.includes('http-service-security.test.mjs'));
  assert.ok(catalog.nativeFiles.includes('named-surfaces.test.mjs'));
  assert.ok(!catalog.coreFiles.includes('cad-profile-kernel.test.mjs'));
  assert.ok(catalog.nativeTests.length>0);
});

test('native preflight rejects absent Python, broken imports and malformed output instead of passing skipped tests',()=>{
  let called;const spawn=(...args)=>{called=args;return {status:0,stdout:'{"python":"3.12.10","packages":{"usd-brep":"1.0.1"}}'};};
  assert.equal(assertNativeCAD({platform:'win32',spawn}).python,'3.12.10');
  assert.match(called[0],/\.venv-cad[\\/]Scripts[\\/]python\.exe$/);assert.equal(called[2].windowsHide,true);
  assert.ok(called[1][1].includes('import usd_brep,meshpy.tet,numpy'));
  for(const result of [{error:Error('ENOENT'),status:null},{status:1,stderr:'ImportError'},{status:0,stdout:'not-json'}]){
    assert.throws(()=>assertNativeCAD({spawn:()=>result}),/no native tests ran/);
  }
});

test('the runner requires an actual complete pass and rejects skip, TODO, cancellation, failure and empty summaries',()=>{
  const counts={tests:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0};
  assert.doesNotThrow(()=>assertCompletedSummary({success:true,counts}));
  for(const key of ['failed','cancelled','skipped','todo'])assert.throws(()=>assertCompletedSummary({success:true,counts:{...counts,[key]:1}}),/every selected test/);
  assert.throws(()=>assertCompletedSummary({success:true,counts:{...counts,tests:0}}));
  assert.throws(()=>assertCompletedSummary({success:false,counts}));assert.throws(()=>assertCompletedSummary(undefined));
});

test('CLI defaults to core and rejects unsupported suites, unknown options and invalid concurrency',()=>{
  assert.equal(parseRunnerArgs([]).suite,'core');assert.equal(parseRunnerArgs(['--suite','all']).suite,'all');
  assert.equal(parseRunnerArgs(['--suite=native-cad','--preflight']).preflight,true);
  for(const args of [['--suite','gpu'],['--unknown'],['--concurrency','0'],['--concurrency','1.5'],['--preflight']])assert.throws(()=>parseRunnerArgs(args));
});
