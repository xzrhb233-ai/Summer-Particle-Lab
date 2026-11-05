import {validateResultQuery} from './result-query.js';

export function wireResultQueries({parent,getProject,query}){
  const panel=document.createElement('details');panel.id='project-result-queries';panel.className='subdirectory';panel.dataset.userContent='';
  panel.innerHTML=`<summary>数值结果查询</summary><p class="hint">只查询现有求解结果。缺失量会明确说明；不会启动模拟或修改模型。</p>
    <label for="result-query-kind">查询内容</label><select id="result-query-kind"><option value="extrema">部件场量极值</option><option value="contacts">接触对摘要</option></select>
    <div id="result-query-part-fields"><label for="result-query-part">部件</label><select id="result-query-part"></select><label for="result-query-field">场量</label><select id="result-query-field"><option value="displacement">位移幅值（m）</option><option value="temperature">温度（°C）</option><option value="stress">von Mises 应力（Pa）</option></select></div>
    <div id="result-query-contact-fields" hidden><label for="result-query-contact">接触对</label><select id="result-query-contact"></select></div>
    <button id="result-query-run">查询当前结果</button><p id="result-query-status" class="hint" role="status"></p><pre id="result-query-output" style="max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px" aria-label="数值查询结果"></pre>`;
  parent.append(panel);const $=id=>panel.querySelector('#'+id);let signature='',working=false,disposed=false,previousProject;
  function stale(){$('result-query-output').textContent='';$('result-query-status').textContent='项目已更新，请重新查询。';}
  function mode(){const contacts=$('result-query-kind').value==='contacts';$('result-query-part-fields').hidden=contacts;$('result-query-contact-fields').hidden=!contacts;}
  function refresh(){
    if(disposed)return;const project=getProject(),parts=(project?.parts??[]).map(p=>({id:p.id,name:p.name})),contacts=(project?.contactPairs??[]).map(p=>({id:p.id,name:p.name||`${p.a} ↔ ${p.b}`})),next=JSON.stringify([parts,contacts]);
    if(previousProject!==undefined&&project!==previousProject)stale();previousProject=project;
    if(next!==signature){signature=next;for(const [id,items,title]of [['result-query-part',parts,'全部部件'],['result-query-contact',contacts,'全部接触对']]){const selected=$(id).value;$(id).replaceChildren(new Option(title,''),...items.map(p=>new Option(`${p.name} · ${p.id}`,p.id)));if(items.some(p=>p.id===selected))$(id).value=selected;}}
    mode();
  }
  $('result-query-kind').onchange=mode;
  $('result-query-run').onclick=async()=>{
    if(working)return;working=true;$('result-query-run').disabled=true;const sourceProject=getProject();
    try{
      const contacts=$('result-query-kind').value==='contacts',id=$(contacts?'result-query-contact':'result-query-part').value;
      const args=validateResultQuery(contacts?{kind:'contacts',limit:20,...(id?{contactId:id}:{})}:{kind:'extrema',field:$('result-query-field').value,...(id?{partId:id}:{})});
      const result=await query(args);if(disposed)return;if(getProject()!==sourceProject){stale();return;}
      const encoded=JSON.stringify(result,null,2),truncated=encoded.length>24000;
      $('result-query-output').textContent=truncated?encoded.slice(0,24000)+'\n…（显示已截断，请选定单个部件或接触对）':encoded;
      $('result-query-status').textContent=(result.available?'已读取现有结果。':result.reason??'此帧没有所请求的测量。')+(result.matchesCurrentConfiguration===false?' 结果来自其他配置，请核对下方来源标识。':'')+(truncated?' 显示长度已限制。':'');
    }catch(error){if(!disposed){if(getProject()!==sourceProject)stale();else{$('result-query-output').textContent='';$('result-query-status').textContent='查询失败：'+error.message;}}}
    finally{working=false;if(!disposed)$('result-query-run').disabled=false;}
  };
  refresh();return {refresh,dispose(){disposed=true;panel.remove();}};
}
