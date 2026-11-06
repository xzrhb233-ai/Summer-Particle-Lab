import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {scanText,auditRepository,candidateFiles} from '../scripts/check-release.mjs';

const evidenceDocuments=['docs/PROVENANCE.md','docs/CAD_LICENSE_REVIEW.md','docs/cad-dependencies.lock.json','docs/cad-source-evidence.json','third_party/cad/README.md'];
const sourceScaffold=['README.md','CONTRIBUTING.md','SECURITY.md','docs/INSTALL.md','docs/ARCHITECTURE.md','docs/THIRD_PARTY.md','docs/OPEN_SOURCE_CHECKLIST.md','docs/VV.md','pnpm-lock.yaml','.github/workflows/ci.yml','LICENSE',...evidenceDocuments];
const evidencePath='docs/cad-dependencies.lock.json',noticePath='third_party/cad/meshpy/LICENSE',noticeText='Complete test notice copy.\n';
const digest=text=>createHash('sha256').update(text).digest('hex');
const coherentEvidence=()=>({schema:'summer-cad-dependency-evidence/1',packages:[{name:'meshpy',version:'2026.1.1'}],notices:[{path:noticePath,sha256:digest(noticeText)}]});
async function auditFixture(t,extra={}){
  const prefix=resolve(tmpdir(),'summer-release-hygiene-'),root=await mkdtemp(prefix);
  t.after(async()=>{
    // Delete only this test's generated directory, never an unchecked parent.
    assert.ok(resolve(root).startsWith(prefix)&&!root.slice(prefix.length).includes(sep));
    await rm(root,{recursive:true,force:true});
  });
  const entries={...Object.fromEntries(sourceScaffold.map(path=>[path,'Source release review fixture.\n'])),'cad/requirements.txt':'meshpy==2026.1.1\n',[evidencePath]:JSON.stringify(coherentEvidence()),[noticePath]:noticeText,...extra};
  for(const [path,content] of Object.entries(entries)){
    const file=join(root,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,content);
  }
  return {root,files:Object.keys(entries)};
}

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
test('source release rejects package and native candidates even when their content is plain text',async t=>{
  const formats=['whl','so','so.1.2','dylib','wasm','a','lib','o','zip','tar','tgz','tar.gz','bz2','xz','zst','7z','rar','msi','msix','cab','dmg','iso','deb','rpm','egg','jar','DLL','EXE','pyd'];
  const paths=formats.map(format=>'third_party/package.'+format);
  const {root}=await auditFixture(t,Object.fromEntries(paths.map(path=>[path,'Plain text cannot exempt a package file.\n'])));
  const candidates=await candidateFiles(root);
  assert.ok(paths.every(path=>candidates.files.includes(path)),'package files must remain visible in the candidate inventory');
  const report=await auditRepository({root,release:true});
  assert.equal(report.status,'blocked');
  assert.deepEqual(report.findings.map(({severity,rule,path})=>({severity,rule,path})),paths.sort().map(path=>({severity:'error',rule:'private-or-generated-candidate',path})));
});
test('binary content under an ordinary source filename warns in repo mode and blocks a release',async t=>{
  const fixture=await auditFixture(t,{'src/native-hidden.js':Buffer.from([0x7f,0x45,0x4c,0x46,0,1,2])});
  const repo=await auditRepository(fixture),release=await auditRepository({...fixture,release:true});
  assert.equal(repo.status,'passed');assert.equal(release.status,'blocked');
  assert.deepEqual(repo.findings,[{severity:'warning',rule:'binary-needs-manual-review',path:'src/native-hidden.js'}]);
  assert.deepEqual(release.findings,[{severity:'error',rule:'binary-needs-manual-review',path:'src/native-hidden.js'}]);
  assert.ok(release.manifest.some(file=>file.path==='src/native-hidden.js'),'binary finding must retain its file hash in the manifest');
});
test('source publication requires provenance and CAD dependency evidence documents',async t=>{
  const fixture=await auditFixture(t);
  assert.equal((await auditRepository({...fixture,release:true})).status,'passed');
  for(const missing of evidenceDocuments){
    const report=await auditRepository({...fixture,release:true,files:fixture.files.filter(path=>path!==missing)});
    assert.equal(report.status,'blocked');
    assert.deepEqual(report.findings,[{severity:'error',rule:'missing-project-document',path:missing}]);
  }
});
test('CAD evidence rejects dependency drift and requires the pinned requirements candidate',async t=>{
  const fixture=await auditFixture(t,{'cad/requirements.txt':'meshpy==2026.1.2\n'});
  const drift=await auditRepository({...fixture,release:true});
  assert.deepEqual(drift.findings,[{severity:'error',rule:'cad-evidence-package-drift',path:evidencePath}]);
  const missing=await auditRepository({...fixture,release:true,files:fixture.files.filter(path=>path!=='cad/requirements.txt')});
  assert.deepEqual(missing.findings,[{severity:'error',rule:'cad-requirements-missing',path:'cad/requirements.txt'}]);
});
test('CAD evidence detects changed notices and does not accept copies absent from the candidate inventory',async t=>{
  const fixture=await auditFixture(t,{[noticePath]:'Truncated or replaced notice.\n'});
  const changed=await auditRepository({...fixture,release:true});
  assert.deepEqual(changed.findings,[{severity:'error',rule:'cad-evidence-notice-hash-mismatch',path:noticePath}]);
  const missing=await auditRepository({...fixture,release:true,files:fixture.files.filter(path=>path!==noticePath)});
  assert.deepEqual(missing.findings,[{severity:'error',rule:'cad-evidence-notice-missing',path:noticePath}]);
});
test('CAD evidence rejects traversal without reading or reporting the referenced content',async t=>{
  const sentinel='Private fixture data that must not enter the report.',evidence=coherentEvidence();
  evidence.notices=[{path:'third_party/cad/../../outside-notice.txt',sha256:digest(sentinel)}];
  const fixture=await auditFixture(t,{[evidencePath]:JSON.stringify(evidence),'outside-notice.txt':sentinel});
  const report=await auditRepository({...fixture,release:true,files:fixture.files.filter(path=>path!=='outside-notice.txt')});
  assert.deepEqual(report.findings,[{severity:'error',rule:'cad-evidence-unsafe-notice-path',path:evidencePath,entry:1}]);
  assert.ok(!JSON.stringify(report).includes(sentinel));assert.ok(!report.manifest.some(file=>file.path==='outside-notice.txt'));
});
test('CAD evidence validates JSON, schema, unique packages and nonempty unique notice hashes',async t=>{
  const duplicate=coherentEvidence();duplicate.notices.push({...duplicate.notices[0]});
  const duplicatePackages=coherentEvidence();duplicatePackages.packages.push({...duplicatePackages.packages[0]});
  const invalidHash=coherentEvidence();invalidHash.notices[0].sha256='not-a-hash';
  const cases=[
    ['{invalid','cad-evidence-invalid-json'],
    [JSON.stringify({...coherentEvidence(),schema:'unknown'}),'cad-evidence-invalid-schema'],
    [JSON.stringify(duplicatePackages),'cad-evidence-invalid-packages'],
    [JSON.stringify({...coherentEvidence(),notices:[]}),'cad-evidence-invalid-notices'],
    [JSON.stringify(duplicate),'cad-evidence-duplicate-notice'],
    [JSON.stringify(invalidHash),'cad-evidence-invalid-notice-hash'],
  ];
  for(const [content,rule] of cases){
    const fixture=await auditFixture(t,{[evidencePath]:content}),report=await auditRepository({...fixture,release:true});
    assert.equal(report.status,'blocked');assert.equal(report.findings.length,1);assert.equal(report.findings[0].rule,rule);
  }
});
