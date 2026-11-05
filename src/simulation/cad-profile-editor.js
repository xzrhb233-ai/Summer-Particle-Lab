import {validateCADProfile} from '../three/cad-profiles.js';

const defaults=shape=>shape==='revolve'?[[.2,-.3],[.4,-.3],[.4,.3],[.2,.3]]:[[-.4,-.3],[.4,-.3],[.4,.3],[-.4,.3]];
const isProfile=shape=>shape==='extrude'||shape==='revolve';

// Editing is a draft only. The parent saves/validates the full CSG recipe before
// any native request; pending JSON must never silently reuse the old polygon.
export function wireCADProfileEditor({parent,onChange}){
  const section=document.createElement('section');section.id='cad-profile-editor';section.hidden=true;
  section.innerHTML=`<p id="cad-profile-help" class="hint"></p>
    <svg id="cad-profile-plot" viewBox="0 0 320 190" role="img" aria-label="闭合轮廓二维预览"></svg>
    <p class="hint">按顺序连接各点，末点自动闭合；支持 3–32 个点。＋ 在当前点后插入中点，− 删除该点。</p>
    <div class="cad-profile-table-wrap"><table class="cad-profile-table"><thead><tr><th>点</th><th id="cad-profile-axis">X（m）</th><th>Y（m）</th><th>操作</th></tr></thead><tbody id="cad-profile-rows"></tbody></table></div>
    <p id="cad-profile-status" class="hint" role="status" aria-live="polite"></p>
    <div id="cad-depth-field"><label for="cad-depth">拉伸深度（m）</label><input id="cad-depth" type="number" value="0.25" min="0.01" max="12" step="0.01"></div>
    <div id="cad-angle-field"><label for="cad-revolve-angle">旋转角度（°）</label><input id="cad-revolve-angle" type="number" value="360" min="1" max="360" step="1"></div>
    <details><summary>批量编辑轮廓坐标</summary><p class="hint">二维坐标 JSON 数组，例如 [[0,0],[0.8,0],[0.8,0.5],[0,0.5]]。不重复填写首点。</p><textarea id="cad-profile-json" rows="5" aria-label="轮廓坐标 JSON" spellcheck="false"></textarea><div class="buttons"><button id="cad-profile-apply">应用坐标文本</button><button id="cad-profile-revert">恢复表格坐标</button></div></details>`;
  parent.append(section);
  const $=id=>section.querySelector('#'+id);
  let shape='box',points=defaults('extrude'),locked=false,textSnapshot='';
  const pending=()=>$('cad-profile-json').value!==textSnapshot;
  function syncText(){textSnapshot=JSON.stringify(points);$('cad-profile-json').value=textSnapshot;}
  function showStatus(message,error=false){$('cad-profile-status').textContent=message;$('cad-profile-status').classList.toggle('cad-error',error);}
  function check(){
    if(pending()){showStatus('坐标文本尚未应用，请先应用或恢复，再保存步骤。',true);return;}
    try{validateCADProfile(points,{radial:shape==='revolve'});showStatus(`${points.length} 个顶点 · 闭合轮廓有效；保存步骤后生成实体预览。`);}
    catch(error){showStatus(error.message,true);}
  }
  function draw(){
    const svg=$('cad-profile-plot');svg.replaceChildren();
    if(!points.every(p=>p.every(Number.isFinite)))return;
    const low=[Math.min(0,...points.map(p=>p[0])),Math.min(0,...points.map(p=>p[1]))],high=[Math.max(0,...points.map(p=>p[0])),Math.max(0,...points.map(p=>p[1]))];
    const scale=Math.min(262/Math.max(.01,high[0]-low[0]),132/Math.max(.01,high[1]-low[1]));
    const xy=p=>[29+(p[0]-low[0])*scale,161-(p[1]-low[1])*scale];
    const node=(tag,attrs,text)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,String(value));if(text!==undefined)e.textContent=text;svg.append(e);return e;};
    const origin=xy([0,0]);
    node('line',{x1:15,y1:origin[1],x2:302,y2:origin[1],class:'cad-profile-axis-line'});
    node('line',{x1:origin[0],y1:177,x2:origin[0],y2:15,class:'cad-profile-axis-line'});
    node('text',{x:305,y:Math.min(180,origin[1]+14)},shape==='revolve'?'R':'X');
    node('text',{x:Math.min(300,origin[0]+6),y:17},'Y');
    node('polygon',{points:points.map(p=>xy(p).join(',')).join(' '),class:'cad-profile-polygon'});
    points.forEach((p,i)=>{const [x,y]=xy(p);node('circle',{cx:x,cy:y,r:3.5,class:'cad-profile-point'});node('text',{x:x+5,y:y-5},String(i+1));});
  }
  function refresh(disabled=locked){
    locked=disabled;const textPending=pending();
    section.querySelectorAll('input,button,textarea').forEach(e=>{e.disabled=locked;});
    section.querySelectorAll('#cad-profile-rows input,#cad-profile-rows button').forEach(e=>{e.disabled=locked||textPending;});
    section.querySelectorAll('[data-remove]').forEach(e=>{e.disabled=locked||textPending||points.length<=3;});
    section.querySelectorAll('[data-insert]').forEach(e=>{e.disabled=locked||textPending||points.length>=32;});
    $('cad-profile-revert').disabled=locked||!textPending;
    check();
  }
  function renderRows(){
    const rows=$('cad-profile-rows');rows.replaceChildren();
    points.forEach((p,i)=>{
      const tr=document.createElement('tr'),index=document.createElement('td');index.textContent=String(i+1);tr.append(index);
      p.forEach((value,k)=>{const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='0.01';input.min=shape==='revolve'&&k===0?'0':'-6';input.max='6';input.value=String(value);input.setAttribute('aria-label',`轮廓点 ${i+1} ${k===0?(shape==='revolve'?'R':'X'):'Y'}`);
        input.addEventListener('input',()=>{points[i][k]=input.valueAsNumber;syncText();draw();refresh();onChange();});td.append(input);tr.append(td);});
      const td=document.createElement('td');td.className='cad-profile-actions';
      for(const action of ['insert','remove']){const button=document.createElement('button');button.type='button';button.dataset[action]=String(i);button.textContent=action==='insert'?'＋':'−';button.setAttribute('aria-label',action==='insert'?`在轮廓点 ${i+1} 后插入点`:`删除轮廓点 ${i+1}`);
        button.onclick=()=>{if(action==='insert'){const next=points[(i+1)%points.length];points.splice(i+1,0,p.map((v,k)=>(v+next[k])/2));}else points.splice(i,1);syncText();renderRows();draw();refresh();onChange();};td.append(button);}
      tr.append(td);rows.append(tr);
    });
  }
  function setFeature(feature){
    shape=feature.shape;section.hidden=!isProfile(shape);
    if(!isProfile(shape))return;
    points=structuredClone(feature.profile??defaults(shape));
    $('cad-depth').value=feature.depth??.25;$('cad-revolve-angle').value=feature.angle??360;
    $('cad-depth-field').hidden=shape!=='extrude';$('cad-angle-field').hidden=shape!=='revolve';
    $('cad-profile-axis').textContent=shape==='revolve'?'R（m）':'X（m）';
    $('cad-profile-help').textContent=shape==='revolve'?'R–Y 轮廓绕局部 +Y 轴旋转，R ≥ 0；起始面位于 +X，正角度转向 −Z。位置偏移与 XYZ 旋转用于放置整个实体。':'局部 XY 平面上的闭合轮廓，沿 Z 轴对称拉伸（−深度/2 至 +深度/2）。位置偏移与 XYZ 旋转用于放置整个实体。';
    syncText();renderRows();draw();refresh();
  }
  $('cad-profile-json').addEventListener('input',()=>{refresh();onChange();});
  $('cad-profile-apply').onclick=()=>{try{const parsed=JSON.parse($('cad-profile-json').value);points=validateCADProfile(parsed,{radial:shape==='revolve'});syncText();renderRows();draw();refresh();onChange();}catch(error){showStatus(`坐标未应用：${error.message}`,true);}};
  $('cad-profile-revert').onclick=()=>{syncText();refresh();onChange();};
  for(const id of ['cad-depth','cad-revolve-angle'])$(id).addEventListener('input',onChange);
  return {setFeature,refresh,read(){
    if(!isProfile(shape))return {};
    if(pending())throw Error('轮廓坐标文本尚未应用，请先应用坐标文本或恢复表格坐标');
    return {profile:structuredClone(points),...(shape==='extrude'?{depth:$('cad-depth').valueAsNumber}:{angle:$('cad-revolve-angle').valueAsNumber})};
  }};
}
