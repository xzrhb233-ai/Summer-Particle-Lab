import {DEFAULT_DOMAIN,domainParameters,geometryParameters} from './discretization.js';

export function installModeling({send,renderer,materialOptions,toast}){
  const $=id=>document.getElementById(id);
  const vec=(id,label,v,min,max)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((a,k)=>`<label>${a}<input id="${id}${k}" aria-label="${label} ${a}" type="number" min="${min}" max="${max}" step="any" value="${v[k]}"></label>`).join('')}</div>`;
  const read=id=>[0,1,2].map(a=>$(id+a).valueAsNumber),put=(id,v)=>v.forEach((x,a)=>$(id+a).value=x);
  const domainPanel=document.createElement('details');domainPanel.id='domain-panel3';domainPanel.className='instrument';
  domainPanel.innerHTML=`<summary>计算域与背景网格</summary><p class="hint">坐标使用仿真长度单位。计算域决定边界，网格尺寸决定 MPM 分辨率；PBF 邻域半径仍为 8。</p>
    ${vec('domain-min','计算域最小坐标',DEFAULT_DOMAIN.lower,-240,240)}${vec('domain-max','计算域最大坐标',DEFAULT_DOMAIN.upper,-240,240)}
    <label for="grid-cell3">MPM 网格尺寸 h</label><input id="grid-cell3" type="number" min="4" max="16" step="any" value="8">
    <label for="grid-ppc3">每轴粒子数 n（每格 n³）</label><select id="grid-ppc3"><option value="1">1 × 1 × 1 = 1</option><option value="2" selected>2 × 2 × 2 = 8</option><option value="3">3 × 3 × 3 = 27</option><option value="4">4 × 4 × 4 = 64</option></select>
    <p class="hint" id="domain-draft3" role="status"></p><button id="domain-apply3">应用计算域与网格</button><p class="hint" id="domain-current3" role="status"></p>
    <p class="hint">粒子间距 Δp = h / n，支持 1–4；每轴最多 60 个网格。完整填充单元有 n³ 个初始点，边缘单元按几何裁切。采样数量仅影响之后新建的几何，已有粒子不会重新采样。缩小计算域时若容不下已有粒子会拒绝操作。</p>
    <label class="check"><input id="grid-show3" type="checkbox" checked>显示背景网格底面</label><button id="domain-fit3">视角适配计算域</button>`;
  $('geometry-panel3').before(domainPanel);
  let current=domainParameters(DEFAULT_DOMAIN),domainKey='',dirty=false,pending=false,capacity=20000,count=0,preview=false;
  const geometryPanel=$('geometry-panel3');
  const mode=document.createElement('div');mode.innerHTML='<label for="geometry-mode3">位置描述方式</label><select id="geometry-mode3"><option value="center">中心 + 尺寸</option><option value="bounds">最小角 + 最大角</option></select>';
  geometryPanel.querySelector('summary').after(mode);
  const bounds=document.createElement('div');bounds.id='geometry-bounds3';bounds.hidden=true;bounds.innerHTML=vec('geometry-min','未旋转包围盒最小角',[-12,0,-12],-240,240)+vec('geometry-max','未旋转包围盒最大角',[12,24,12],-240,240);
  $('sampling-enabled3').parentElement.before(bounds);
  const rotation=document.createElement('div');rotation.innerHTML=vec('geometry-angle','旋转角度（度，X → Y → Z）',[0,0,0],-360,360);
  bounds.after(rotation);
  const report=document.createElement('p');report.id='geometry-report3';report.className='hint';report.setAttribute('role','status');rotation.after(report);
  const previewButton=document.createElement('button');previewButton.id='geometry-preview3';previewButton.textContent='预览几何轮廓';report.after(previewButton);
  for(const a of [0,1,2]){const c=$('geometry-c'+a),s=$('geometry-size'+a);c.min=-240;c.max=240;c.step='any';s.min=.001;s.max=480;s.step='any';}
  const inputDomain=()=>domainParameters({lower:read('domain-min'),upper:read('domain-max'),cellSize:$('grid-cell3').valueAsNumber,particlesPerAxis:Number($('grid-ppc3').value)});
  function descriptor(){let center=read('geometry-c'),size=read('geometry-size');if($('geometry-mode3').value==='bounds'){const lo=read('geometry-min'),hi=read('geometry-max');if(lo.some((v,a)=>v>=hi[a]))throw Error('最小角必须小于最大角');center=lo.map((v,a)=>(v+hi[a])/2);size=lo.map((v,a)=>hi[a]-v);}return {center,size,rotation:read('geometry-angle'),shape:$('geometry-shape3').value};}
  function describeDomain(d){return `范围尺寸 ${d.size.map(x=>Number(x.toFixed(3))).join(' × ')} · 网格数量 ${d.cells.join(' × ')} · h ${d.cellSize} · 每格粒子 ${d.particlesPerCell} · Δp ${Number(d.spacing.toFixed(4))}`;}
  function domainDraft(){try{$('domain-draft3').textContent=describeDomain(inputDomain());}catch(e){$('domain-draft3').textContent=e.message;}}
  function geometryDraft(){try{const g=geometryParameters(descriptor(),current);$('geometry-report3').textContent=`体积 V ${g.volume.toFixed(3)} · Δp ${g.spacing.toFixed(3)} · 预计粒子 ≈ ${g.estimate.toLocaleString()} · 可用容量 ${Math.max(0,capacity-count).toLocaleString()}\n旋转后包围盒 (${g.lower.map(x=>x.toFixed(2)).join(', ')}) → (${g.upper.map(x=>x.toFixed(2)).join(', ')})`;if(preview)renderer.setGeometryPreview(g);}catch(e){$('geometry-report3').textContent=e.message;renderer.geometryPreview=null;}}
  for(const input of domainPanel.querySelectorAll('input,select'))input.addEventListener('input',()=>{if(input.id==='grid-show3'){renderer.showGrid=input.checked;return;}dirty=true;domainDraft();});
  $('domain-fit3').onclick=()=>renderer.fitDomain();
  $('domain-apply3').onclick=()=>{try{const d=inputDomain();pending=true;send({type:'domain',value:d});}catch(e){toast(e.message);}};
  previewButton.onclick=()=>{preview=!preview;if(!preview)renderer.geometryPreview=null;else geometryDraft();};
  $('geometry-mode3').onchange=()=>{
    const isBounds=$('geometry-mode3').value==='bounds';
    if(isBounds){const c=read('geometry-c'),s=read('geometry-size');put('geometry-min',c.map((v,a)=>v-s[a]/2));put('geometry-max',c.map((v,a)=>v+s[a]/2));}
    else{const lo=read('geometry-min'),hi=read('geometry-max');put('geometry-c',lo.map((v,a)=>(v+hi[a])/2));put('geometry-size',lo.map((v,a)=>hi[a]-v));}
    bounds.hidden=!isBounds;
    for(const id of ['geometry-c','geometry-size']){const row=$(id+'0').closest('.gravity-coordinates');row.hidden=isBounds;row.previousElementSibling.hidden=isBounds;}
    geometryDraft();
  };
  for(const input of geometryPanel.querySelectorAll('input,select'))input.addEventListener('input',geometryDraft);
  $('geometry-create3').onclick=()=>{try{const d=descriptor();geometryParameters(d,current);send({type:'geometry',...materialOptions(),...d,name:$('part-name3').value,velocity:read('part-v')});}catch(e){toast(e.message);}};
  domainDraft();geometryDraft();
  return {result(ok){pending=false;if(ok){dirty=false;domainKey='';renderer.geometryPreview=null;preview=false;}},reset(){dirty=false;pending=false;domainKey='';renderer.geometryPreview=null;preview=false;},update(s){
    const changed=count!==s.count||capacity!==s.capacity;count=s.count;capacity=s.capacity;
    if(!s.domain)return;const key=JSON.stringify(s.domain);
    if(key!==domainKey){domainKey=key;current=s.domain;renderer.setDomain(current);$('domain-current3').textContent=`✓ ${describeDomain(current)}`;if(!dirty||pending){put('domain-min',current.lower);put('domain-max',current.upper);$('grid-cell3').value=current.cellSize;$('grid-ppc3').value=current.particlesPerAxis;domainDraft();}
      $('press-target3').min=current.lower[1]+Math.min(16,current.size[1]/2);$('press-target3').max=current.upper[1];$('cutz3').min=current.lower[2];$('cutz3').max=current.upper[2];$('position3').min=Math.min(...current.lower);$('position3').max=Math.max(...current.upper);
      geometryDraft();
    }
    else if(changed)geometryDraft();
  }};
}
