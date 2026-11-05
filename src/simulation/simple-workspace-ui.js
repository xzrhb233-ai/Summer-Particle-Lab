import {buildWorkspaceContext,summaryTokens,configurationId} from './workspace-context.js';
import {projectDevice,recommendedStep,prepareSimpleSettings} from './simple-settings.js';

const $=id=>document.getElementById(id);
const english=()=>document.documentElement.lang==='en';
const text=(zh,en)=>english()?en:zh;

// Rehome live nodes: keep existing event handlers, solver adapters and old links.
export function simplifyWorkspace(sections){
  document.body.classList.add('simple-workspace');
  sections.get('geometry').append(...sections.get('parts').children);
  sections.get('parts').remove();sections.delete('parts');
  const setup=sections.get('setup');setup.removeAttribute('aria-labelledby');setup.removeAttribute('role');
  const dialog=document.createElement('dialog');dialog.id='project-menu';
  dialog.innerHTML='<div class="display-heading"><h2>项目与算例</h2><form method="dialog"><button aria-label="关闭项目菜单">×</button></form></div>';
  dialog.append(setup);document.body.append(dialog);
  const button=document.createElement('button');button.id='project-menu-open';button.textContent='项目';button.onclick=()=>{setup.hidden=false;dialog.showModal();};
  document.querySelector('header').append(button);
  dialog.addEventListener('close',()=>button.focus());
  sections.get('solver').append($('project-compute-panel'));
  const energyLabel=$('mixed-energy-diagnostics').closest('label'),energyHelp=energyLabel.nextElementSibling;
  $('mixed-device-settings').after(energyLabel,energyHelp);
  const keep=new Set(['unified-parts','project-domain-panel','grid-coordinates-panel','project-initial-panel','unified-coupling','project-gravity-panel','project-contact-pairs','project-thermal-loads','fem-boundary','project-run-panel','fem-results','mbd-results-panel','project-contact-results','project-thermal-results']);
  for(const [key,section] of sections){
    if(key==='setup')continue;
    const toggle=document.createElement('button');toggle.className='simple-advanced-toggle';toggle.type='button';toggle.setAttribute('aria-expanded','false');toggle.textContent='显示高级设置';
    toggle.onclick=()=>{const on=section.classList.toggle('simple-expanded');toggle.setAttribute('aria-expanded',String(on));toggle.textContent=on?text('收起高级设置','Hide advanced settings'):text('显示高级设置','Show advanced settings');if(key==='geometry'){$('unified-advanced').checked=on;$('unified-advanced').dispatchEvent(new Event('change'));}};
    section.prepend(toggle);
    for(const child of section.children)if(child!==toggle&&!keep.has(child.id))child.dataset.simpleAdvanced='true';
  }
  // Raw project editing remains available in the project menu.
  $('unified-start').querySelector('summary').textContent='新建项目与示例';
  $('unified-start-modeling').addEventListener('click',()=>dialog.close());
  $('unified-start-coupling').addEventListener('click',()=>dialog.close());
  for(const id of ['unified-empty','unified-demo','unified-contact-demo','unified-gpu-demo'])$(id).addEventListener('click',()=>dialog.close());
  const aside=document.querySelector('aside'),summary=document.createElement('section');summary.id='workspace-summary';summary.dataset.userContent='';
  summary.innerHTML='<div class="context-heading"><strong id="context-title">当前设置摘要</strong><button id="context-copy" type="button">复制模拟上下文</button></div><p id="context-description" aria-live="polite"></p><p id="context-feedback" role="status"></p>';
  aside.append(summary);
  const jsonDialog=document.createElement('dialog');jsonDialog.id='context-dialog';jsonDialog.innerHTML='<div class="display-heading"><h2>模拟上下文 JSON</h2><form method="dialog"><button aria-label="关闭上下文">×</button></form></div><p>只读快照，包含已应用项目、待应用输入及结果来源。此快照只读；请通过顶部“AI 助手”的受限命令操作项目。</p><textarea id="context-json" readonly aria-label="模拟上下文 JSON"></textarea>';
  document.body.append(jsonDialog);
  const actions=document.createElement('div');actions.className='model-project-actions';
  actions.innerHTML='<button id="model-new-project" type="button">新建空白模拟</button><button id="model-undo-remove" type="button" disabled>撤销删除 / 新建</button>';
  const notice=document.createElement('p');notice.id='model-editing-status';notice.className='hint';notice.setAttribute('role','status');notice.hidden=true;
  $('unified-parts').before(actions,notice);
  $('unified-edit').after($('unified-remove'));
  const partTree=document.createElement('section');partTree.id='simple-part-tree';partTree.dataset.userContent='';partTree.innerHTML='<strong>项目部件</strong><div id="simple-part-items"></div>';
  return {dialog,partTree};
}

