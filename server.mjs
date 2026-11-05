import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAIHandler} from './ai-server.mjs';
import {createCADHandler} from './cad-server.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const entrypoints=new Set(['/index.html','/3d.html','/style.css','/node_modules/@dimforge/rapier3d-compat/rapier.mjs','/cad/examples/perforated-block.json']);
// These are explicitly requested by the local report/replay UI. Other reports,
// logs, Python workers, tests and project metadata are not public web assets.
const savedReports=new Set(['/artifacts/contact-validation.json','/artifacts/numerical-validation.json','/artifacts/ramps-replay.json','/artifacts/course-replay.json']);
const within=(root,file)=>file.startsWith(root.endsWith(sep)?root:root+sep);
export function isPublicAsset(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p.startsWith('.')))return false;
  return entrypoints.has(path)||savedReports.has(path)||path.startsWith('/src/')&&['.js','.css'].includes(extname(path));
}
export function createAppServer({root=ROOT,port=5173,aiHandler,cadHandler}={}){
  const base=resolve(root),origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  aiHandler??=createAIHandler({origins});cadHandler??=createCADHandler({origins});
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    const actualPort=req.socket.localPort,hosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
    if(!hosts.includes(req.headers.host)){res.writeHead(403).end('Forbidden');return;}
    if(req.headers.origin&&!hosts.some(h=>req.headers.origin===`http://${h}`)){res.writeHead(403).end('Forbidden');return;}
    try{
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(path==='/api/cad')return await cadHandler(req,res);
      if(path.startsWith('/api/ai/')){req.url=path.slice('/api/ai'.length);return await aiHandler(req,res);}
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.writeHead(405).end('Method not allowed');return;}
      const publicPath=path==='/'?'/index.html':path;
      if(!isPublicAsset(publicPath)){res.writeHead(404).end('Not found');return;}
      const file=resolve(base,'.'+publicPath);
      // Real paths block symlink/junction escapes while retaining pnpm's links
      // to packages inside this repository's node_modules/.pnpm directory.
      const [actualBase,actualFile]=await Promise.all([realpath(base),realpath(file)]);
      if(!within(base,file)||!within(actualBase,actualFile)){res.writeHead(404).end('Not found');return;}
      const actualPath='/'+relative(actualBase,actualFile).split(sep).join('/');
      const rapier=publicPath==='/node_modules/@dimforge/rapier3d-compat/rapier.mjs'&&actualPath.startsWith('/node_modules/')&&actualPath.endsWith('/@dimforge/rapier3d-compat/rapier.mjs');
      if(!rapier&&!isPublicAsset(actualPath)){res.writeHead(404).end('Not found');return;}
      const data=await readFile(actualFile);
      res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Content-Length',data.length);
      res.writeHead(200).end(req.method==='HEAD'?undefined:data);
    }catch{if(!res.headersSent)res.writeHead(404).end('Not found');else res.end();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||5173);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be an integer in 1–65535');
  createAppServer({port}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
}
