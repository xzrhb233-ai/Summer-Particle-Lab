import {assessSimulation,VV_VERSION} from './vv-diagnostics.js';
import {parseExperimentCSV,compareExperiment} from './vv-metrics.js';
import {VV_OBSERVABLES,simulationSeries} from './vv-observables.js';
import {configurationId} from './workspace-context.js';
import {archiveProjectSnapshot} from './project-archive.js';

const labels={observed:'已观察到异常 / 待复核',risk:'适用性风险','not-assessed':'尚未评估','within-threshold':'本项在筛查阈值内',estimated:'误差估计',indeterminate:'证据不足',inconclusive:'证据不足',limited:'达到计算上限',cancelled:'已取消',unavailable:'不可用',passed:'本项通过',pass:'本项通过',failed:'本项未通过',fail:'本项未通过',unsupported:'不支持',complete:'已计算',completed:'已计算',error:'计算失败'};
const format=x=>typeof x==='number'&&Number.isFinite(x)?Number(x.toPrecision(6)).toString():String(x??'—');
export function wireVV({parent,getState,download}){
  const panel=document.createElement('details');panel.id='project-vv';panel.className='instrument';panel.dataset.userContent='';
  panel.innerHTML=`<summary>结果可信度 · V&V</summary>
    <p class="hint">按证据评价指定模型与用途。未报警、动画正常或基准通过，都不代表整个软件已获得物理确认。</p>
    <div class="buttons"><button id="vv-assess">检查当前结果</button><button id="vv-export">导出证据报告</button></div>
    <p id="vv-origin" class="hint" role="status"></p><div id="vv-checks"></div>
    <details><summary>解析基准与独立细化</summary><p class="hint">在独立后台运行 CPU 轴向补丁、梁网格细化、模态时间积分、热量基准与参数样本；保持当前项目。MPM 平移基准只覆盖零应力跨格平移。</p>
      <button id="vv-benchmarks">运行内置验证组</button><label for="vv-seed">不确定性采样种子</label><input id="vv-seed" type="number" step="1" value="20261105"><label for="vv-count">参数样本数（4–16）</label><input id="vv-count" type="number" step="1" min="4" max="16" value="8">
      <p class="hint">示例中的材料输入分布是演示假设，不是已测量的不确定性；输出分位数不是置信区间。</p></details>
    <details><summary>当前模型 · 时间步细化</summary><p class="hint">CPU 瞬态 FEM：同一模型从初始状态独立运行四档请求步长。比较实际子步；后端限制导致实际步长相同时不报告收敛。最大比较时刻 0.1 s。</p>
      <label for="vv-part">观测 FEM 部件</label><select id="vv-part"></select><label for="vv-field">对比观测量</label><select id="vv-field"><option value="tipY">首个受载面平均 Y 位移（m）</option><option value="maxDisplacement">最大位移幅值（m）</option><option value="temperature">热容加权平均温度（°C）</option></select>
      <label for="vv-duration">比较时刻（从初始时刻起，s）</label><input id="vv-duration" type="number" min="0.000001" max="0.1" step="any" value="0.002"><button id="vv-study">独立运行四档时间步</button></details>
    <button id="vv-cancel" disabled>取消后台验证</button><p id="vv-progress" role="status" class="hint"></p><div id="vv-benchmark-report"></div>
    <details><summary>实验数据对标</summary><p class="hint">仅使用已有 FEM 时程，不启动求解。CSV 时间单位为秒；数值单位见观测量。uncertainty 是可选的实验标准不确定度（1σ），缺失不会当作零。</p>
      <label for="vv-experiment-part">实验对应部件</label><select id="vv-experiment-part"></select><label for="vv-experiment-field">实验对应观测量</label><select id="vv-experiment-field">${VV_OBSERVABLES.map(f=>`<option value="${f.id}">${f.label}（${f.unit}）</option>`).join('')}</select>
      <label for="vv-experiment-source">实验来源 / 工况 / 测量位置</label><input id="vv-experiment-source" maxlength="500" placeholder="填写数据来源和测量定义">
      <label for="vv-experiment-file">导入本地 CSV（最多 256 KiB）</label><input id="vv-experiment-file" type="file" accept=".csv,text/csv"><label for="vv-experiment-csv">或粘贴 CSV</label><textarea id="vv-experiment-csv" rows="6" placeholder="time,value,uncertainty"></textarea>
      <label class="check"><input id="vv-experiment-confirm" type="checkbox">我已核对同工况、同测量定义、时间起点和单位</label>
      <button id="vv-compare">比较已有时程</button><p id="vv-experiment-status" role="status" class="hint">尚未提供实验数据，未建立实验确认。</p><pre id="vv-experiment-output"></pre></details>
    <details><summary>判据与数据范围</summary><p class="hint">能量/热量默认筛查：1% 相对容差 + 10⁻⁸ J 绝对容差。小应变筛查 1%；Tet4 在 ν≥0.45 时提示锁定风险。均不是通用工程验收阈值。单帧不能确诊跨格噪声或数值断裂。GPU 未提供的测量保持“尚未评估”。</p><p class="hint">完整报告附带配置、版本、阈值、对照数据和未覆盖项；不含 API Key。请为正式用途自行定义可接受误差和实验覆盖范围。</p></details>`;
  parent.append(panel);const $=id=>panel.querySelector('#'+id);let worker=null,serial=0,report=null,benchmarks=null,study=null,experiment=null,previous=null,sources={};
  $('vv-count').insertAdjacentHTML('afterend','<label for="vv-young-uncertainty">E 独立均匀分布相对半宽（0–0.5）</label><input id="vv-young-uncertainty" type="number" min="0" max="0.5" step="0.01" value="0.1"><label for="vv-density-uncertainty">ρ 独立均匀分布相对半宽（0–0.5）</label><input id="vv-density-uncertainty" type="number" min="0" max="0.5" step="0.01" value="0.1"><p class="hint">仅用于内置自重梁：E 均值 2×10⁷ Pa，ρ 均值 1000 kg/m³。半宽 0.1 表示均值 ±10%。当前项目的参数不会改变。</p>');
  const origin=()=>{const state=getState();return {project:state.project,frame:state.frame,resultProject:state.resultProject,history:state.history??[],computeError:state.computeError??''};};
  const error=e=>{$('vv-progress').textContent=e.message??String(e);};
  const json=value=>JSON.stringify(value,null,2);
  function renderChecks(){
    const s=getState();$('vv-origin').textContent=report?`t=${format(report.time)} s · ${report.backend} · ${report.resultConfigurationId??'来源未知'}${report.currentConfigurationId!==configurationId(s.project)?' · 项目已改变，请重新检查':''}\n${report.overall==='invalid-state'?'存在无效数值状态':report.overall==='review'?'需要复核':'证据不足，不能判定物理正确'}`:'点击“检查当前结果”生成只读诊断。';
    $('vv-checks').replaceChildren();for(const c of report?.checks??[]){const card=document.createElement('details');card.className='vv-check vv-'+c.status;const title=document.createElement('summary');title.textContent=`${c.title} · ${labels[c.status]??c.status}`;card.append(title);
      for(const text of [c.explanation,...c.observations.map(o=>`${o.name} = ${format(o.value)} ${o.unit}`),...c.possibleCauses.map(v=>'可能原因：'+v),...c.nextChecks.map(v=>'下一项对照：'+v)]){const p=document.createElement('p');p.className='hint';p.textContent=text;card.append(p);} $('vv-checks').append(card);}
  }
  function results(){
    $('vv-benchmark-report').replaceChildren();for(const [title,value] of [['内置验证组',benchmarks],['当前模型时间步对照',study]])if(value){
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title+' · '+(labels[value.status]??value.status??'已生成独立报告');details.open=true;details.append(summary);
      if(value.baseConfigurationId&&value.baseConfigurationId!==configurationId(getState().project)){const p=document.createElement('p');p.className='hint';p.textContent='项目已改变；此报告仅属于 '+value.baseConfigurationId;details.append(p);}
      for(const c of value.cases??[]){const item=document.createElement('details'),heading=document.createElement('summary');heading.textContent=`${c.title??c.id}：${labels[c.status]??c.status}`;item.open=c.status!=='passed';item.append(heading);details.append(item);for(const line of [...(c.checks??[]).map(x=>`${x.name}：${Object.hasOwn(x,'value')?format(x.value)+'，阈值 '+format(x.tolerance)+'，':''}${x.passed?'本项通过':'待检查'}`),c.reason,c.refinement?.reason,c.error].filter(Boolean)){const p=document.createElement('p');p.className='hint';p.textContent=line;item.append(p);}}
      const raw=document.createElement('details'),s=document.createElement('summary'),pre=document.createElement('pre');s.textContent='完整数据、假设与未覆盖项';pre.textContent=json(value);raw.append(s,pre);details.append(raw);$('vv-benchmark-report').append(details);
    }
  }
  function finish(){worker?.terminate();worker=null;$('vv-benchmarks').disabled=$('vv-study').disabled=false;$('vv-cancel').disabled=true;}
  function start(type,plan){
    if(worker)return;const state=getState();if(!state.project)throw Error('项目尚未加载');const id=++serial,project=structuredClone(state.project),source=archiveProjectSnapshot(project).project;
    worker=new Worker(new URL('./vv-worker.js',import.meta.url),{type:'module'});$('vv-benchmarks').disabled=$('vv-study').disabled=true;$('vv-cancel').disabled=false;$('vv-progress').textContent='正在独立计算；当前模型保持不变…';
    worker.onmessage=({data})=>{if(data.id!==id)return;if(data.type==='progress')$('vv-progress').textContent=typeof data.progress==='string'?data.progress:json(data.progress??data.value);else if(data.type==='result'){if(type==='run'){benchmarks=data.report;sources.benchmarkLaunchContext={purpose:'Launch context only; independent benchmark definitions are in benchmarks.cases.',project:source};}else{study=data.report;sources.projectStudy=source;}finish();results();$('vv-progress').textContent='后台计算结束。请查看各项通过、失败、证据不足和未覆盖状态；当前模型未改变。';}else if(data.type==='error'){finish();error(data.message??data.error??'验证计算失败');}};
    worker.onerror=e=>{finish();error(e);};worker.postMessage({type,id,plan,...(type==='project-study'?{project}:{})});
  }
  const guarded=fn=>async()=>{try{await fn();}catch(e){error(e);}};
  $('vv-assess').onclick=guarded(()=>{const state=origin();report=assessSimulation(state);sources.diagnostics=state.resultProject?archiveProjectSnapshot(state.resultProject).project:null;renderChecks();});
  $('vv-benchmarks').onclick=guarded(()=>start('run',{backend:'cpu',seed:Number($('vv-seed').value),ensembleCount:Number($('vv-count').value),materialUncertainty:{youngRelativeHalfWidth:Number($('vv-young-uncertainty').value),densityRelativeHalfWidth:Number($('vv-density-uncertainty').value)}}));
  $('vv-study').onclick=guarded(()=>start('project-study',{mode:'time',duration:Number($('vv-duration').value),partId:$('vv-part').value,field:$('vv-field').value}));
  $('vv-cancel').onclick=()=>{serial++;finish();$('vv-progress').textContent='已取消。此前已完成的报告保留，未完成计算不作为验证证据。';};
  $('vv-experiment-file').onchange=guarded(async()=>{const file=$('vv-experiment-file').files[0];if(!file)return;if(file.size>256*1024)throw Error('实验 CSV 超过 256 KiB');$('vv-experiment-csv').value=await file.text();$('vv-experiment-status').textContent='已读取本地文件，尚未比较。';});
  $('vv-compare').onclick=async()=>{try{
    const state=origin(),field=$('vv-experiment-field').value,definition=VV_OBSERVABLES.find(f=>f.id===field),source=$('vv-experiment-source').value.trim();
    if(!source||!$('vv-experiment-confirm').checked)throw Error('请填写实验来源，并核对工况、观测量和单位');
    if(new TextEncoder().encode($('vv-experiment-csv').value).byteLength>256*1024)throw Error('实验 CSV 超过 256 KiB');
    const measured=parseExperimentCSV($('vv-experiment-csv').value,{quantity:definition.quantity,unit:definition.unit}),simulated=simulationSeries(state,$('vv-experiment-part').value,field);
    const comparison=compareExperiment(simulated,measured);experiment={source,userConfirmedDefinition:true,independentlyAuthenticated:false,configurationId:simulated.configurationId,comparison,simulation:simulated,experiment:measured};sources.experiment=archiveProjectSnapshot(state.resultProject).project;
    $('vv-experiment-status').textContent='已完成数值对比；数据来源为用户声明，未独立核验。缺少模拟侧不确定度时不计算联合覆盖结论。';$('vv-experiment-output').textContent=json(comparison);
  }catch(e){$('vv-experiment-status').textContent=e.message+(experiment?'。下方仍为上一次成功对照，尚未用本次输入更新。':'');}};
  $('vv-export').onclick=guarded(()=>{if(!report&&!benchmarks&&!study&&!experiment)throw Error('请先生成至少一项诊断、基准或对照');download(json({schema:'summer-vv-evidence/1',version:VV_VERSION,createdAt:new Date().toISOString(),currentConfigurationId:configurationId(getState().project),diagnostics:report,benchmarks,projectStudy:study,experimentalComparison:experiment,sourceProjects:sources,limitations:['不是整个软件的认证或通用安全结论。','独立基准不能替代当前模型的收敛性与实测对标。','实验数据来源、测量不确定性及模型参数分布需要使用者核实。']}),'summer-vv-evidence.json','application/json');});
  function refresh(){const p=getState().project;if(!p)return;if(previous!==p){for(const id of ['vv-part','vv-experiment-part']){const before=$(id).value;$(id).replaceChildren(...p.parts.filter(p=>p.method==='fem').map(p=>new Option(p.name+' · '+p.id,p.id)));if([...$(id).options].some(o=>o.value===before))$(id).value=before;}if(previous&&experiment)$('vv-experiment-status').textContent='项目已改变，上次对照仅属于其记录的配置。';previous=p;results();}renderChecks();}
  refresh();return {refresh,dispose(){finish();panel.remove();}};
}
