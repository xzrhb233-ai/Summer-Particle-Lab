import {createProjectArchive} from './project-archive.js';

const outcomeNames={completed:'完成',paused:'暂停',error:'失败',stopped:'停止'};
const metricNames={particleCount:'粒子数',nodeCount:'节点数',elementCount:'单元数',partCount:'部件数',steps:'步数',maxDisplacement:'最大位移 m',maxSpeed:'最大速度 m/s',maxVonMises:'最大等效应力 Pa',minTemperature:'最低温度 °C',maxTemperature:'最高温度 °C',kineticEnergy:'动能 J',strainEnergy:'应变能 J',thermalEnergy:'热量 J',externalWork:'外载功 J',frictionHeat:'摩擦热 J',plasticHeat:'塑性热 J',thermalResidual:'热量残差 J',energyResidual:'能量残差 J',contactImpulse:'接触冲量 N·s',maxPenetration:'最大穿透 m',minDt:'最小步长 s',maxDt:'最大步长 s',computeSeconds:'计算耗时 s',simulationRate:'模拟速率'};
const format=v=>Number.isFinite(v)?Number(v.toPrecision(6)).toString():'—';
const date=v=>new Date(v).toLocaleString();

// Startup only lists saved revisions. Restore is always an explicit user action.
// Automatic hooks return null on storage failure and never interrupt a solver.
export function wireProjectArchive({parent,getProject,load,busy=()=>false,getRun,archive=createProjectArchive()}){
  const panel=document.createElement('details');panel.id='project-archive-panel';panel.className='subdirectory';panel.dataset.userContent='';
  panel.innerHTML=`<summary>项目版本与运行记录</summary>
    <p class="hint">保存在此浏览器的本地数据库。应用模型后自动建立版本，也可命名保存。重新打开页面后请主动选择恢复；不会自动覆盖当前项目。cfg 为按保存内容生成的归档内部版本标识。</p>
    <label for="archive-label">版本名称（可选）</label><input id="archive-label" maxlength="100" placeholder="例如：四孔板 · 孔径 0.18 m">
    <div class="buttons"><button id="archive-save">保存当前版本</button><button id="archive-refresh">刷新归档</button></div>
    <label for="archive-revision">已保存的项目版本</label><select id="archive-revision"></select><p id="archive-revision-info" class="hint" style="white-space:pre-line"></p>
    <div class="buttons"><button id="archive-restore">恢复此版本</button><button id="archive-delete-revision">删除此版本及关联记录</button></div>
    <label for="archive-run">运行记录</label><select id="archive-run"></select><p id="archive-run-info" class="hint" style="white-space:pre-line"></p>
    <div class="buttons"><button id="archive-record-run">记录当前结果摘要</button><button id="archive-delete-run">删除此运行记录</button></div>
    <p class="hint">运行记录只包含对应项目版本、结束状态、模拟时间和有限的数值摘要；不保存完整场量或求解器内部状态，不能据此续算。恢复版本会从初始条件重新建立模型。</p>
    <p id="archive-capacity" class="hint"></p><button id="archive-clear">清空本地归档</button><p id="archive-status" class="hint" role="status" aria-live="polite"></p>`;
  parent.append(panel);const $=id=>panel.querySelector('#'+id);
  let state={revisions:[],runs:[]},working=false,disposed=false,generation=0;
  const status=(message,error=false)=>{if(disposed)return;$('archive-status').textContent=message;$('archive-status').classList.toggle('cad-error',error);};
  function buttons(){
    for(const button of panel.querySelectorAll('button'))button.disabled=working;
    $('archive-restore').disabled=working||!$('archive-revision').value;
    $('archive-delete-revision').disabled=working||!$('archive-revision').value;
    $('archive-delete-run').disabled=working||!$('archive-run').value;
    $('archive-record-run').disabled=working||typeof getRun!=='function';
  }
  function describe(){
    const revision=state.revisions.find(r=>r.id===$('archive-revision').value),run=state.runs.find(r=>r.id===$('archive-run').value);
    $('archive-revision-info').textContent=revision?`${revision.name} · ${revision.partCount} 个部件\n${date(revision.createdAt)} · ${revision.configurationId}\n${(revision.bytes/1024).toFixed(1)} KiB · ${revision.reason==='manual'?'手动保存':revision.reason==='run'?'运行时归档':'应用后检查点'}`:'尚无已保存版本。';
    $('archive-run-info').textContent=run?`${outcomeNames[run.outcome]} · ${run.backend.toUpperCase()} · t=${format(run.time)} s${run.targetTime==null?'':` / ${format(run.targetTime)} s`}\n${date(run.createdAt)} · ${run.configurationId}\n${Object.entries(run.summary).map(([key,value])=>`${metricNames[key]??key}：${format(value)}`).join('\n')||'此运行未报告可归档的量化结果。'}`:'尚无运行记录。';
    buttons();
  }
  async function refresh(){
    const ticket=++generation;
    try{
      const next=await archive.list();if(disposed||ticket!==generation)return null;state=next;
      for(const [id,items,display]of [
        ['archive-revision',next.revisions,r=>`${r.label||r.name||'未命名项目'} · ${date(r.createdAt)}`],
        ['archive-run',next.runs,r=>`${r.label||outcomeNames[r.outcome]} · ${format(r.time)} s · ${date(r.createdAt)}`],
      ]){const selected=$(id).value;$(id).replaceChildren(...items.map(r=>new Option(display(r),r.id)));if(items.some(r=>r.id===selected))$(id).value=selected;}
      $('archive-capacity').textContent=`版本 ${next.revisions.length}/${next.limits.revisions} · 运行 ${next.runs.length}/${next.limits.runs} · ${(next.bytes/1024/1024).toFixed(2)}/${(next.limits.bytes/1024/1024).toFixed(0)} MiB。容量满后请手动删除；不会自动清除旧记录。`+(next.invalidCount?` ${next.invalidCount} 条损坏记录已隐藏，可清空归档后重新保存。`:'');
      describe();return next;
    }catch(error){status('本地归档不可用：'+error.message+'。模拟不受影响，可使用保存项目 JSON。',true);return null;}
  }
  async function checkpoint(project,reason='edit'){
    try{const result=await archive.saveRevision(project,typeof reason==='string'?{reason}:reason);await refresh();status(result.created?'项目版本已保存到本地。':'相同项目配置已归档。');return result;}
    catch(error){status('项目尚未归档：'+error.message,true);return null;}
  }
  async function recordRun(record){
    try{const result=await archive.recordRun(record??getRun?.());await refresh();status('运行摘要已归档，已关联对应项目版本。');return result;}
    catch(error){status('运行摘要尚未归档：'+error.message,true);return null;}
  }
  const action=fn=>async()=>{if(working)return;working=true;buttons();try{await fn();}catch(error){status(error.message,true);}finally{working=false;if(!disposed)buttons();}};
  $('archive-save').onclick=action(()=>checkpoint(getProject(),{label:$('archive-label').value,reason:'manual'}));
  $('archive-refresh').onclick=action(refresh);
  $('archive-restore').onclick=action(async()=>{
    if(busy())throw Error('请先暂停并等待当前求解或加载结束');
    const revision=await archive.getRevision($('archive-revision').value);if(busy())throw Error('当前项目正在求解或加载，请稍后恢复');
    await load(revision.project);status('已恢复项目版本；模型从初始条件重新建立，旧运行时程不恢复。');
  });
  $('archive-delete-revision').onclick=action(async()=>{const id=$('archive-revision').value;if(!id)return;if(!window.confirm('删除此版本及关联的运行摘要？当前模型不会删除。'))return;await archive.deleteRevision(id);await refresh();status('已删除选中的版本及关联记录。');});
  $('archive-delete-run').onclick=action(async()=>{const id=$('archive-run').value;if(!id)return;if(!window.confirm('删除此运行摘要？项目版本会保留。'))return;await archive.deleteRun(id);await refresh();status('已删除运行摘要。');});
  $('archive-record-run').onclick=action(()=>recordRun());
  $('archive-clear').onclick=action(async()=>{if(!window.confirm('清空此浏览器中的全部项目版本及运行记录？当前模型不会删除。'))return;await archive.clear();await refresh();status('本地归档已清空。');});
  $('archive-revision').onchange=describe;$('archive-run').onchange=describe;
  buttons();void refresh();
  return {checkpoint,recordRun,refresh,dispose(){disposed=true;generation++;panel.remove();}};
}
