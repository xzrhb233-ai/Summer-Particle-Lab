import {parseAssistantResponse,prepareAssistantPlan,executePlan,assistantErrorDiagnostics} from './assistant-commands.js';
import {projectDevice} from './simple-settings.js';
import {buildAssistantContext} from './assistant-context.js';
import {buildCAD,buildCurve,buildMesh,buildSurface} from './cad-client.js';
import {meshToVTK,meshToOBJ} from '../three/cad-tools.js';
import {surfaceToOBJ,surfaceToVTK} from '../three/cad-surfaces.js';
import {mountCADPreview} from './cad-preview.js';
import {domainParameters,geometryParameters,geometryPoints} from '../three/discretization.js';

const $=id=>document.getElementById(id);
const diagnosticsFeedback=error=>'\n结构化诊断：'+JSON.stringify(assistantErrorDiagnostics(error));
const parameterValue=(value,unit)=>value===null?'新增':`${Number(value.toPrecision(7))}${unit?' '+unit:''}`;
export function wireAssistant(host){
  const aside=document.querySelector('aside'),panel=document.createElement('section');
  panel.id='ai-panel';panel.hidden=true;panel.setAttribute('aria-label','AI 建模与模拟助手');panel.dataset.userContent='';
  panel.innerHTML=`<div class="ai-heading"><strong>AI 建模与模拟</strong><button id="ai-close" aria-label="关闭 AI 助手">×</button></div>
    <p class="ai-scope">项目操作权限 · 无程序修改权限</p>
    <details id="ai-settings" open><summary>API 连接设置</summary><fieldset id="ai-config">
      <label for="ai-provider">API 类型</label><select id="ai-provider"><option value="openai">OpenAI</option><option value="compatible">兼容 Chat Completions 的 API</option><option value="ollama">本机 Ollama</option><option value="lmstudio">本机 LM Studio</option></select>
      <label for="ai-base">API 基础地址（含 /v1 等路径）</label><input id="ai-base" type="url" value="https://api.openai.com/v1" autocomplete="off" spellcheck="false">
      <label for="ai-model">模型 ID</label><input id="ai-model" placeholder="填写服务提供商的模型 ID" autocomplete="off" spellcheck="false">
      <label for="ai-key">API Key（仅本页内存）</label><input id="ai-key" type="password" autocomplete="off" placeholder="本机无鉴权服务可留空">
      <button id="ai-forget" type="button">清除 Key</button>
      <p>发送时会将当前项目配置、状态摘要和本段对话发送到以下服务。Key 不保存到项目、浏览器存储或日志；更换地址会清除 Key。</p>
    </fieldset></details>
    <p id="ai-destination"></p><p id="ai-live" role="status"></p>
    <div id="ai-messages" role="log" aria-label="AI 对话记录" aria-live="polite"></div>
    <section id="ai-proposal" hidden><strong>待执行操作</strong><p>修改模型或设置会重置模拟及结果。</p>
      <section id="ai-cad-preview" hidden aria-label="AI CAD 待应用预览"><strong>几何与网格预览 · 尚未应用</strong><label for="ai-cad-part">预览对象</label><select id="ai-cad-part"></select><canvas id="ai-cad-canvas" aria-label="AI 生成的 SMLib 几何；拖动旋转，滚轮缩放"></canvas><p id="ai-cad-summary"></p><div class="buttons"><button id="ai-geometry-export" hidden>导出</button><button id="ai-mesh-obj" hidden>导出表面 OBJ</button></div><p>拖动旋转，滚轮缩放。几何操作始终先预览，再由你点击应用。单独生成网格只用于预览和导出，不修改部件。</p></section>
      <p id="ai-change-summary"></p><section id="ai-parameter-changes" hidden aria-label="待应用参数变化"></section><details><summary>查看结构化命令</summary><pre id="ai-plan"></pre></details><div class="buttons"><button id="ai-apply">应用这些操作</button><button id="ai-discard">放弃</button></div></section>
    <details id="ai-modeling-help"><summary>CAD 建模能力与示例</summary><p>实体：长方体、球、圆柱的并集、差集和交集，最多 8 步。曲线：直线、圆、圆弧、Bezier、B 样条。曲面：四角面、双三次 Bézier、B 样条，支持控制网编辑。网格：表面三角形、保留孔洞的 Tet4 四面体。可创建 CPU MPM / PBF / FEM 部件；曲线和自由曲面目前是参考几何。GPU CAD、复杂刚体、圆角和曲线拉伸暂未接入。</p><div class="buttons"><button id="ai-example-hole" type="button">打孔块指令</button><button id="ai-example-pipe" type="button">空心管指令</button><button id="ai-example-edit" type="button">编辑已有 CAD</button><button id="ai-example-curve" type="button">曲线指令</button><button id="ai-example-mesh" type="button">FEM 网格指令</button><button id="ai-example-surface" type="button">自由曲面指令</button></div><p>示例只填写指令，不会发送。可以先在 CAD 面板调整步骤，再点击“让 AI 编辑这些步骤”。</p></details>
    <p id="ai-cad-context" hidden></p>
    <div class="ai-compose"><label for="ai-prompt">给助手的指令</label><textarea id="ai-prompt" rows="3" maxlength="4000" placeholder="例如：在 (0,1,0) 创建一个边长 0.3 m 的 MPM 方块，使用默认材料，先不要运行。"></textarea>
    <label class="check"><input id="ai-auto" type="checkbox">自动执行通过校验的操作</label>
    <div class="buttons"><button id="ai-send">发送</button><button id="ai-cancel" disabled>取消请求</button></div>
    <div class="buttons"><button id="ai-view-cad" disabled>查看已应用 CAD 步骤</button></div>
    <div class="buttons"><button id="ai-undo" disabled>撤销上次 AI 修改</button><button id="ai-clear">清空对话</button></div>
    <p id="ai-feedback" role="status"></p></div>`;
  aside.append(panel);
  const open=document.createElement('button');open.id='ai-open';open.textContent='AI 助手';open.setAttribute('aria-expanded','false');document.querySelector('header').append(open);
  let messages=[],proposal=null,undo=null,busy=false,controller=null,cadView=null,attachedDraft=null,lastCAD=null;
  function show(on){panel.hidden=!on;aside.classList.toggle('ai-open',on);open.setAttribute('aria-expanded',String(on));if(on){if(document.body.classList.contains('inspector-hidden')||aside.classList.contains('collapsed'))$('collapse').click();if(!$('ai-model').value){$('ai-model').focus({preventScroll:true});panel.scrollTop=0;}else $('ai-prompt').focus();update();}}
  open.onclick=()=>show(panel.hidden);$('ai-close').onclick=()=>show(false);
  document.addEventListener('click',e=>{if(!panel.hidden&&e.target.closest('[role="tab"],#simple-part-items button'))show(false);});
  window.addEventListener('workbench-study',()=>{open.hidden=$('study-kind').value!=='project';if(open.hidden)show(false);});
  function say(label,content,kind='assistant'){
    const item=document.createElement('div');item.className='ai-message ai-'+kind;
    const title=document.createElement('strong');title.textContent=label;const text=document.createElement('p');text.textContent=content;item.append(title,text);$('ai-messages').append(item);
    while($('ai-messages').children.length>40)$('ai-messages').firstElementChild.remove();
    item.scrollIntoView({block:'nearest'});
  }
  function feedback(value,error=false){$('ai-feedback').textContent=value;$('ai-feedback').classList.toggle('ai-error',error);}
  function destination(){let address;try{address=new URL($('ai-base').value).origin;}catch{address='地址无效';}$('ai-destination').textContent='数据目的地：'+address+' · '+($('ai-model').value.trim()||'尚未填写模型');}
  function clearProposal(){proposal=null;$('ai-proposal').hidden=true;$('ai-cad-preview').hidden=true;cadView?.clear();}
  function lock(value){busy=value;$('ai-config').disabled=value;for(const id of ['ai-send','ai-clear','ai-apply','ai-discard','ai-auto'])$(id).disabled=value;$('ai-cancel').disabled=!controller;$('ai-undo').disabled=value||!undo;}
  $('ai-provider').onchange=()=>{const bases={openai:'https://api.openai.com/v1',compatible:'',ollama:'http://127.0.0.1:11434/v1',lmstudio:'http://127.0.0.1:1234/v1'};$('ai-base').value=bases[$('ai-provider').value];$('ai-model').value='';$('ai-key').value='';clearProposal();destination();};
  $('ai-base').oninput=()=>{$('ai-key').value='';clearProposal();destination();};$('ai-model').oninput=destination;
  $('ai-forget').onclick=()=>{$('ai-key').value='';feedback('API Key 已从当前页面清除。');};
  $('ai-discard').onclick=()=>{clearProposal();feedback('已放弃，项目未更改。');};
  $('ai-cancel').onclick=()=>controller?.abort();
  $('ai-clear').onclick=()=>{messages=[];$('ai-messages').replaceChildren();clearProposal();feedback('对话已清空；模型保持不变。');};
  const example=prompt=>{if(busy)return;$('ai-prompt').value=prompt;show(true);};
  $('ai-example-hole').onclick=()=>example('保留当前部件，用 SMLib 创建一个打孔块：长方体尺寸 0.6×0.3×0.5 m，沿 Y 轴贯穿孔直径 0.2 m。使用 CPU MPM，共旋转弹性，密度1000 kg/m³，20°C。请根据当前域和部件选择不相交的位置并说明；先预览，不要运行。若没有空间，请先说明。');
  $('ai-example-pipe').onclick=()=>example('保留当前部件，用 SMLib 建立一根 Y 轴空心管：外径0.5 m，内径0.3 m，高0.4 m，差集内圆柱应略长于外圆柱。CPU MPM，默认材料。根据当前域选择不相交的位置；先预览，不要运行。');
  $('ai-example-edit').onclick=()=>example('请读取当前选中的 CAD 部件，说明其建模步骤和尺寸，给出能继续修改的参数，先不要更改或运行。若当前选中不是 CAD 部件，请列出现有 CAD 部件。');
  $('ai-example-curve').onclick=()=>example('创建一条 Bezier 参考曲线：控制点为 (-0.4,0.7,0)、(-0.2,1.1,0)、(0.2,0.3,0)、(0.4,0.7,0)，单位 m，采样64段。保留现有部件，先预览，不运行。');
  $('ai-example-mesh').onclick=()=>example('请先列出当前 CAD 部件；为我指定的实体生成目标尺寸0.15 m的四面体网格预览，报告节点、单元和质量。只预览，不创建重复部件、不启动模拟。');
  window.addEventListener('cad-assistant-request',e=>{
    if(busy){feedback('正在处理请求，请结束后再发送 CAD 草稿。',true);return;}
    attachedDraft=buildAssistantContext(host.getProject(),{},e.detail).cadDraft;
    $('ai-cad-context').hidden=false;$('ai-cad-context').textContent=`已附上 CAD 草稿：${attachedDraft?.name||'未命名'} · ${attachedDraft?.recipe?.length??0} 步。发送时会读取 CAD 面板的最新已保存步骤。`;
    example('请根据附带的 CAD 草稿继续建模。保留其他部件，先说明这份草稿的步骤，等待我描述需要修改的尺寸或结构。不要运行模拟。');
  });
  window.addEventListener('cad-curve-assistant-request',e=>{
    if(busy){feedback('正在处理请求，请结束后再发送曲线草稿。',true);return;}
    attachedDraft=host.getCADContext?.()??{curveDraft:e.detail};
    $('ai-cad-context').hidden=false;$('ai-cad-context').textContent=`已附上曲线草稿：${e.detail.name}。发送时读取面板中的最新参数。`;
    example('请读取附带的曲线草稿，说明曲线类型和控制点，等待我描述修改要求。保留现有实体，不启动模拟。');
  });
  $('ai-example-surface').onclick=()=>example('创建一个双三次 Bézier 马鞍参考曲面，X/Z范围为±0.6m，中心Y=0.7m，起伏0.2m，4×4控制网，U/V各24段。保留其他几何，先预览，不运行。');
  window.addEventListener('cad-surface-assistant-request',e=>{
    if(busy){feedback('正在处理请求，请结束后再发送曲面草稿。',true);return;}
    attachedDraft=host.getCADContext?.()??{surfaceDraft:e.detail};
    $('ai-cad-context').hidden=false;$('ai-cad-context').textContent='已附上曲面草稿：'+e.detail.name+'。发送时读取面板中的最新控制点。';
    example('请读取附带的曲面草稿，说明控制网和形状，等待我描述修改要求。保留现有部件，不启动模拟。');
  });
  window.addEventListener('cad-parametric-assistant-request',e=>{
    if(busy){feedback('正在处理请求，请结束后再发送参数化草稿。',true);return;}
    attachedDraft={...(host.getCADContext?.()??{}),parametricDraft:e.detail};
    const safe=buildAssistantContext(host.getProject(),{},attachedDraft).cadDraft?.parametricDraft;
    $('ai-cad-context').hidden=false;$('ai-cad-context').textContent='已附上参数化草稿：'+(safe?.name??'未命名')+'。发送时读取面板中的最新参数。';
    example(safe?.sourcePartId?'请读取当前参数化部件及草稿，说明可编辑的尺寸参数。等待我描述要改的尺寸；请保留部件ID、位置、材料、载荷和接触，先预览，不运行。':'请读取这份参数化草稿并说明尺寸，等待我描述修改要求。保留其他部件，先预览，不运行。');
  });
  const geometryPreviews=plan=>[
    ...(plan?.cadPreviews??[]).map(p=>({...p,kind:'cad'})),
    ...(plan?.curvePreviews??[]).map(p=>({...p,kind:'curve'})),
    ...(plan?.meshPreviews??[]).map(p=>({...p,kind:'mesh'})),
    ...(plan?.surfacePreviews??[]).map(p=>({...p,kind:'surface'}))
  ];
  const selectedPreview=()=>geometryPreviews(proposal)[Number($('ai-cad-part').value)];
  function displayCAD(){
    const item=selectedPreview();if(!item)return;
    cadView??=mountCADPreview($('ai-cad-canvas'));
    $('ai-geometry-export').hidden=item.kind==='cad';$('ai-mesh-obj').hidden=!['mesh','surface'].includes(item.kind);
    if(item.kind==='surface'){
      const s=item.surface;cadView.showSurface(s);$('ai-geometry-export').textContent='导出曲面 VTK';
      $('ai-cad-summary').textContent=`${item.name} · ${s.spec.kind} · SMLib\n${s.spec.controlPoints.length} × ${s.spec.controlPoints[0].length} 控制网 · U/V 次数 ${s.degreeU}/${s.degreeV}\n${s.nodes.length} 节点 · ${s.elements.length} 三角形\n离散面积 ${s.area.toPrecision(6)} m²（近似）\n开放参考曲面，尚不参与物理或 FEM 壳求解。`;return;
    }
    if(item.kind==='curve'){
      cadView.showCurve(item.curve);$('ai-geometry-export').textContent='导出曲线 JSON';
      $('ai-cad-summary').textContent=`${item.name} · ${item.curve.spec.kind} · SMLib\n长度 ${item.curve.length.toPrecision(6)} m · ${item.curve.points.length} 采样点 · ${item.curve.closed?'闭合':'开放'}曲线\n加入项目后作为参考几何显示，不参与受力或接触。`;return;
    }
    if(item.kind==='mesh'){
      const m=item.mesh;cadView.showMesh(m);$('ai-geometry-export').textContent='导出网格 VTK';
      $('ai-cad-summary').textContent=`${item.name} · ${m.kind==='volume'?'Tet4 体网格':'表面三角网格'}\n${m.nodes.length} 节点 · ${m.elements.length} 单元\n${m.kind==='volume'?`最小质量 ${m.quality.minMeanRatio.toPrecision(3)} · 最小高度 ${m.quality.minAltitude.toPrecision(3)} m\n离散体积误差 ${(100*m.volumeRelativeError).toFixed(3)}%\n`:''}原始 CAD 坐标；单独生成网格不会修改已有部件。`;return;
    }
    cadView.show(item.cad);
    const part=proposal.project.parts.find(p=>p.id===item.id),d=proposal.project.discretization.mpm;
    let sampling='';
    if(part&&part.method!=='fem'&&d){try{const domain=domainParameters({...d,lower:d.lower.map(x=>x/.025),upper:d.upper.map(x=>x/.025),cellSize:d.cellSize/.025});const geometry=geometryParameters({...part.geometry,center:part.geometry.center.map(x=>x/.025),size:part.geometry.size.map(x=>x/.025)},domain);sampling=`\n按当前网格采样 ${geometryPoints(geometry,16384).length} 粒子 · 间距 ${(d.cellSize/d.particlesPerAxis).toPrecision(3)} m`;}catch(e){sampling='\n离散提示：'+e.message;}}
    const c=item.cad,center=part?.modeling?part.geometry.center:c.lower.map((v,k)=>(v+c.upper[k])/2),size=c.upper.map((v,k)=>v-c.lower[k]);
    $('ai-cad-summary').textContent=`${item.name} · ${item.method.toUpperCase()} / CPU\n${c.recipe.length} 步 · 封闭实体 · ${c.volume.toPrecision(6)} m³ · ${c.indices.length/3} 三角形\n${part?.modeling?'实际部件中心':'中心'} ${center.map(v=>Number(v.toPrecision(5))).join(', ')} m\n尺寸 ${size.map(v=>Number(v.toPrecision(5))).join(' × ')} m${part?.modeling?'\n模板局部几何预览；实际整体旋转 '+part.geometry.rotation.join(', ')+'°':''}${sampling}\n孔和薄壁建议至少跨越 3 个粒子间距。`;
  }
  $('ai-cad-part').onchange=displayCAD;
  function downloadPreview(obj=false){
    const item=selectedPreview();if(!item)return;
    try{
      const content=item.kind==='curve'?JSON.stringify(item.curve,null,2):item.kind==='surface'?(obj?surfaceToOBJ(item.surface):surfaceToVTK(item.surface)):obj?meshToOBJ(item.mesh):meshToVTK(item.mesh);
      const ext=item.kind==='curve'?'json':obj?'obj':'vtk',url=URL.createObjectURL(new Blob([content],{type:'text/plain'})),a=document.createElement('a');
      a.href=url;a.download=`summer-${item.kind}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){feedback(e.message,true);}
  }
  $('ai-geometry-export').onclick=()=>downloadPreview();$('ai-mesh-obj').onclick=()=>downloadPreview(true);
  $('ai-view-cad').onclick=()=>{if(busy||!lastCAD)return;if(!host.getProject().parts.some(p=>p.id===lastCAD&&p.geometry.shape==='cad')){feedback('该 CAD 部件已不存在。',true);return;}show(false);host.editCAD?.(lastCAD);};
  function displayPlan(plan){
    proposal=plan;$('ai-plan').textContent=JSON.stringify(plan.commands,null,2);$('ai-proposal').hidden=false;
    const changes=$('ai-parameter-changes');changes.replaceChildren();changes.hidden=!plan.parameterChanges?.length;
    for(const group of plan.parameterChanges??[]){
      const heading=document.createElement('strong');heading.textContent=group.name+' · 参数变化';changes.append(heading);
      if(!group.changes.length){const note=document.createElement('p');note.textContent='尺寸参数保持不变。';changes.append(note);continue;}
      const table=document.createElement('table'),head=document.createElement('tr');
      for(const label of ['参数','修改前','修改后']){const cell=document.createElement('th');cell.scope='col';cell.textContent=label;head.append(cell);}const thead=document.createElement('thead');thead.append(head);table.append(thead);
      const body=document.createElement('tbody');for(const change of group.changes){
        const row=document.createElement('tr');for(const [value,style] of [[change.label,''],[parameterValue(change.before,change.unit),'ai-param-before'],[parameterValue(change.after,change.unit),'ai-param-after']]){const cell=document.createElement('td');cell.textContent=value;if(style)cell.className=style;row.append(cell);}body.append(row);
      }table.append(body);changes.append(table);
    }
    const previous=JSON.parse(plan.before),created=plan.project.parts.filter(p=>!previous.parts.some(b=>b.id===p.id)),deleted=previous.parts.filter(p=>!plan.project.parts.some(b=>b.id===p.id));
    $('ai-change-summary').textContent=plan.changed?`项目 ${previous.parts.length} → ${plan.project.parts.length} 个部件；参考曲线 ${previous.cadCurves?.length??0} → ${plan.project.cadCurves?.length??0} 条；参考曲面 ${previous.cadSurfaces?.length??0} → ${plan.project.cadSurfaces?.length??0} 个${created.length?'；新增：'+created.map(p=>p.name).join('、'):''}${deleted.length?'；删除：'+deleted.map(p=>p.name).join('、'):''}。设置尚未应用。`:'只读查询或模拟控制；模型设置不变。';
    if(plan.changed){
      const labels={selectionSets:'选择集',loads:'载荷与约束',curves:'时间曲线',loadBindings:'时间绑定'};
      for(const [key,label] of Object.entries(labels))if(JSON.stringify(previous[key])!==JSON.stringify(plan.project[key]))$('ai-change-summary').textContent+=` ${label} ${previous[key]?.length??0} → ${plan.project[key]?.length??0}；`;
      if(previous.solver.thermal!==plan.project.solver.thermal)$('ai-change-summary').textContent+=` 温度场 ${previous.solver.thermal?'开':'关'} → ${plan.project.solver.thermal?'开':'关'}。`;
    }
    const previews=geometryPreviews(plan);$('ai-cad-preview').hidden=!previews.length;
    if(previews.length){$('ai-cad-part').replaceChildren(...previews.map((p,i)=>new Option(p.name+' · '+({cad:'实体',curve:'曲线',mesh:'网格',surface:'曲面'}[p.kind]),String(i))));displayCAD();}
  }
  async function apply(){
    if(!proposal||busy)return;const plan=proposal;lock(true);clearProposal();
    const previous=JSON.parse(plan.before);
    try{
      const result=await executePlan(plan,host);
      if(result.committed)undo={before:previous,after:JSON.stringify(host.getProject())};
      if(result.committed&&plan.cadPreviews?.length){lastCAD=plan.cadPreviews.at(-1).id;$('ai-view-cad').disabled=false;}
      if(result.committed&&plan.commands.some(c=>c.command==='project.new')){const url=new URL(location.href);url.searchParams.set('scene','empty');url.searchParams.set('mbd','empty');url.searchParams.delete('replay');history.replaceState(null,'',url);}
      const state=host.getStatus();
      const inspect=plan.commands.some(c=>c.command==='project.inspect')?`\n当前部件：${host.getProject().parts.map(p=>`${p.name} [${p.id}] · ${p.method.toUpperCase()}`).join('；')||'无'}。\n模拟时间 ${Number(state.time??0).toFixed(5)} s。`:'';
      const cadNote=result.committed&&plan.cadPreviews?.length?'\n已应用 CAD：'+plan.cadPreviews.map(p=>p.name).join('、')+'。几何步骤随项目保存，可继续编辑或撤销。':'';
      const note=(result.committed?'项目修改已应用，旧结果已重置。':'')+(result.action?({run:'已提交运行；请查看实时进度。',pause:'已暂停；已提交的子步可能仍在结束。',step:'已完成一个求解步。',reset:'已重置模拟。'}[result.action]):'')+(!result.committed&&!result.action?'项目未修改。':'')+inspect+cadNote+(result.committed&&plan.surfacePreviews?.length?'\n参考曲面已保存到项目；不参与物理求解，可继续编辑或撤销。':'')+(result.committed&&plan.curvePreviews?.length?'\n参考曲线已保存到项目，可继续编辑或撤销。':'')+(state.preview?' 当前仅为建模预览，尚不能求解：'+state.reason:'')+(result.results?.length?'\n实测结果查询（null 表示未提供；请核对配置来源）：\n'+JSON.stringify(result.results,null,2):'');
      say('软件执行结果',note,'result');messages.push({role:'user',content:'软件执行反馈：'+note});feedback(note);
    }catch(e){
      if(e.committed)undo={before:previous,after:JSON.stringify(host.getProject())};
      const note=(e.committed?'项目修改已应用，但后续模拟操作失败，可撤销修改。':'未应用本轮操作。')+e.message;
      say('软件执行结果',note,'error');messages.push({role:'user',content:'软件执行反馈：'+note+diagnosticsFeedback(e)});feedback(note,true);
    }finally{lock(false);update();}
  }
  $('ai-apply').onclick=apply;
  $('ai-undo').onclick=async()=>{
    if(!undo||busy)return;lock(true);
    try{
      if(host.busy({action:'reset',changed:true}))throw Error('请先暂停并等待当前计算结束');host.assertApplied();
      if(JSON.stringify(host.getProject())!==undo.after)throw Error('项目已有其他修改，不能覆盖。请通过对话修改指定部件。');
      await host.load(undo.before);undo=null;clearProposal();say('软件执行结果','已撤销上次 AI 模型修改；模拟重新初始化，旧时程不恢复。','result');messages.push({role:'user',content:'软件执行反馈：用户已撤销上次 AI 模型修改。'});feedback('撤销完成。');
    }catch(e){feedback(e.message,true);}finally{lock(false);}
  };
  async function send(){
    if(busy)return;const prompt=$('ai-prompt').value.trim();if(!prompt)return;
    if(!$('ai-base').value.trim()||!$('ai-model').value.trim()){feedback('请先填写 API 基础地址和模型 ID。',true);$('ai-settings').open=true;return;}
    clearProposal();controller=new AbortController();lock(true);feedback('正在请求模型…');
    $('ai-settings').open=false;
    const project=structuredClone(host.getProject()),state=host.getStatus(),base=JSON.stringify(project),automatic=$('ai-auto').checked;
    messages.push({role:'user',content:prompt});say('你',prompt,'user');$('ai-prompt').value='';
    try{
      const options={method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({baseURL:$('ai-base').value.trim(),model:$('ai-model').value.trim(),key:$('ai-key').value.trim(),messages:messages.slice(-16).map(m=>({...m,content:m.content.slice(0,12000)})),context:buildAssistantContext(project,state,host.getCADContext?.()??attachedDraft)})};
      let response=await fetch('/api/ai/chat',options);
      // Existing static servers can remain online during this upgrade. New
      // npm start processes already include the same gateway on their origin.
      if(response.status===404)response=await fetch('http://127.0.0.1:5180/chat',options);
      const data=await response.json();if(!response.ok)throw Error(data.error||'AI 服务请求失败');
      const parsed=parseAssistantResponse(data.content);messages.push({role:'assistant',content:data.content});
      say('AI 建议 · 尚未执行',parsed.reply);
      if(parsed.commands.length){
        if(JSON.stringify(host.getProject())!==base)throw Error('请求期间项目发生改变，请重新发送指令');
        const hasCAD=parsed.commands.some(c=>c.command.startsWith('cad.'));
        if(hasCAD)feedback('命令已收到，SMLib 正在生成几何和网格…');
        const plan=await prepareAssistantPlan(project,parsed,{buildCAD,buildCurve,buildMesh,buildSurface,signal:controller.signal});
        if(controller.signal.aborted)throw new DOMException('已取消','AbortError');
        if(JSON.stringify(host.getProject())!==base)throw Error('预览期间项目发生改变，请重新发送指令');
        displayPlan(plan);feedback(hasCAD?'SMLib 几何与离散校验通过；检查预览后点击应用。':'白名单校验通过；等待应用。');
      }else feedback('已收到回复，没有项目操作。');
    }catch(e){clearProposal();const message=e.name==='AbortError'?'请求已取消，未执行操作。':e instanceof TypeError?'无法连接 AI 或 CAD 本地服务，请检查 Summer Lab 服务是否启动。':e.message;feedback(message,true);say('软件提示',message,'error');messages.push({role:'user',content:'软件校验反馈（未执行）：'+message+diagnosticsFeedback(e)});}
    finally{controller=null;lock(false);}
    if(proposal&&(!proposal.changed&&!proposal.action||automatic&&!geometryPreviews(proposal).length))await apply();
  }
  $('ai-send').onclick=send;
  $('ai-prompt').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
  function update(){if(panel.hidden)return;const s=host.getStatus(),p=host.getProject();$('ai-live').textContent=`${s.running?'运行中':s.pending?'计算中':s.preview?'建模预览':'已暂停'} · ${projectDevice(p).toUpperCase()} · t=${Number(s.time??0).toFixed(5)} s / ${s.target??p.solver.duration??'—'} s · ${p.parts.length} 个部件`+(s.error?' · '+s.error:'');}
  destination();say('助手使用说明','可以通过自然语言创建、修改或删除部件，设置材料和求解参数。SMLib 支持实体、五类参考曲线、自由曲面和表面网格，可生成保留孔洞的四面体网格并创建 CPU FEM 部件。几何操作先预览后应用。可以把 CAD 面板的步骤发给助手继续编辑；应用后可撤销。助手没有修改软件、访问文件或执行脚本的权限。');
  return {update};
}