export function wireSimpleWorkspace({getState,load,guard,editPart}){
  const initial=$('run-window-title').parentElement;
  initial.insertAdjacentHTML('afterbegin','<label for="simple-device">计算设备</label><select id="simple-device"><option value="cpu">CPU</option><option value="gpu">GPU</option></select><p id="simple-device-status" class="hint" role="status"></p>');
  $('run-dt').before(Object.assign(document.createElement('label'),{htmlFor:'simple-step-mode',textContent:'时间步'}));
  const mode=document.createElement('select');mode.id='simple-step-mode';mode.innerHTML='<option value="auto">自动 · 推荐上限</option><option value="custom">自定义最大时间步</option>';$('run-dt').before(mode);
  mode.after(document.querySelector('label[for="run-dt"]'));
  const advanced=document.createElement('details');advanced.id='simple-solver-advanced';advanced.innerHTML='<summary>高级设置与连接</summary><label for="simple-port">本地 GPU 服务端口</label><input id="simple-port" type="number" min="8765" max="8799"><p class="hint">按模型自动选择现有后端；GPU 服务需已启动。不支持的配置会明确报错。</p>';
  const couplingPanel=$('run-coupling-panel');couplingPanel.open=false;advanced.append(couplingPanel);
  initial.append(advanced);
  advanced.append($('run-help'));
  $('run-details-title').parentElement.append($('run-step-status'),$('run-speed'));
  let appliedId='',chapter=location.hash.slice(1)||'geometry',context=null,uiError='';
  const dirty=new Map(),baselines=new Map();
  const value=e=>e.type==='checkbox'?e.checked:e.value;
  const editorRoot=e=>e.closest('#unified-parts,#project-initial-panel,#project-contact-pairs,#project-thermal-loads,#project-domain-panel,#project-gravity-panel,#fem-boundary,#mixed-thermal-material');
  function remember(){for(const e of document.querySelectorAll('#controls input,#controls select,#controls textarea'))baselines.set(e,value(e));}
  function rememberEditor(root){if(!root)return;for(const e of root.querySelectorAll('input,select,textarea')){dirty.delete(e);baselines.set(e,value(e));}}
  function read(){const state=getState(),p=state.project;return {device:$('simple-device').value,timeStepMode:mode.value,dt:Number($('run-dt').value),duration:Number($('run-target').value),port:Number($('simple-port').value),couplingMode:$('run-coupling-mode').value,pbdIterations:Number($('run-pbd-iterations').value)};}
  function pending(d,p){const a=[];if(d.device!==projectDevice(p))a.push(text('计算设备','device'));if(d.dt!==p.solver.dt||d.timeStepMode!==(p.solver.timeStepMode??'custom'))a.push(text('时间步','time step'));if(d.couplingMode!==(p.solver.couplingMode??'native')||(d.couplingMode==='unified-pbd'&&d.pbdIterations!==(p.solver.pbdIterations??6)))a.push(text('耦合方式','coupling'));if(d.device==='gpu'&&d.port!==(p.solver.adapter==='cpu-fem-mpm'?p.solver.mixedGpuPort??8796:p.solver.gpuPort??8769))a.push(text('GPU 连接','GPU connection'));return a;}
  function update(){
    const state=getState();if(!state.project)return;
    const p=state.project,id=configurationId(p);
    if(id!==appliedId){appliedId=id;dirty.clear();$('simple-device').value=projectDevice(p);mode.value=p.solver.timeStepMode??'custom';$('simple-port').value=p.solver.adapter==='cpu-fem-mpm'?p.solver.mixedGpuPort??8796:p.solver.gpuPort??8769;remember();}
    const d=read(),wait=pending(d,p),busy=state.running||state.pending;
    for(const id of ['simple-device','simple-step-mode','simple-port'])$(id).disabled=!!busy;
    $('run-dt').hidden=mode.value==='auto';document.querySelector('label[for="run-dt"]').hidden=mode.value==='auto';
    $('run-apply-dt').textContent=text('应用设置并重新开始','Apply settings & restart');
    $('run-help').textContent=text('自动使用推荐步长上限，求解器仍按稳定性和接触情况缩步。设备与步长修改后统一应用；已有结果会重置。','Automatic uses a recommended cap; stability and contact can reduce it. Apply device and step changes together; existing results are reset.');
    const resultProject=state.resultProject??p;
    const editorDraft=Object.fromEntries([...dirty].map(([e,section])=>[e.id,{section,value:value(e)}]));
    const sectionNames={geometry:text('模型输入','model input'),loads:text('物理条件输入','physics input')};
    const visiblePending=[...wait,...new Set([...dirty.values()].map(s=>sectionNames[s]??s))];
    context=buildWorkspaceContext({...state,error:uiError||state.error,resultProject,selectedPartId:$('unified-edit').value,draft:{solver:d,editors:editorDraft},pending:visiblePending});
    const description=$('context-description'),tokens=summaryTokens(context,chapter,english());
    const signature=JSON.stringify(tokens);if(description.dataset.signature!==signature){description.replaceChildren(...tokens.map(x=>{const el=document.createElement(x.tone?'strong':'span');el.textContent=x.text;if(x.tone)el.className='context-'+x.tone;return el;}));description.dataset.signature=signature;}
    $('context-title').textContent=text('当前设置摘要','Current settings');$('context-copy').textContent=text('复制模拟上下文','Copy simulation context');
    $('simple-part-tree').querySelector('strong').textContent=text('项目部件','Project parts');
    const advancedToggle=$('chapter-geometry').querySelector('.simple-advanced-toggle'),expanded=$('chapter-geometry').classList.contains('simple-expanded');
    advancedToggle.setAttribute('aria-expanded',String(expanded));advancedToggle.textContent=expanded?text('收起高级设置','Hide advanced settings'):text('显示高级设置','Show advanced settings');
    $('simple-device-status').textContent=state.loading?text('正在连接并校验配置…','Connecting and validating…'):text('已应用：','Applied: ')+context.solver.requestedDevice.toUpperCase()+text(' · 实际：',' · Actual: ')+(context.solver.confirmedDevice==='unconfirmed'?text('尚未确认','unconfirmed'):context.solver.confirmedDevice.toUpperCase());
    $('run-start').disabled=!!busy||visiblePending.length>0||!!state.frame?.preview||!p.parts.length;
    $('model-new-project').textContent=text('新建空白模拟','New blank simulation');$('model-undo-remove').textContent=text('撤销删除 / 新建','Undo delete / new');
    const root=$('simple-part-items');
    if(root&&root.dataset.configuration!==id){root.dataset.configuration=id;root.replaceChildren(...p.parts.map(b=>{const row=document.createElement('div');row.className='simple-part-row';const btn=document.createElement('button');btn.type='button';btn.textContent=b.name+' · '+b.method.toUpperCase();btn.dataset.partId=b.id;btn.onclick=()=>{editPart(b.id);rememberEditor($('unified-parts'));update();};const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.className='part-delete';remove.setAttribute('aria-label',text('删除部件：','Delete part: ')+b.name);remove.onclick=()=>{editPart(b.id);$('unified-remove').click();};row.append(btn,remove);return row;}));if(!p.parts.length)root.textContent=text('暂无部件，请在模型中添加。','No parts. Add one in Model.');}
  }
  $('model-new-project').onclick=()=>{$('unified-empty').click();};
  function changed(){uiError='';if(mode.value==='auto')$('run-dt').value=recommendedStep(getState().project);update();}
  $('simple-device').onchange=()=>{const p=getState().project;if($('simple-device').value==='gpu'&&projectDevice(p)!=='gpu')$('simple-port').value=p.solver.adapter==='cpu-fem-mpm'?p.solver.mixedGpuPort??8796:p.solver.gpuPort??8769;changed();};
  mode.onchange=changed;$('simple-port').oninput=update;
  $('run-apply-dt').onclick=guard(async()=>{try{uiError='';const state=getState();if(state.running||state.pending)throw Error('请先暂停并等待当前批次结束');if(dirty.size)throw Error('请先应用模型或物理条件中的待修改输入，再应用求解设置。');const p=prepareSimpleSettings(state.project,read());await load(p);update();}catch(e){uiError=e.message;update();throw e;}});
  $('context-copy').onclick=async()=>{update();const json=JSON.stringify(context,null,2);try{await navigator.clipboard.writeText(json);$('context-feedback').textContent=text('已复制结构化上下文。','Structured context copied.');}catch{$('context-json').value=json;$('context-dialog').showModal();$('context-json').select();$('context-feedback').textContent=text('剪贴板不可用，可在弹窗中手动复制。','Clipboard unavailable; copy from the dialog.');}};
  document.addEventListener('input',e=>{uiError='';const root=editorRoot(e.target);if(!root||!e.target.id){update();return;}const section=root.closest('.archive-chapter')?.id.replace('chapter-','');if(baselines.get(e.target)===value(e.target))dirty.delete(e.target);else dirty.set(e.target,section);update();});
  document.addEventListener('change',e=>{if(['unified-edit','project-part-select','pair-edit','mixed-material-part'].includes(e.target.id)){rememberEditor(editorRoot(e.target));update();}else if(editorRoot(e.target)&&!e.target.matches('button')&&e.target.id!=='unified-advanced'){if(baselines.get(e.target)===value(e.target))dirty.delete(e.target);else dirty.set(e.target,editorRoot(e.target).closest('.archive-chapter')?.id.replace('chapter-',''));update();}});
  $('unified-methods').addEventListener('click',()=>{rememberEditor($('unified-parts'));update();});
  window.addEventListener('workbench-chapter',e=>{chapter=e.detail;update();});
  window.addEventListener('workbench-languagechange',update);
  window.addEventListener('workbench-study',()=>{$('workspace-summary').hidden=$('study-kind').value!=='project';$('simple-part-tree').hidden=$('study-kind').value!=='project';});
  return {update,reset(){appliedId='';uiError='';dirty.clear();remember();update();},assertApplied(){if(pending(read(),getState().project).length)throw Error('求解设置尚未应用，请点击“应用设置并重新开始”。');if(dirty.size)throw Error('模型或物理条件中有待应用的输入，请先应用后再运行。');}};
}
