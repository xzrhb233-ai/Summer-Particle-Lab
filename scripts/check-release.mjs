import {execFileSync} from 'node:child_process';
import {lstat,readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['.git','node_modules','.pnpm-store','.taichi-cache','__pycache__','artifacts','tmp','.diagnostics','.codex','.agents','coverage']);
const normalized=path=>path.split(sep).join('/');
const inside=(root,file)=>file.startsWith(root.endsWith(sep)?root:root+sep);
const required=['README.md','CONTRIBUTING.md','SECURITY.md','docs/INSTALL.md','docs/ARCHITECTURE.md','docs/THIRD_PARTY.md','docs/OPEN_SOURCE_CHECKLIST.md','docs/VV.md','pnpm-lock.yaml','.github/workflows/ci.yml'];
const privatePath=path=>path.split('/').some(p=>excluded.has(p)||p.startsWith('.venv'))||/(^|\/)(?:\.env(?:\..+)?|credentials[^/]*\.json)$/.test(path)&&!path.endsWith('/.env.example')&&path!=='.env.example'||/\.(?:log|pem|key|pyc|pyd|exe|dll|zip)$/i.test(path);

/** Reports only rule, file and line: never the matched secret or source line. */
export function scanText(text,path){
  const findings=[],rules=[
    ['provider-key',/\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}\b/g],
    ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ['private-key',/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g],
    ['aws-access-id',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ];
  for(const [rule,pattern] of rules)for(const match of text.matchAll(pattern))findings.push({severity:'error',rule,path,line:text.slice(0,match.index).split('\n').length});
  const local=/\b[A-Z]:[\\/](?:Users[\\/][^\s\\/"'<>]+|Release)(?:[\\/]|\b)/g;
  for(const match of text.matchAll(local))findings.push({severity:'error',rule:'workstation-path',path,line:text.slice(0,match.index).split('\n').length});
  return findings;
}
export async function candidateFiles(root=ROOT){
  try{
    const data=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
    return {source:'git-index-and-unignored-working-tree',files:[...new Set(data.split('\0').filter(Boolean).map(normalized))].sort()};
  }catch{
    const files=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(excluded.has(item.name)||item.name.startsWith('.venv')||item.name.startsWith('.env')&&item.name!=='.env.example')continue;const file=resolve(dir,item.name);if(item.isDirectory())await walk(file);else files.push(normalized(relative(root,file)));}}
    await walk(root);return {source:'filesystem-without-git-history',files:files.sort()};
  }
}
export async function auditRepository({root=ROOT,release=false,files}={}){
  root=resolve(root);const candidates=files?{source:'explicit-candidate-list',files:[...new Set(files)].sort()}:await candidateFiles(root),findings=[],manifest=[];
  for(const path of candidates.files){
    const file=resolve(root,path);
    if(!inside(root,file)){findings.push({severity:'error',rule:'outside-repository',path});continue;}
    if(privatePath(path)){findings.push({severity:'error',rule:'private-or-generated-candidate',path});continue;}
    let stat;try{stat=await lstat(file);}catch{findings.push({severity:'error',rule:'missing-candidate',path});continue;}
    if(stat.isSymbolicLink()||!stat.isFile()){findings.push({severity:'error',rule:'non-regular-candidate',path});continue;}
    if(stat.size>5*1024*1024){findings.push({severity:'error',rule:'file-exceeds-5-MiB-review-limit',path,bytes:stat.size});continue;}
    const data=await readFile(file);manifest.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
    if(data.includes(0)){findings.push({severity:'warning',rule:'binary-needs-manual-review',path});continue;}
    findings.push(...scanText(data.toString('utf8'),path));
  }
  const names=new Set(candidates.files);
  for(const path of required)if(!names.has(path))findings.push({severity:'error',rule:'missing-project-document',path});
  const license=['LICENSE','LICENSE.md','LICENSE.txt'].find(p=>names.has(p));
  if(!license)findings.push({severity:release?'error':'warning',rule:'project-license-undecided',path:'LICENSE'});
  let commits=0;try{commits=Number(execFileSync('git',['rev-list','--all','--count'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim())||0;}catch{}
  return {schema:'summer-repository-audit/1',mode:release?'release-gate':'repository-hygiene',candidateSource:candidates.source,files:manifest.length,totalBytes:manifest.reduce((s,r)=>s+r.bytes,0),gitCommitCount:commits,status:findings.some(f=>f.severity==='error')?'blocked':'passed',findings,manifest,
    limitations:['Pattern checks are not a comprehensive secret or malware audit.','Only the current index/working-tree candidates are inspected; historical commit contents are not scanned.','A license file is an existence check, not a legal compatibility or provenance review.','No package is published, remote is created, files are staged, or local data is removed.','Ignore rules do not remove already tracked files or secrets from Git history.']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.some(a=>!['--release','--json'].includes(a)))throw Error('Usage: node scripts/check-release.mjs [--release] [--json]');
  const report=await auditRepository({release:args.includes('--release')});
  await mkdir(resolve(ROOT,'artifacts'),{recursive:true});const name=report.mode==='release-gate'?'release-check':'repository-check';
  await writeFile(resolve(ROOT,`artifacts/${name}.json`),JSON.stringify(report,null,2)+'\n');
  if(args.includes('--json'))console.log(JSON.stringify(report,null,2));else{
    console.log(`${report.mode}: ${report.status}; ${report.files} candidate files; ${report.totalBytes} bytes; ${report.gitCommitCount} existing commits`);
    for(const f of report.findings)console.log(`${f.severity.toUpperCase()} ${f.rule}: ${f.path}${f.line?':'+f.line:''}`);
    console.log(`Sanitized report: artifacts/${name}.json`);
  }
  if(report.status==='blocked')process.exitCode=1;
}
