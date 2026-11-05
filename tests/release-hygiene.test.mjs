import test from 'node:test';
import assert from 'node:assert/strict';
import {scanText,auditRepository} from '../scripts/check-release.mjs';

test('release scanner identifies provider secrets without returning the secret or its source line',()=>{
  const secret='sk-'+ 'a9'.repeat(20),content='example\ncredential = "'+secret+'"';
  const report=scanText(content,'example.js');assert.equal(report[0].rule,'provider-key');assert.equal(report[0].line,2);assert.ok(!JSON.stringify(report).includes(secret));
  assert.deepEqual(scanText('const key = userInput; // no credential','source.js'),[]);
});
test('release scanner reports private key headers and workstation paths using safe metadata',()=>{
  const findings=scanText('-----BEGIN '+'PRIVATE KEY-----\n'+'D:'+'\\Release\\private.pdf','sample.txt');
  assert.deepEqual(findings.map(f=>f.rule),['private-key','workstation-path']);assert.ok(findings.every(f=>!Object.hasOwn(f,'match')));
});
test('tracked ignored paths are rejected and out-of-root candidates are never read',async()=>{
  const report=await auditRepository({files:['.env','artifacts/private.json','../outside.txt']});
  assert.equal(report.status,'blocked');assert.equal(report.manifest.length,0);
  assert.ok(report.findings.some(f=>f.rule==='outside-repository'));assert.equal(report.findings.filter(f=>f.rule==='private-or-generated-candidate').length,2);
});
test('release mode explicitly blocks a missing project license',async()=>{
  const report=await auditRepository({release:true,files:[]});assert.equal(report.status,'blocked');
  assert.equal(report.findings.find(f=>f.rule==='project-license-undecided').severity,'error');assert.equal(report.limits,undefined);
});
