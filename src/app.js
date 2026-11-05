import { MATERIALS, TOOLS } from './materials.js';
import { Renderer } from './renderer.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#world'), cursor = $('#cursor');
let renderer, worker, tool = 'emit', selectedMaterial = 1, radius = 24, paused = false;
let frame = null, initialized = false, active = false, panning = false, spaceHeld = false, spaceUsed = false;
let lastPointer = { x: 0, y: 0 }, lastStats = null, fps = 60, frames = 0, lastFpsAt = performance.now(), lastUiAt = 0;
let toastTimer, pointerTool, hiddenPaused = false;
const touches = new Map();
let pinch = null;
let structureMaterial=11, drawStart=null;
const scenes = {
  planet: ['01 — EXPLORE', '万物，始于一粒。', '让引力牵引，让物质相遇。'],
  binary: ['02 — ORBIT', '彼此，牵引彼此。', '围绕共同质心，写下两条轨迹。'],
  collision: ['03 — COLLISION', '相遇，改变形状。', '掠过、撕扯，再汇聚成新的世界。'],
  basin: ['04 — FLOW', '流动，自有方向。', '落下、汇聚，留下新的形状。'],
  empty: ['05 — CREATE', '从无，到无限。', '一片留给想象的空白。'],
  density: ['06 — DENSITY', '轻重，自有分寸。', '左侧冰块，右侧铁块；相同体积，不同质量。'],
  thermal: ['07 — HEAT', '热量，缓缓流动。', '左铁、右水：等质量样本，左端 90°C，其余 20°C。'],
  elastic: ['08 — STRUCTURE', '受力，依然相连。', '上方钢梁，下方橡胶，右侧绳索。拖动观察回弹。'],
  softbody: ['09 — ELASTIC MPM', '柔软，也有形状。', '紫色为 MPM 弹性体；左侧悬臂可拉伸，右侧软块落入 PBF 水池。'],
};
for(const [value,label] of [['density','密度与沉浮'],['thermal','传热实验'],['elastic','固体与弹性'],['softbody','MPM · 可变形固体']]) $('#scene').add(new Option(label,value));
const properties=m=>`密度 ${m.density.toLocaleString()} kg/m³ · 比热 ${m.cp.toLocaleString()} J/(kg·K) · 导热 ${m.conductivity} W/(m·K)${[0,1].includes(m.id)?' · 岩石 ⇄ 熔岩：1000°C':[2,3,4].includes(m.id)?' · 冰 ⇄ 水：0°C；水 ⇄ 蒸汽：100°C':[5,7,10].includes(m.id)?' · 固态铁 ⇄ 铁水：1538°C':''}`;
$('#structure-properties').textContent=properties(MATERIALS[11]);
const statExtras=document.createElement('div');statExtras.className='physics-stats';
statExtras.innerHTML='<div>总质量 <strong id="stat-mass">—</strong> kg</div><div>总焓 <strong id="stat-energy">—</strong> MJ</div><div>本步内部交换 <strong id="stat-heat">—</strong> kJ</div><div>固体连接 <strong id="stat-bonds">—</strong></div><p class="setting-hint">内部交换量是成对传热的绝对值之和，不是新增能量。</p>';
$('#stats-panel .stats-list').after(statExtras);
const phaseReadout=document.createElement('p');phaseReadout.id='phase-readout';phaseReadout.className='setting-hint';statExtras.prepend(phaseReadout);
$('.help-note').textContent='v0.6：流体使用 PBF；新增 MPM 软体，使用连续弹性应力实现拉伸、弯曲与回弹。在结构页选择 MPM 软体，拖出矩形，再用拖拽工具施力。其他固体采用连接与形状约束。支持不同密度与质量、按比热容传热、含潜热的相变、固体连接及钢架 / 橡胶 / 绳索。结构页支持绘制、固定、释放与剪断。密度与沉浮、传热实验、固体与弹性三个场景可直接体验。采用参考常数和二维近似；气体膨胀、橡胶与绳索高温分解尚未模拟。';
function send(data) {
  if (!worker) return;
  if (data.type === 'recycle') worker.postMessage(data, [data.buffer]);
  else worker.postMessage(data);
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2400);
}
function selectTool(next) {
  if (active) endPointer();
  tool = next;
  document.querySelectorAll('.tool').forEach(b => { const selected = b.dataset.tool === tool; b.classList.toggle('active', selected); b.setAttribute('aria-pressed', String(selected)); });
  $('#tool-name').textContent = TOOLS[tool].name; $('#tool-key').textContent = TOOLS[tool].key; $('#tool-hint').textContent = TOOLS[tool].hint;
  cursor.classList.toggle('erase', tool === 'erase');
  canvas.style.cursor = tool === 'pan' ? 'grab' : 'none';
}
function selectMaterial(id) {
  selectedMaterial = id;
  const m = MATERIALS[id];
  document.querySelectorAll('.material').forEach(b => { const selected = Number(b.dataset.material) === id; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  $('#detail-dot').style.background = m.color; $('#detail-name').textContent = m.name;
  $('#detail-temp').textContent = `${m.temp.toLocaleString()} °C`; $('#detail-copy').textContent = m.copy;
  $('#detail-properties').textContent=properties(m);
  if(m.group==='structures'){
    structureMaterial=id;$('#structure-properties').textContent=m.mpm?'MPM 连续弹性体 · 可弯曲、拉伸、压缩和回弹；支持传热，暂不模拟熔化与断裂。':properties(m);
    if(m.mpm)$('#structure-shape').value='panel';
    selectTool('draw');
  }
  else selectTool('emit');
}
for (const m of MATERIALS) {
  const button = document.createElement('button'); button.className = 'material'; button.dataset.material = m.id;
  button.setAttribute('aria-label', `${m.name} ${m.en}`); button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `<span class="swatch" style="--swatch:${m.color}"></span><span>${m.name}<small>${m.en}</small></span>`;
  button.addEventListener('click', () => selectMaterial(m.id)); $(`#${m.group}`).append(button);
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => selectTool(b.dataset.tool)));
document.querySelectorAll('[role=tab]').forEach((b, index, tabs) => {
  function activate() {
    tabs.forEach(t => { const selected = t === b; t.classList.toggle('selected', selected); t.setAttribute('aria-selected', String(selected)); t.tabIndex = selected ? 0 : -1; $('#' + t.getAttribute('aria-controls')).hidden = !selected; });
    if(b.id==='tab-structures')selectMaterial(structureMaterial);
    if(b.id==='tab-materials' && MATERIALS[selectedMaterial].group==='structures')selectMaterial(2);
  }
  b.tabIndex = index === 0 ? 0 : -1;
  b.addEventListener('click', activate);
  b.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  });
});
$('#panel-toggle').addEventListener('click', () => {
  const collapsed = $('#inspector').classList.toggle('collapsed');
  $('#panel-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#panel-toggle').setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
});
if (innerWidth <= 760) { $('#inspector').classList.add('collapsed'); $('#panel-toggle').setAttribute('aria-expanded', 'false'); $('#panel-toggle').setAttribute('aria-label', '展开面板'); }
$('#brush').addEventListener('input', () => { radius = Number($('#brush').value); $('#brush-value').textContent = radius; updateCursor(lastPointer.x, lastPointer.y); if (active) updatePointer(); });
function updateGravityUi() {
  const mode = $('#gravity').value;
  $('#self-gravity-settings').hidden = mode !== 'self';
  $('#gravity-note').textContent = {
    self: '所有粒子按实际质量彼此吸引。相同体积的铁比水重；近距软化让接触更稳定。',
    center: '中心引力将粒子拉向画布中心。试试“双星绕行”或“双星碰撞”，观察物质之间的相互吸引。',
    uniform: '均匀引力向下作用，适合观察材料下落、堆积和流动。',
    none: '关闭引力。粒子仍然发生碰撞、黏性作用和热交换。',
  }[mode];
}
$('#gravity').addEventListener('change', () => { updateGravityUi(); send({ type: 'settings', settings: { gravity: $('#gravity').value } }); });
$('#solid-stiffness').addEventListener('input',()=>{const value=Number($('#solid-stiffness').value);$('#solid-stiffness-value').textContent=`${value.toFixed(2)} ×`;send({type:'settings',settings:{solidStiffness:value}});});
$('#softening').addEventListener('input', () => { const value = Number($('#softening').value); $('#softening-value').textContent = value; send({ type: 'settings', settings: { softening: value } }); });
for (const name of ['strength', 'speed']) $('#'+name).addEventListener('input', () => {
  const value = Number($('#'+name).value); $('#'+name+'-value').textContent = `${value.toFixed(name === 'speed' && value % .5 ? 2 : 1)} ×`;
  send({ type: 'settings', settings: { [name]: value } });
});
for (const name of ['thermal', 'boundary','ambient']) $('#'+name).addEventListener('change', () => send({ type: 'settings', settings: { [name]: $('#'+name).checked } }));
$('#glow').addEventListener('change', () => { if (renderer) renderer.glow = $('#glow').checked; });
function setHeatView(enabled) {
  if(renderer)renderer.heatmap=enabled;
  $('#heatmap').checked=enabled;
  $('#heat-view').setAttribute('aria-pressed',String(enabled));
  $('#heat-view').textContent=`温度着色 · ${enabled?'开':'关'}`;
  $('#heat-hint').textContent=enabled?'蓝色冷，红色热；接触时热量从高温流向低温。':'材料颜色不直接表示温度；点击「温度着色」查看冷热。';
}
$('#heatmap').addEventListener('change',()=>setHeatView($('#heatmap').checked));
$('#heat-view').addEventListener('click',()=>setHeatView(!$('#heatmap').checked));
$('#solid-links').addEventListener('change',()=>{if(renderer)renderer.showSolidLinks=$('#solid-links').checked;});
$('#heat-range').addEventListener('change',()=>{if(renderer)renderer.heatMax=Number($('#heat-range').value);});
$('#heat-rate').addEventListener('input',()=>{const heatRate=Number($('#heat-rate').value);$('#heat-rate-value').textContent=`${heatRate} ×`;send({type:'settings',settings:{heatRate}});});
$('#brush-power').addEventListener('input',()=>{const kw=Number($('#brush-power').value);$('#brush-power-value').textContent=`${kw} kW`;send({type:'settings',settings:{brushPower:kw*1000}});});

