import {diagnosticsCSV} from './mechanical-diagnostics.js';
import {validationCases,validationProject,validationCSV,VALIDATION_VERSION} from './validation.js';
import {mountContactValidation,wireContactValidation} from './contact-validation-ui.js';

export function mountValidationPanels(folder){
  mountContactValidation(folder);
  folder('solver','project-validation-panel','数值验证与诊断').innerHTML+=
    '<label class="check"><input id="mechanics-enabled" type="checkbox">记录机械能与动量诊断</label><button id="mechanics-apply">应用诊断设置并重置</button>'+
    '<p class="hint">CPU 诊断会增加计算开销。材料储能支持共旋转弹性和 Neo-Hookean；塑性、损伤及 PBF 的完整机械能暂不报告。</p>'+
    '<label for="validation-case">验证算例</label><select id="validation-case"><option value="stretch">夹具拉伸</option><option value="twist">夹具扭转</option><option value="oscillator">无阻尼弹簧振动</option><option value="impact">双球正碰</option></select>'+
    '<button id="validation-load">载入验证算例并重置</button><div class="buttons"><button id="validation-run">运行全部基准与细化</button><button id="validation-cancel" disabled>取消验证</button></div>'+
    '<p class="hint">18 组独立 CPU 计算：拉伸、扭转、振动、正碰。后台验证不替换当前模型；时间细化检查实际子步，网格细化固定几何与密度、关闭采样噪声。</p><p id="validation-progress" class="hint" role="status"></p>';
  folder('results','project-mechanics-results','机械能与动量诊断').innerHTML+=
    '<p id="mechanics-readout" class="hint" role="status" style="white-space:pre-line;font-variant-numeric:tabular-nums"></p><button id="mechanics-export">导出机械诊断 CSV</button>'+
    '<p class="hint">残差 = 机械能变化 − 外载功 − 驱动估计功 − 接触功 − 网格边界功 − 区域冲量功 − 区域储能变化 + 阻尼损失估计。余项包含传递、积分、位置修正及未分解的刚体约束和接触；不是材料耗散。有支座、重力或外载时，动量变化不等于守恒误差。</p>';
  folder('results','project-validation-results','基准与细化报告').innerHTML+=
    '<p id="validation-summary" class="hint" role="status" style="white-space:pre-line"></p><div id="validation-report" style="overflow-x:auto;font-size:11px"></div>'+
    '<div class="buttons"><button id="validation-json" disabled>导出验证 JSON</button><button id="validation-csv" disabled>导出验证 CSV</button></div>'+
    '<p class="hint">解析基准检验振动位移和碰后速度；拉伸、扭转比较三档分辨率的末态驱动坐标。细化一致仅表示当前观测量敏感度较低，不代表所有场量收敛。待检查项保留原始数值。</p>';
}
export function wireValidation({getProject,load,guard,download,getHistory,reveal}){
  const contactValidation=wireContactValidation({getProject,download,reveal});
  const $=id=>document.getElementById(id),en=()=>document.documentElement.lang==='en',fmt=x=>x==null?'—':x.toExponential(3);
  let worker=null,report=null;
  const text=(cn,english)=>en()?english:cn;
  function renderReport(){
    if(!report){$('validation-summary').textContent=text('尚无基准报告；在求解目录运行验证。','No report yet. Run validation in Solver.');return;}
    const checks=report.refinement.filter(r=>r.status==='check').length;
    $('validation-summary').textContent=`${report.backend}\n${report.createdAt}\n${report.rows.length} ${text('组计算','runs')} · ${checks} ${text('组细化待检查','refinement checks need review')}`;
    const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums';
    const header=table.createTHead().insertRow();
    for(const label of [text('算例/细化','Case / sweep'),text('差异 / 解析误差','Change / analytic error'),text('判断','Status')]){const cell=document.createElement('th');cell.textContent=label;cell.style.cssText='text-align:left;padding:7px 3px;border-bottom:1px solid #8885';header.append(cell);}
    for(const row of report.refinement){
      const tr=table.insertRow(),name=en()?row.case:validationCases.find(c=>c.id===row.case).name;
      const change=row.finestError!=null?`${fmt(row.finestError)} ${row.case==='oscillator'?'m':'m/s'}`:`${(100*row.relativeChange).toFixed(2)}%`;
      for(const value of [`${name} / ${row.sweep==='time'?text('时间','time'):text('网格','grid')}`,change,row.status==='pass'?text('解析校验通过','analytic pass'):row.status==='consistent'?text('细化一致','consistent'):text('待检查','check')]){
        const cell=tr.insertCell();cell.textContent=value;cell.style.cssText='padding:7px 3px;border-bottom:1px solid #8883';
      }
    }
    const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent=text('查看每组数值与实际子步','Inspect each run and actual substeps');detail.append(summary);
    for(const row of report.rows){const p=document.createElement('p');p.style.whiteSpace='pre-line';p.textContent=`${row.case} / ${row.sweep} · ${row.count} points\nΔt ${fmt(row.dt)} s · h ${row.count?row.cellSize.toPrecision(4):'—'} m\n${text('实际子步','Actual substep')} ${fmt(row.diagnostics.minSubstep)}–${fmt(row.diagnostics.maxSubstep)} s\n${text('观测值 / 质量','Value / mass')} ${fmt(row.value)} / ${row.mass.toFixed(3)} kg\n${text('连接偏移 / 未分解残差','Drift / unresolved residual')} ${fmt(row.maxConstraint)} m / ${fmt(row.diagnostics.residual)} J`;detail.append(p);}
    $('validation-report').replaceChildren(table,detail);$('validation-json').disabled=$('validation-csv').disabled=false;
  }
  function finish(){worker?.terminate();worker=null;$('validation-run').disabled=false;$('validation-cancel').disabled=true;}
  $('mechanics-apply').onclick=guard(()=>{const p=getProject();p.solver.diagnostics=$('mechanics-enabled').checked;if(p.solver.diagnostics&&p.solver.adapter!=='cpu-coupled')throw Error('机械诊断当前使用 CPU；请先切换项目计算设备。');return load(p);});
  $('validation-load').onclick=guard(async()=>{await load(validationProject($('validation-case').value));reveal('results','project-mechanics-results');});
  $('validation-run').onclick=()=>{
    if(worker)return;$('validation-run').disabled=true;$('validation-cancel').disabled=false;$('validation-progress').textContent=text('正在运行独立验证…','Running independent validation…');
    try{worker=new Worker(new URL('./validation-worker.js',import.meta.url),{type:'module'});}catch(e){finish();$('validation-progress').textContent=e.message;return;}
    worker.onmessage=({data})=>{
      if(data.type==='progress'){$('validation-progress').textContent=`${data.value.index+1}/${data.value.total} · ${data.value.case} / ${data.value.sweep} · ${Math.round(data.value.fraction*100)}%`;}
      else if(data.type==='complete'){report=data.report;finish();renderReport();$('validation-progress').textContent=text('验证完成；报告中保留所有待检查项。','Validation complete; all checks are retained.');reveal('results','project-validation-results');}
      else if(data.type==='error'){finish();$('validation-progress').textContent=data.message;}
    };
    worker.onerror=e=>{finish();$('validation-progress').textContent=e.message;};
    worker.postMessage({type:'run'});
  };
  $('validation-cancel').onclick=()=>{finish();$('validation-progress').textContent=text('验证已取消；已完成报告保持不变。','Validation canceled. The previous completed report is retained.');};
  $('mechanics-export').onclick=()=>download('\ufeff'+diagnosticsCSV(getHistory()),'summer-mechanical-diagnostics.csv','text/csv;charset=utf-8');
  $('validation-json').onclick=()=>{if(report)download(JSON.stringify(report,null,2),'summer-numerical-validation.json','application/json');};
  $('validation-csv').onclick=()=>{if(report)download('\ufeff'+validationCSV(report),'summer-numerical-validation.csv','text/csv;charset=utf-8');};
  fetch('/artifacts/numerical-validation.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(r=>{if(!report&&r?.schema==='summer-validation/1'&&r.version===VALIDATION_VERSION){report=r;renderReport();}}).catch(()=>{});
  window.addEventListener('workbench-languagechange',renderReport);
  const reasonNames={'unsupported-material-energy':['包含暂不支持储能计算的材料','Unsupported material energy'],'motor-work-estimated':['驱动功为估计值','Motor work estimated'],'gear-work-unresolved':['齿轮功未分解','Gear work unresolved'],'rigid-contact-unresolved':['刚体间接触功未单独测量','Rigid–rigid contact work not measured separately'],'external-loads':['存在外部重力或载荷','External gravity or loads'],'damping-estimated':['阻尼损失为估计值','Damping loss estimated'],'external-support-reactions':['存在外部支座反力','External support reactions']};
  return {
    refresh(){$('mechanics-enabled').checked=!!getProject().solver.diagnostics;renderReport();contactValidation.refresh();},
    display(frame){
      contactValidation.display(frame);
      const d=frame.diagnostics;
      const content=d?[
        `${text('诊断起点','Baseline')} ${d.baselineTime.toFixed(3)} s · ${text('实际子步','Actual substep')} ${fmt(d.minSubstep)}–${fmt(d.maxSubstep)} s`,
        `${text('机械能 / 材料储能','Mechanical / material energy')} ${fmt(d.mechanicalEnergy)} / ${fmt(d.materialElastic)} J`,
        `${text('粒子平动 / APIC 局部动能','Particle / APIC kinetic energy')} ${fmt(d.particleKinetic)} / ${fmt(d.apicKinetic)} J`,
        `${text('外载功 / 驱动功估计','Load / estimated motor work')} ${fmt(d.externalWork)} / ${fmt(d.motorWorkEstimate)} J`,
        `${text('法向 / 摩擦接触功','Normal / friction contact work')} ${fmt(d.contactNormalWork)} / ${fmt(d.contactFrictionWork)} J`,
        `${text('网格边界功 / 阻尼损失估计','Boundary work / estimated damping loss')} ${fmt(d.boundaryWork)} / ${fmt(d.dampingLossEstimate)} J`,
        `${text('区域冲量功 / 正向修正功','Region impulse / positive correction work')} ${fmt(d.regionImpulseWork)} / ${fmt(d.positiveCorrectionWork)} J`,
        `${text('未分解残差','Unresolved residual')} ${fmt(d.residual)} J`,
        `|ΔP| ${fmt(d.momentumChange)} kg·m/s · |ΔH| ${fmt(d.angularMomentumChange)} kg·m²/s`,
        `${text('约束偏移 / 接触穿透','Constraint drift / penetration')} ${fmt(d.constraintError)} / ${fmt(d.penetration)} m`,
        ...d.reasons.map(r=>reasonNames[r]?.[en()?1:0]??r),
      ].join('\n'):text('请在求解与性能 → 数值验证与诊断中启用。GPU 和旧回放帧暂不提供此诊断。','Enable in Solver → Numerical validation. GPU and older recordings do not provide this diagnostic.');
      if($('mechanics-readout').textContent!==content)$('mechanics-readout').textContent=content;
    }
  };
}
