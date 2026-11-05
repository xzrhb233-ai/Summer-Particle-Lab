import {CONTACT_VALIDATION_VERSION,contactValidationCSV} from './contact-validation.js';
export function mountContactValidation(folder){
  folder('solver','project-contact-validation','接触稳定性与对照').innerHTML+=
    '<p id="physics-clock-readout" class="hint" role="status" style="white-space:pre-line"></p>'+
    '<p class="hint">物理子步按 CFL 限制在统一时间格上二分。界面刷新与记录不改变子步；非对齐的指定停止时间和载荷节点会单独记录截步。</p>'+
    '<label for="contact-validation-backend">接触验证设备</label><select id="contact-validation-backend"><option value="cpu">CPU</option><option value="both">CPU + Taichi GPU</option></select>'+
    '<label for="contact-validation-port">验证 GPU 服务端口</label><input id="contact-validation-port" type="number" min="8765" max="8799" value="8776">'+
    '<div class="buttons"><button id="contact-validation-run">运行接触对照</button><button id="contact-validation-cancel" disabled>取消接触验证</button></div>'+
    '<button id="contact-validation-read">读取已保存接触报告</button>'+
    '<p class="hint">每个设备独立计算 11 组：请求分批、重复运行、时间与网格细化、压紧、滑动、分离。不会替换当前模型或回放；GPU 对照需要新版项目服务，并额外占用计算资源。</p>'+
    '<p id="contact-validation-progress" class="hint" role="status"></p>';
  folder('results','project-contact-validation-report','接触验证报告').innerHTML+=
    '<p id="contact-validation-summary" class="hint" role="status" style="white-space:pre-line"></p>'+
    '<div id="contact-validation-table" style="overflow-x:auto;font-size:11px"></div>'+
    '<div class="buttons"><button id="contact-validation-json" disabled>导出接触验证 JSON</button><button id="contact-validation-csv" disabled>导出接触验证 CSV</button></div>'+
    '<p class="hint">分批对照比较位置、速度、累计冲量和热量。细化比较位移、冲量和热量，待检查项保留原值；三档结果不构成工程精度认证。能量峰值仅在输出时刻采样。</p>';
}
export function wireContactValidation({getProject,download,reveal}){
  const $=id=>document.getElementById(id),en=()=>document.documentElement.lang==='en',t=(a,b)=>en()?b:a,fmt=x=>Number.isFinite(x)?x.toExponential(3):'—';
  let job=null,report=null;
  function render(){
    if(!report){$('contact-validation-summary').textContent=t('尚无接触对照报告。','No contact comparison report yet.');return;}
    const failed=report.rows.filter(r=>r.status!=='pass').length,checks=report.checks.filter(r=>!['pass','consistent'].includes(r.status)).length;
    $('contact-validation-summary').textContent=`${report.version} · ${report.createdAt}\n${report.rows.length} ${t('组计算','runs')} · ${failed} ${t('组稳定性待检查','stability checks need review')} · ${checks} ${t('项对照 / 细化待检查','comparison / refinement checks need review')}\n${report.device?.device??'CPU'}`;
    const table=document.createElement('table');table.style.cssText='width:100%;font-variant-numeric:tabular-nums;border-collapse:collapse';
    const add=(values,head=false)=>{const row=(head?table.createTHead():table).insertRow();for(const [index,value] of values.entries()){const c=document.createElement(head?'th':'td');c.textContent=value;c.style.cssText='padding:6px 3px;text-align:left;vertical-align:top;border-bottom:1px solid #8884;'+(index===2?'white-space:nowrap;width:42px':'white-space:pre-line');row.append(c);}};
    add([t('对照','Comparison'),t('差异','Difference'),t('状态','Status')],true);
    const status=s=>s==='pass'?t('通过','Pass'):s==='consistent'?t('细化一致','Consistent'):s==='missing'?t('数据缺失','Missing'):t('待检查','Check');
    const caseName=id=>({
      'impact-60':t('碰撞 · 1/60 s 请求','Impact · 1/60 s requests'),
      'impact-120':t('碰撞 · 1/120 s 请求','Impact · 1/120 s requests'),
      'impact-irregular':t('碰撞 · 不规则分批','Impact · irregular batches'),
      'impact-repeat':t('碰撞 · 重复运行','Impact · repeat'),
      'time-960':t('时间步 · 1/960 s','Time step · 1/960 s'),
      'time-1920':t('时间步 · 1/1920 s','Time step · 1/1920 s'),
      'grid-coarse':t('粗网格','Coarse grid'),'grid-medium':t('中等网格','Medium grid'),
      press:t('持续压紧','Sustained compression'),slide:t('摩擦滑动','Frictional sliding'),separate:t('自由分离','Free separation'),
    }[id]??id);
    for(const r of report.checks){
      const name={batch:t('分批 / 重复','Batch / repeat'),backend:t('CPU / GPU','CPU / GPU'),time:t('时间细化','Time refinement'),grid:t('网格细化','Grid refinement')}[r.kind];
      const observable={displacement:t('A 块位移','Block A displacement'),impulse:t('接触冲量','Contact impulse'),heat:t('净传热量','Net heat transfer')}[r.observable];
      add([`${r.kind==='backend'?'':r.backend??''} ${name}\n${observable??caseName(r.b)??''}`,
        r.position!=null?`Δx ${fmt(r.position)} m\nΔv ${fmt(r.velocity)} m/s\nΔQ ${fmt(r.heat)} J\nΔJ ${fmt(r.impulse)} N·s`:
          r.relative!=null?`${(r.relative*100).toFixed(2)}%`: '—',status(r.status)]);
    }
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=t('查看实际子步与每组数值','Inspect substeps and per-run values');details.append(summary);
    for(const r of report.rows){
      const p=document.createElement('p');p.style.whiteSpace='pre-line';
      p.textContent=r.error?`${r.backend} / ${r.id}\n${r.error}`:
        `${r.backend} / ${caseName(r.id)} · ${r.count} ${t('粒子','points')} · ${status(r.status)}\nΔt ${fmt(r.dt)} s · h ${fmt(r.cellSize)} m\n${t('实际子步','Actual step')} ${fmt(r.clock.minDt)}–${fmt(r.clock.maxDt)} s · ${r.clock.steps}\n${t('请求截步','Request cuts')} ${r.clock.requestCuts}\nΔx(A) ${fmt(r.final.centers[0]-r.initial.centers[0])} m · m ${fmt(r.final.masses.reduce((a,b)=>a+b,0))} kg\nJ ${fmt(r.normalImpulse)} N·s · Q ${fmt(r.heat)} J\n${t('重叠 / 热量残差','Overlap / thermal residual')} ${fmt(r.maxOverlap)} m / ${fmt(r.maxThermalResidual)} J\n|ΔP| ${fmt(r.maxMomentumError)} kg·m/s · |ΔH| ${fmt(r.maxAngularError)} kg·m²/s\n${t('采样能量增幅','Sampled energy growth')} ${(100*r.maxEnergyGain).toFixed(3)}%`;
      details.append(p);
    }
    const criteria=document.createElement('p');criteria.className='hint';
    criteria.textContent=t('本套检查：估计重叠 ≤ 0.15h，热量残差 < 10⁻⁴ J；无外载算例采样能量增幅 < 3%。有固定支座或外载时，动量变化不作为守恒误差。细化一致要求差异低于 5% 且随细化缩小，或低于绝对阈值。','Suite criteria: estimated overlap ≤ 0.15h and heat residual < 10⁻⁴ J; sampled energy growth < 3% for closed cases. Supported or externally loaded cases are not judged by momentum conservation. Refinement consistency requires decreasing changes below 5%, or changes below the absolute tolerance.');
    $('contact-validation-table').replaceChildren(table,details,criteria);
    $('contact-validation-json').disabled=$('contact-validation-csv').disabled=false;
  }
  function finish(){
    const old=job;job=null;old?.terminate?.();old?.close?.();
    $('contact-validation-run').disabled=false;$('contact-validation-cancel').disabled=true;
  }
  function message(data){
    if(data.type==='progress'){
      const p=data.value;$('contact-validation-progress').textContent=`${p.backend??'CPU'} ${p.index+1}/${p.total} · ${p.case} · ${Math.round(p.fraction*100)}%`;
    }else if(data.type==='complete'){
      if(data.report?.version!==CONTACT_VALIDATION_VERSION){finish();$('contact-validation-progress').textContent=t('报告版本不匹配','Report version mismatch');return;}
      report=data.report;finish();render();reveal('results','project-contact-validation-report');
      $('contact-validation-progress').textContent=t('对照完成，待检查项已保留。','Comparison complete; unresolved checks retained.');
    }else if(data.type==='error'){finish();$('contact-validation-progress').textContent=data.message;}
  }
  $('contact-validation-run').onclick=()=>{
    if(job)return;
    const both=$('contact-validation-backend').value==='both',port=Number($('contact-validation-port').value);
    if(both&&(!Number.isInteger(port)||port<8765||port>8799)){$('contact-validation-progress').textContent=t('端口须为 8765–8799','Port must be 8765–8799');return;}
    $('contact-validation-run').disabled=true;$('contact-validation-cancel').disabled=false;
    $('contact-validation-progress').textContent=t('正在启动独立验证…','Starting independent validation…');
    try{
      if(both){
        const ws=job=new WebSocket(`ws://127.0.0.1:${port}/validation`);
        ws.onmessage=({data})=>{if(job!==ws)return;try{const m=JSON.parse(data);
          if(m.type==='ready'){
            if(m.feature!=='contact-validation/1')throw Error(t('需要 V11 项目服务','V11 project service required'));
            ws.send(JSON.stringify({type:'run',version:CONTACT_VALIDATION_VERSION}));
          }else message(m);
        }catch(e){message({type:'error',message:e.message});}};
        ws.onerror=()=>{if(job===ws)message({type:'error',message:t('无法连接验证服务，请核对新版项目服务端口。','Cannot connect. Check the updated project service port.')});};
        ws.onclose=()=>{if(job===ws)message({type:'error',message:t('验证连接已关闭；当前模型未改变。','Validation connection closed; current project unchanged.')});};
      }else{
        const worker=job=new Worker(new URL('./validation-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{if(job===worker)message(data);};
        worker.onerror=e=>message({type:'error',message:e.message});worker.postMessage({type:'run',kind:'contact'});
      }
    }catch(error){message({type:'error',message:error.message});}
  };
  $('contact-validation-cancel').onclick=()=>{finish();$('contact-validation-progress').textContent=t('验证已取消，保留上次完整报告。','Validation canceled; previous completed report retained.');};
  async function read(silent=false){
    try{const response=await fetch('/artifacts/contact-validation.json',{cache:'no-store'});if(!response.ok)throw Error(t('尚无保存的 GPU 对照报告。','No saved GPU comparison report.'));
      const value=await response.json();if(value.version!==CONTACT_VALIDATION_VERSION)throw Error(t('保存的报告版本不匹配。','Saved report version mismatch.'));
      if(!job){report=value;render();if(!silent)reveal('results','project-contact-validation-report');}
    }catch(error){if(!silent)$('contact-validation-progress').textContent=error.message;}
  }
  $('contact-validation-read').onclick=()=>read();
  $('contact-validation-json').onclick=()=>{if(report)download(JSON.stringify(report,null,2),'summer-contact-validation.json','application/json');};
  $('contact-validation-csv').onclick=()=>{if(report)download('\ufeff'+contactValidationCSV(report),'summer-contact-validation.csv','text/csv;charset=utf-8');};
  window.addEventListener('workbench-languagechange',render);read(true);
  return {refresh(){
    if(!job){$('contact-validation-backend').value=getProject().solver.adapter==='taichi-coupled'?'both':'cpu';$('contact-validation-port').value=getProject().solver.gpuPort??8776;}render();
  },display(frame){
    const c=frame.clock;
    $('physics-clock-readout').textContent=c?`${t('统一物理时钟','Unified physics clock')}\n${t('基准步长 / 已完成子步','Base step / completed steps')} ${fmt(c.baseDt)} s / ${c.steps}\n${t('实际步长','Actual step')} ${fmt(c.minDt)}–${fmt(c.maxDt)} s\n${t('指定端点截步 / 载荷节点截步','Requested endpoint / load event cuts')} ${c.requestCuts} / ${c.eventCuts}`:t('旧回放未记录物理时钟。','Older replay has no physics clock record.');
  }};
}
