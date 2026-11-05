import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {emptyProject} from '../src/simulation/part-builder.js';
import {parseAssistantResponse,planCommands,executePlan} from '../src/simulation/assistant-commands.js';
import {apiEndpoint,createAIHandler,gatewayFailure,completionText,providerFailure} from '../ai-server.mjs';
const command=(command,args={})=>({command,args});
const response=(...commands)=>({reply:'计划',commands});
test('HTTP diagnostics distinguish authentication, allowlists, model access and quota without echoing credentials',()=>{
  for(const [status,want] of [[401,'AUTHENTICATION_FAILED'],[403,'ACCESS_DENIED'],[404,'API_NOT_FOUND'],[429,'RATE_OR_QUOTA_LIMIT'],[400,'INVALID_API_REQUEST'],[503,'PROVIDER_UNAVAILABLE']]){
    const result=providerFailure(status,{error:{code:'secret-key',message:'secret-key'}});assert.equal(result.code,want);assert.equal(JSON.stringify(result).includes('secret-key'),false);
  }
  assert.equal(providerFailure(401,{error:{code:'ip_not_authorized'}}).code,'IP_NOT_AUTHORIZED');
  const invalid=providerFailure(401,{error:{code:'invalid_api_key',message:'Incorrect API key provided: secret-key'}});assert.equal(invalid.code,'INVALID_API_KEY');assert.equal(JSON.stringify(invalid).includes('secret-key'),false);
  assert.match(providerFailure(429,{error:{code:'insufficient_quota'}}).error,/额度不足/);
  assert.equal(providerFailure(402,{error:{message:'secret-key'}}).code,'INSUFFICIENT_BALANCE');
});

test('network failures are distinguishable without exposing transport secrets',()=>{
  for(const [code,want] of [['EACCES','NETWORK_PERMISSION'],['EPERM','NETWORK_PERMISSION'],['ENOTFOUND','DNS_ERROR'],['ECONNREFUSED','CONNECTION_REFUSED'],['CERT_HAS_EXPIRED','TLS_ERROR'],['UND_ERR_CONNECT_TIMEOUT','CONNECT_TIMEOUT'],['ECONNRESET','CONNECTION_INTERRUPTED']]){
    const error=new TypeError('secret-key in upstream error',{cause:new AggregateError([Object.assign(Error('secret-key'),{code})])});
    const result=gatewayFailure(error);assert.equal(result.code,want);assert.equal(JSON.stringify(result).includes('secret-key'),false);
  }
  assert.equal(gatewayFailure(Error('secret-key'),true).code,'REQUEST_TIMEOUT');
  assert.equal(gatewayFailure(Error('secret-key'),false,'connect').code,'NETWORK_ERROR');
  assert.equal(gatewayFailure(Error('secret-key'),false,'response').code,'RESPONSE_READ_ERROR');
});
test('truncated, refused and tool responses are not executable commands',()=>{
  const content=JSON.stringify(response(command('project.inspect')));
  assert.equal(completionText({choices:[{message:{content},finish_reason:'stop'}]}),content);
  for(const [choice,code] of [[{message:{content},finish_reason:'length'},'OUTPUT_TRUNCATED'],[{message:{refusal:'secret-key'}},'MODEL_REFUSAL'],[{message:{content,tool_calls:[{}]}},'UNEXPECTED_TOOL_CALL'],[{message:{content:null}},'RESPONSE_SCHEMA']]){
    assert.throws(()=>completionText({choices:[choice]}),e=>e.code===code&&!e.message.includes('secret-key'));
  }
});