function setPaused(value) {
  paused = value;
  $('#pause').setAttribute('aria-label', paused ? '继续模拟' : '暂停模拟');
  $('#pause use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  $('#live-label').innerHTML = `<i></i>${paused ? 'PAUSED' : 'LIVE'}`;
  $('#live-label').classList.toggle('paused', paused);
  send({ type: 'pause', paused });
}
$('#pause').addEventListener('click', () => { endPointer(); setPaused(!paused); });
function fitCamera() {
  if (!renderer) return;
  renderer.camera.x = 0; renderer.camera.y = 0; renderer.camera.zoom = 1;
  $('#fit').textContent = '100%';
}
function updateScene(scene) {
  if (renderer) renderer.scene = scene;
  if(renderer){
    renderer.heatMax=['softbody','thermal','density'].includes(scene)?100:1600;$('#heat-range').value=String(renderer.heatMax);
    if(scene==='softbody')setHeatView(false);
  }
  const [index, title, description] = scenes[scene];
  $('.caption-index').textContent = index; $('#scene-title').textContent = title; $('#scene-description').textContent = description;
  $('#gravity').value = ['softbody','basin','density','elastic'].includes(scene) ? 'uniform' : scene === 'thermal' ? 'none' : ['binary', 'collision'].includes(scene) ? 'self' : 'center';
  updateGravityUi();
  $('#scene').value = scene; fitCamera(); endPointer();
}
$('#scene').addEventListener('change', () => { updateScene($('#scene').value); send({ type: 'reset', scene: $('#scene').value }); toast('新场景已就绪'); });
$('#reset').addEventListener('click', () => { endPointer(); send({ type: 'reset', scene: $('#scene').value }); updateScene($('#scene').value); toast('已恢复场景的初始状态'); });
$('#clear').addEventListener('click', () => { endPointer(); send({ type: 'clear' }); updateScene('empty'); toast('画布已清空，选择材料开始创造'); });
function zoom(factor, x, y) { if (!renderer) return; renderer.zoomAt(factor, x, y); $('#fit').textContent = `${Math.round(renderer.camera.zoom * 100)}%`; updateCursor(lastPointer.x, lastPointer.y); }
$('#zoom-in').addEventListener('click', () => zoom(1.2)); $('#zoom-out').addEventListener('click', () => zoom(1 / 1.2)); $('#fit').addEventListener('click', fitCamera);
$('#help').addEventListener('click', () => { endPointer(); $('#help-dialog').showModal(); });
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#help-dialog').addEventListener('click', e => { if (e.target === $('#help-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });

function updateCursor(x, y) {
  if (!renderer) return;
  const size = radius * renderer.scale * 2;
  cursor.style.width = size + 'px'; cursor.style.height = size + 'px';
  cursor.style.transform = `translate(${x - size / 2}px,${y - size / 2}px)`;
}
function updatePointer(e = {}) {
  if (!renderer) return;
  const world = renderer.screenToWorld(lastPointer.x, lastPointer.y);
  if(drawStart){renderer.preview={...drawStart,x2:world.x,y2:world.y,shape:$('#structure-shape').value};return;}
  send({ type: 'pointer', pointer: { active: active && !panning, ...world, radius, tool: pointerTool || tool, material: selectedMaterial, reverse: !!e.shiftKey } });
}
function endPointer() {
  drawStart=null;if(renderer)renderer.preview=null;
  active = false; panning = false; pointerTool = null; pinch = null;
  send({ type: 'pointer', pointer: { active: false } });
  canvas.style.cursor = tool === 'pan' ? 'grab' : 'none';
}
canvas.addEventListener('pointerdown', e => {
  if (!renderer || !initialized) return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    endPointer();
    const [a, b] = [...touches.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return;
  }
  lastPointer = { x: e.clientX, y: e.clientY }; active = true;
  panning = tool === 'pan' || spaceHeld || e.button === 1;
  if (spaceHeld) spaceUsed = true;
  pointerTool = e.button === 2 ? 'erase' : tool;
  if(!panning && pointerTool==='draw'){
    const w=renderer.screenToWorld(e.clientX,e.clientY);drawStart={x1:w.x,y1:w.y};
  }
  if (panning) canvas.style.cursor = 'grabbing';
  updatePointer(e); updateCursor(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (!renderer) return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    zoom(distance / Math.max(1, pinch.distance), x, y);
    renderer.camera.x -= (x - pinch.x) / renderer.scale; renderer.camera.y += (y - pinch.y) / renderer.scale;
    pinch = { distance, x, y }; cursor.hidden = true; return;
  }
  if (panning && active) {
    renderer.camera.x -= (e.clientX - lastPointer.x) / renderer.scale;
    renderer.camera.y += (e.clientY - lastPointer.y) / renderer.scale;
  }
  lastPointer = { x: e.clientX, y: e.clientY };
  cursor.hidden = panning || tool === 'pan' || e.pointerType === 'touch'; updateCursor(e.clientX, e.clientY);
  if (active) updatePointer(e);
});
function pointerUp(e) {
  if(drawStart && e.type==='pointerup'){
    const w=renderer.screenToWorld(e.clientX,e.clientY);
    send({type:'structure',structure:{...drawStart,x2:w.x,y2:w.y,material:structureMaterial,shape:$('#structure-shape').value,fixed:$('#fixed-start').checked}});
  }
  touches.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  endPointer();
}
canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('lostpointercapture', () => { if (touches.size < 2) endPointer(); });
canvas.addEventListener('pointerleave', () => { cursor.hidden = true; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
window.addEventListener('blur', () => { endPointer(); touches.clear(); spaceHeld = false; });
window.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $('#help-dialog').open) return;
  if (e.target.tagName === 'BUTTON' && e.code === 'Space') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { spaceHeld = true; spaceUsed = false; } return; }
  const next = Object.keys(TOOLS).find(t => TOOLS[t].key.toLowerCase() === e.key.toLowerCase());
  if (next) selectTool(next);
  if (e.key === '[' || e.key === ']') {
    $('#brush').value = Math.max(6, Math.min(85, radius + (e.key === '[' ? -3 : 3))); $('#brush').dispatchEvent(new Event('input'));
  }
});
window.addEventListener('keyup', e => {
  if (e.code !== 'Space' || !spaceHeld) return;
  e.preventDefault(); spaceHeld = false;
  if (!spaceUsed) setPaused(!paused);
  if (panning) endPointer();
});
document.addEventListener('visibilitychange', () => {
  endPointer();
  if (document.hidden) { hiddenPaused = paused; send({ type: 'pause', paused: true }); }
  else send({ type: 'pause', paused: hiddenPaused });
});

