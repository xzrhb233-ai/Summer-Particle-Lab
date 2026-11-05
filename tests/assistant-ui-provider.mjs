// Deterministic browser-test fixture, never used by the production gateway.
// Run explicitly: node tests/assistant-ui-provider.mjs
import {createServer} from 'node:http';
const c=(command,args={})=>({command,args});
createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  let data='';for await(const b of req)data+=b;
  const body=JSON.parse(data),prompt=body.messages.at(-1).content.split('用户请求：\n').at(-1);
  let commands=[];
  if(prompt.includes('曲面测试'))commands=[c('cad.surface.create',{id:'ui-surface',name:'AI 马鞍曲面',spec:{kind:'bezier',controlPoints:Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>{const u=i/3*2-1,v=j/3*2-1;return [u*.6,.7+.3*u*v,v*.5];})),segmentsU:24,segmentsV:24}})];
  else if(prompt.includes('曲线测试'))commands=[c('cad.curve.create',{id:'ui-bezier',name:'AI Bezier 参考曲线',spec:{kind:'bezier',controlPoints:[[-.4,.7,0],[-.2,1.1,0],[.2,.3,0],[.4,.7,0]],samples:64}})];
  else if(prompt.includes('四面体测试'))commands=[c('cad.create',{id:'ui-tet',name:'AI 四面体通孔板',method:'fem',recipe:[{operation:'base',shape:'box',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0]},{operation:'difference',shape:'cylinder',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0]}],meshOptions:{kind:'volume',targetSize:.2,angleTolerance:15,chordTolerance:.002},young:100000,poisson:.3,density:1000,fixedFace:'y-'})];
  else if(prompt.includes('单独网格测试'))commands=[c('cad.mesh',{id:'ui-tet',options:{kind:'surface',targetSize:.1}})];
  else if(prompt.includes('CAD打孔测试'))commands=[c('cad.create',{id:'ai-cad-test',name:'AI 通孔块',method:'mpm',density:1000,model:0,temperature:20,recipe:[{operation:'base',shape:'box',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0]},{operation:'difference',shape:'cylinder',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0]}]})];
  else if(prompt.includes('CAD扩大孔'))commands=[c('cad.update',{id:'ai-cad-test',recipe:[{operation:'base',shape:'box',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0]},{operation:'difference',shape:'cylinder',center:[0,.7,0],size:[.4,.8,.4],rotation:[0,0,0]}]})];
  else if(prompt.includes('CAD空实体'))commands=[c('cad.create',{id:'invalid-cad',method:'mpm',recipe:[{operation:'base',shape:'box',center:[0,.7,0],size:[.2,.2,.2],rotation:[0,0,0]},{operation:'difference',shape:'box',center:[0,.7,0],size:[.5,.5,.5],rotation:[0,0,0]}]})];
  else if(prompt.includes('CAD延迟'))commands=[c('cad.create',{id:'ai-cad-delay',method:'pbf',recipe:[{operation:'base',shape:'box',center:[0,.7,0],size:[.3,.3,.3],rotation:[0,0,0]}]})];
  else if(prompt.includes('创建测试方块'))commands=[c('part.create',{id:'ai-test',method:'rigid',name:'AI 测试方块',shape:'box',size:[.3,.3,.3],center:[0,1,0]}),c('solver.configure',{device:'cpu',dt:.002,duration:20})];
  else if(prompt.includes('创建四类'))commands=['mpm','fem','rigid','pbf'].map((method,i)=>c('part.create',{id:'ai-'+method,method,name:'AI '+method,center:[(i-1)*.45,1,0],size:[.2,.2,.2],...(method==='fem'?{divisions:[2,2,2]}:{})}));
  else if(prompt.includes('非法'))commands=[c('file.write',{path:'server.mjs',content:'forbidden'})];
  else if(prompt.includes('暂停'))commands=[c('simulation.pause')];
  else if(prompt.includes('运行'))commands=[c('simulation.run')];
  else if(prompt.includes('单步'))commands=[c('simulation.step')];
  else if(prompt.includes('删除'))commands=[c('part.delete',{id:'ai-test'})];
  const send=()=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'本地测试服务（非真实 AI）：'+prompt,commands})}}]}));
  if(prompt.includes('延迟'))setTimeout(send,5000);else send();
}).listen(5181,'127.0.0.1',()=>console.log('Browser-test provider on 5181; no real model or API key.'));