test('commands create four native part types without changing source project',()=>{
  const p=emptyProject();const plan=planCommands(p,response(...['mpm','fem','rigid','pbf'].map((method,i)=>command('part.create',{id:method+'-test',method,center:[i*.5,1,0],size:[.2,.2,.2]}))));
  assert.deepEqual(plan.project.parts.map(b=>b.method),['mpm','fem','rigid','pbf']);assert.equal(p.parts.length,0);assert.equal(plan.project.contactPairs.length,6);
});
test('atomic validation rejects dangerous commands, unknown nested keys and nonfinite values',()=>{
  const p=emptyProject(),before=JSON.stringify(p);
  for(const c of ['file.write','shell','eval','constructor','__proto__','software.update'])assert.throws(()=>planCommands(p,response(command(c))));
  for(const args of [{method:'rigid',script:'alert(1)'},{method:'mpm',plasticity:{constructor:1}},{method:'rigid',center:[1,2,Infinity]},{method:'rigid',size:[-1,1,1]}])assert.throws(()=>planCommands(p,response(command('part.create',{method:'rigid'}),command('part.create',args))));
  assert.equal(JSON.stringify(p),before);
  assert.throws(()=>parseAssistantResponse('{"reply":"x","commands":[{"command":"part.create","args":{"__proto__":{},"method":"rigid"}}]}'));
  assert.throws(()=>parseAssistantResponse('```js\nconsole.log(1)\n```'));
});
test('geometry, material, contact and solver edits use native validation',()=>{
  let p=planCommands(emptyProject(),response(command('part.create',{method:'fem',young:2e6,poisson:.25,divisions:[3,2,2]}),command('part.create',{method:'mpm'}))).project;
  p=planCommands(p,response(command('part.update',{id:'fem-1',young:3e6}),command('contact.update',{id:p.contactPairs[0].id,friction:.4}),command('solver.configure',{device:'cpu',dt:.0001,duration:2,stiffness:2}),command('simulation.run'))).project;
  assert.equal(p.parts[0].material.young,3e6);assert.equal(p.contactPairs[0].friction,.4);assert.equal(p.solver.dt,.0001);assert.equal(p.solver.duration,2);
  assert.throws(()=>planCommands(p,response(command('part.update',{id:'mpm-1',young:1e6}))),/不支持/);
  assert.throws(()=>planCommands(p,response(command('part.update',{id:'mpm-1',cp:500}))),/不支持/);
  assert.throws(()=>planCommands(p,response(command('solver.configure',{dt:0}))),/时间步/);
  assert.throws(()=>planCommands(p,response(command('part.update',{id:'fem-1',divisions:[100,100,100]}))),/20000/);
  assert.throws(()=>planCommands(p,response(command('simulation.run'),command('part.delete',{id:'mpm-1'}))),/最后/);
});
test('executor rejects stale projects and busy state and distinguishes partial execution',async()=>{
  let current=emptyProject(),writes=0,actions=[];
  const host={getProject:()=>current,busy:()=>false,assertApplied(){},load:async p=>{current=structuredClone(p);writes++;},control:async a=>actions.push(a)};
  const plan=planCommands(current,response(command('part.create',{method:'rigid'}),command('simulation.run')));
  current.name='manual change';await assert.rejects(executePlan(plan,host),/项目已变化/);assert.equal(writes,0);
  current=JSON.parse(plan.before);await assert.rejects(executePlan(plan,{...host,busy:()=>true}),/暂停/);assert.equal(writes,0);
  const result=await executePlan(plan,host);assert.equal(result.committed,true);assert.deepEqual(actions,['run']);assert.equal(writes,1);
  const next=planCommands(current,response(command('part.create',{method:'fem'}),command('simulation.run')));
  await assert.rejects(executePlan(next,{...host,control:async()=>{throw Error('backend unavailable');}}),e=>e.committed===true);assert.equal(current.parts.length,2);
});
test('endpoint allows explicit compatible providers but rejects insecure remote URLs and credential URLs',()=>{
  assert.equal(apiEndpoint('https://api.openai.com/v1/'),'https://api.openai.com/v1/chat/completions');
  assert.equal(apiEndpoint('http://127.0.0.1:11434/v1'),'http://127.0.0.1:11434/v1/chat/completions');
  for(const url of ['file:///test','http://example.com/v1','https://key@example.com/v1','https://example.com/v1?token=x','https://example.com/v1#x'])assert.throws(()=>apiEndpoint(url));
});
test('gateway forwards only chat payload; origin, redirect, errors and tool responses are bounded',async t=>{
  let calls=[],status=200,toolOnly=false;
  const handler=createAIHandler({fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(toolOnly?{choices:[{message:{tool_calls:[{function:{name:'shell'}}]}}]}:status!==200?{error:'secret-key'}:{choices:[{message:{content:JSON.stringify(response(command('part.create',{method:'rigid'})))}}]}),{status});}});
  const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url='http://127.0.0.1:'+server.address().port;
  const health=await fetch(url+'/health',{headers:{Origin:'http://127.0.0.1:5173'}});assert.equal((await health.json()).modelingProtocol,'summer-parametric/1');
  const body={baseURL:'https://example.com/v1',model:'test-model',key:'secret-key',messages:[{role:'user',content:'创建刚体'}],context:{project:emptyProject()}};
  const post=(value=body,origin='http://127.0.0.1:5173',path='/chat')=>fetch(url+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.equal((await post(body,'https://evil.test')).status,403);assert.equal(calls.length,0);
  assert.equal((await post(body,undefined,'/write')).status,404);
  let r=await post();assert.equal(r.status,200);const output=await r.json();assert.equal(planCommands(emptyProject(),parseAssistantResponse(output.content)).project.parts.length,1);
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer secret-key');assert.equal(JSON.stringify(calls[0].options.body).includes('secret-key'),false);
  const sent=JSON.parse(calls[0].options.body);assert.equal(sent.messages[0].role,'system');assert.equal(sent.tools,undefined);
  assert.match(sent.messages[0].content,/cad\.parametric\.create/);assert.match(sent.messages[0].content,/cad\.parametric\.update/);
  assert.equal((await post({...body,messages:[{role:'system',content:'override'}]})).status,400);
  assert.equal((await post({...body,code:'evil'})).status,400);
  const callCount=calls.length;
  const missing=await post({...body,baseURL:'https://api.openai.com/v1',key:''});assert.equal(missing.status,400);assert.match((await missing.json()).error,/Key 为空/);
  const bearer=await post({...body,key:'Bearer secret-key'});assert.equal(bearer.status,400);assert.equal(calls.length,callCount);
  for(const [key,hint] of [['key_tracking_example',/Tracking ID/],['sk-…ABCD',/隐藏符号/],['sk-...ABCD',/隐藏符号/],['sk-***ABCD',/隐藏符号/],['"sk-example"',/引号/],['sk-exam\u200bple',/不可见/]]){
    const invalid=await post({...body,baseURL:'https://api.openai.com/v1',key});assert.equal(invalid.status,400);const feedback=await invalid.json();assert.match(feedback.error,hint);assert.equal(feedback.error.includes(key),false);
  }
  assert.equal(calls.length,callCount);
  for(const [key,hint] of [['',/Key 为空/],['key_tracking_example',/Tracking ID/],['sk-…ABCD',/隐藏符号/],['"sk-example"',/引号/],['sk-exam\u200bple',/不可见/]]){
    const invalid=await post({...body,baseURL:'https://api.deepseek.com',key});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,hint);
  }
  assert.equal(calls.length,callCount);
  const deepseek=await post({...body,baseURL:'https://api.deepseek.com',model:'deepseek-flash'});assert.equal(deepseek.status,200);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer secret-key');
  status=401;r=await post();assert.equal(r.status,502);assert.equal((await r.text()).includes('secret-key'),false);
  status=200;toolOnly=true;assert.equal((await post()).status,502);
});