function updateStats() {
  if (!lastStats) return;
  const { count, composition, ms, temperature, time, gravityMs, gravity } = lastStats;
  $('#mini-count').textContent = `${count.toLocaleString()} PARTICLES`;
  $('#mini-fps').textContent = `${fps} FPS`;
  $('#stat-fps').textContent = fps; $('#stat-count').textContent = count.toLocaleString();
  $('#stat-ms').textContent = ms.toFixed(1); $('#stat-temp').textContent = Math.round(temperature);
  $('#stat-time').textContent = time.toFixed(1);
  $('#stat-mass').textContent=lastStats.totalMass.toFixed(1);
  $('#stat-energy').textContent=(lastStats.energy/1e6).toFixed(3);
  $('#phase-readout').textContent=`固体 ${lastStats.phases.solid} · 液体 ${lastStats.phases.liquid} · 气体 ${lastStats.phases.gas} · 散粒 ${lastStats.phases.granular}`;
  $('#stat-heat').textContent=(lastStats.exchangedHeat/1000).toFixed(3);
  const heat=lastStats.exchangedHeat;
  const mp=lastStats.mpm;
  $('#solver-status').textContent=mp.count?`固体 MLS-MPM · ${mp.count} 粒 · 最大应变 ${(mp.strain*100).toFixed(1)}% ｜ 流体 PBF`:'流体 PBF · 在「结构」中创建 MPM 软体';
  $('#heat-status').textContent=!$('#thermal').checked?'接触传热已关闭':paused?'模拟已暂停 · 接触传热暂停':!count?'添加冷热材料，接触后传热':heat>0.5?`正在传热 · ${(heat/1000).toFixed(3)} kJ / 步`:'本步交换 < 0.001 kJ · 需接触和温差';
  $('#heat-temperatures').textContent=MATERIALS.filter(m=>composition[m.id]).sort((a,b)=>composition[b.id]-composition[a.id]).slice(0,3).map(m=>`${m.name}均温 ${lastStats.materialTemps[m.id].toFixed(1)}°C`).join(' · ');
  $('#stat-bonds').textContent=lastStats.structure.bonds.toLocaleString();
  $('#gravity-stat').hidden = gravity !== 'self';
  $('#stat-gravity').textContent = gravityMs.toFixed(1);
  $('#empty-hint').hidden = count !== 0;
  $('.world-caption').style.opacity = count === 0 ? 0 : 1;
  $('#composition').replaceChildren(...MATERIALS.filter(m => composition[m.id]).map(m => {
    const percent = count ? composition[m.id] / count * 100 : 0;
    const row = document.createElement('div'); row.className = 'composition-item';
    row.innerHTML = `<span>${m.name}<small class="material-temperature">${lastStats.materialTemps[m.id].toFixed(1)}°C</small></span><div class="composition-track"><i style="background:${m.color};width:${percent}%"></i></div><span>${percent.toFixed(0)}%</span>`;
    return row;
  }));
}
function fatal(message) {
  $('#loading').style.opacity = 1; $('#loading').hidden = false;
  $('#loading p').textContent = message; $('.loading-orbit').style.display = 'none';
  worker?.terminate();
}
function animate(now) {
  if (!renderer) return;
  if (frame) {
    renderer.upload(frame.buffer, frame.count); renderer.structure=frame.structure; lastStats = frame;
    send({ type: 'recycle', buffer: frame.buffer }); frame = null;
  }
  renderer.draw(); frames++;
  if (now - lastFpsAt >= 1000) { fps = Math.round(frames * 1000 / (now - lastFpsAt)); frames = 0; lastFpsAt = now; }
  if (now - lastUiAt > 400) { updateStats(); lastUiAt = now; }
  requestAnimationFrame(animate);
}
selectMaterial(2);
try {
  renderer = new Renderer(canvas);
  setHeatView(true);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if(data.type==='structure-result'){toast(data.ok?(data.mpm?'MPM 软体已生成：切换「拖拽」拉伸，松手回弹':'结构已生成：可拖拽、固定或剪断'):'未生成结构：请画长一些，或缩小范围 / 清理粒子');return;}
    if (data.type !== 'frame') return;
    frame = data;
    if (!initialized) {
      initialized = true; $('#loading').style.opacity = 0;
      setTimeout(() => { $('#loading').hidden = true; }, 500);
    }
  };
  worker.onerror = error => { console.error(error); fatal('模拟引擎启动失败。请刷新页面重试，或查看开发者控制台。'); };
  updateScene('softbody');
  $('#tab-structures').click();selectTool('drag');
  send({ type: 'init', scene: 'softbody' });
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fatal('图形连接已中断，请刷新页面重新启动实验。'); });
  requestAnimationFrame(animate);
} catch (error) { console.error(error); fatal(error.message); }
