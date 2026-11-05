import { installExperiment } from './experiment-ui.js';
import { installModeling } from './modeling-ui.js';
import { installProjectWorkspace } from '../simulation/workspace-ui.js';
import { installWorkbench } from './workbench.js';
import { Renderer3 } from './renderer.js';
import { MATERIALS } from '../materials.js';
import { MODELS } from './constitutive.js';
import { installPlasticityControls } from './plasticity-ui.js';
import { installThermalMaterialControls } from './thermal-material-ui.js';
import { installPressureControls } from './pressure-ui.js';
import { installPhaseControls } from './phase-change-ui.js';
const $=id=>document.getElementById(id),canvas=$('world3');
const plasticityUI=installPlasticityControls();
const pressureUI=installPressureControls();
const thermalMaterialUI=installThermalMaterialControls();
const phaseUI=installPhaseControls();
function materialOptions(){return {phaseChange:$('material3').value==='11'?phaseUI.values():undefined,thermalMaterial:$('material3').value==='11'&&Number($('model3').value)>=10?thermalMaterialUI.values():undefined,pressure:$('material3').value==='11'&&Number($('model3').value)>=8&&Number($('model3').value)<10?pressureUI.values():undefined,sampling:experiment.sampling(),material:Number($('material3').value),fixed:$('fixed3').checked,temperature:Number($('temperature3').value),model:Number($('model3').value),yieldStrain:Number($('yield3').value)/100,friction:Number($('friction3').value),plasticity:$('material3').value==='11'&&Number($('model3').value)>=4&&Number($('model3').value)<8?plasticityUI.values():undefined};}
let renderer,experiment,modeling,multibody,workbench,worker,paused=false,tool='orbit',gesture=null,toastTimer,lastBrush=0,lastUi=0,lastState=null,frames=0,fps=0,lastFps=performance.now();
let backendState='connecting',backendMessage='正在连接求解器…';
const send=d=>{if(backendState==='failed'){if(!['drag-end','settings'].includes(d.type))toast(backendMessage);return;}worker?.postMessage(d);};
function connection(state,message=''){
  backendState=state;backendMessage=message;
  for(const id of ['geometry-create3','domain-apply3','pause3','reset3','run-start3','run-step3','part-velocity3','part-pin3','part-release3'])$(id).disabled=state!=='ready';
  document.querySelectorAll('[data-tool]').forEach(b=>{if(b.dataset.tool!=='orbit')b.disabled=state!=='ready';});
  if(state!=='ready')lastState=null;
  workbench?.connection(state,message);
}
function backendFailed(current,message){
  if(worker!==current)return;
  $('backend-status3').textContent=message;$('reconnect3').hidden=false;paused=true;$('pause3').textContent='继续';
  current.terminate();worker=null;gesture=null;renderer.preview=null;connection('failed',message);
}
function mechanics(){
  renderer.mechanics=Number($('mechanics3').value);renderer.mechanicsMax=Number($('mechanics-max3').value);
  $('mechanics-max3-value').textContent=renderer.mechanicsMax.toFixed(2);$('mechanics-legend3').hidden=!renderer.mechanics;
  $('mechanics-caption3').textContent=renderer.mechanics===1?`相对应力 σeq/E · 0 → ${renderer.mechanicsMax.toFixed(2)}（von Mises，不含静水压）`:`累积塑性应变 · 0 → ${renderer.mechanicsMax.toFixed(2)}`;
  if(renderer.mechanics){renderer.heatmap=false;$('heatmap3').checked=false;}
}
function press(value){send({type:'press',value});if(paused)toast('目标已设定，继续模拟后压板开始移动');}
function diagnostics(s){
  const p=s.profile||{},n=x=>(Number.isFinite(x)?x:0).toFixed(1);
  const gpu=s.backend?.arch!=='cpu'&&s.backend,backend=gpu?`Taichi ${s.backend.arch.toUpperCase()}`:'CPU';
  $('performance-title3').textContent=`性能面板 · ${backend} 求解`;
  $('performance3').textContent=`${paused?'已暂停 · 以下为上一步':`模拟速度 ${s.rate.toFixed(2)}× · 1× 为实时`}\n${gpu?'本构 / 稳定步长':'本构 / 塑性'}  ${n(p.constitutive)} ms\n${gpu?'传递 / 塑性返回':'粒子 ↔ 网格'}  ${n(p.transfer)} ms\n网格 / 压板  ${n(p.grid)} ms\n自引力        ${n(p.gravity)} ms\n流体 / 接触  ${n(p.fluid)} ms\n传热计算      ${n(p.thermal)} ms\n力学诊断      ${n(p.diagnostics)} ms\n其余物理      ${n(p.other)} ms\n物理合计      ${n(p.total)} ms · ${s.substeps} 子步\n${gpu?'回读 / 打包':'快照打包'}      ${n(s.snapshotMs)} ms\n渲染 ${fps} FPS · ${backend} 求解${gpu?'（计时含 GPU 同步）':''}`;
  const platen=s.press;$('press3').checked=platen.enabled;
  if(document.activeElement!==$('press-target3'))$('press-target3').value=platen.target;
  if(document.activeElement!==$('press-speed3'))$('press-speed3').value=platen.speed;
  $('press-target3-value').textContent=n(platen.target);$('press-speed3-value').textContent=n(platen.speed);
  $('press-readout3').textContent=platen.enabled?`实际高度 ${n(platen.y)} · 接触反力 ${n(platen.force)}\n最大 σeq/E ${s.maxStress.toFixed(3)} · 累积塑性 ${s.maxPlastic.toFixed(3)}`:'压板未启用';
  const history=s.history||[],xs=history.map(v=>v[0]),ys=history.map(v=>v[1]),lo=Math.min(0,...xs),hi=Math.max(1,...xs),top=Math.max(1,...ys);
  $('force-line3').setAttribute('points',history.map(([x,y])=>`${24+(x-lo)/(hi-lo)*208},${68-y/top*52}`).join(' '));
  $('force-max3').textContent=`反力 ${top.toFixed(0)}`;$('force-range3').textContent=`位移 ${lo.toFixed(1)} → ${hi.toFixed(1)}（最近 300 步）`;
}
function toast(text){$('toast3').textContent=text;$('toast3').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast3').classList.remove('show'),2800);}
function fatal(text){$('error3').hidden=false;$('error3').textContent=text;worker?.terminate();}
const gravityNames={none:'关闭',uniform:'定向',self:'粒子自引力',attract:'中心吸引',repel:'中心排斥'};
function gravityValues(){
  return {gravity:true,gravityMode:$('gravity-mode3').value,gravityStrength:Number($('gravity-strength3').value),gravityDirection:$('gravity-direction3').value,gravityCenter:['x','y','z'].map(k=>Number($('gravity-'+k+'3').value)),gravitySoftening:Number($('gravity-softening3').value)};
}
function gravityControls(){
  const v=gravityValues(),mode=v.gravityMode==='scene'?($('scene3').value==='planet'?'self':$('scene3').value==='million'?'none':'uniform'):v.gravityMode;
  $('gravity-mode3').querySelector('option[value="self"]').disabled=$('backend3').value!=='gpu';
  $('gravity-strength3').disabled=mode==='none';
  $('gravity-strength3-value').textContent=v.gravityStrength.toFixed(2)+' ×';
  $('gravity-softening3-value').textContent=v.gravitySoftening;
  $('gravity-direction-controls3').hidden=mode!=='uniform';
  $('gravity-center-controls3').hidden=!['attract','repel'].includes(mode);
  $('gravity-softening-controls3').hidden=!['self','attract','repel'].includes(mode);
  $('gravity-note3').textContent={none:'不施加重力；现有速度、接触和边界仍然生效。',uniform:'沿选定方向施加恒定加速度。1× 为 24 模拟单位；蒸汽保留反向浮升。',self:'按全部粒子的质量分布计算三维自引力。1× 为 G=2；百万粒子开启后耗时会增加。',attract:'向指定中心吸引，随距离减弱。十字标记为中心；软化半径越大，近处作用越温和。',repel:'从指定中心向外排斥，随距离减弱。十字标记为中心；这是外加力场。'}[mode];
  if(v.gravityStrength===0&&mode!=='none')$('gravity-note3').textContent+=' 当前强度为 0，重力已关闭。';
  renderer.gravityCenter=['attract','repel'].includes(mode)?v.gravityCenter:null;
}
function changeGravity(){gravityControls();send({type:'settings',value:gravityValues()});}
for(const id of ['gravity-mode3','gravity-direction3'])$(id).onchange=changeGravity;
for(const id of ['gravity-strength3','gravity-softening3'])$(id).oninput=changeGravity;
for(const k of ['x','y','z'])$('gravity-'+k+'3').onchange=()=>{const e=$('gravity-'+k+'3');e.value=Number.isFinite(e.valueAsNumber)?Math.max(-240,Math.min(240,e.valueAsNumber)):0;changeGravity();};
$('gravity-origin3').onclick=()=>{for(const k of ['x','y','z'])$('gravity-'+k+'3').value=0;changeGravity();};
$('gravity-default3').onclick=()=>{$('gravity-mode3').value='scene';$('gravity-strength3').value=1;$('gravity-direction3').value='down';$('gravity-softening3').value=8;for(const k of ['x','y','z'])$('gravity-'+k+'3').value=0;changeGravity();};
function sceneView(){
  const scene=$('scene3').value,space=['planet','million'].includes(scene);
  renderer.space=space;renderer.distance=scene==='million'?1000:space?290:220;
  if(space){$('mechanics3').value='0';mechanics();renderer.heatmap=false;$('heatmap3').checked=false;$('material3').value='2';$('temperature3').value=20;modelControls();}
  if(scene==='metals'){$('material3').value='11';$('model3').value='6';modelControls();}
  if(scene==='thermomech'||scene==='melting'){phaseUI.preset(scene==='melting');$('material3').value='11';$('model3').value='10';modelControls();$('mechanics3').value='0';mechanics();$('heatmap3').checked=true;renderer.heatmap=true;$('heatmax3').value='200';renderer.heatMax=200;}
  if(scene==='porous'){$('material3').value='11';$('model3').value='9';modelControls();}
  $('press-panel3').hidden=space;
  $('cutz3').min=space?-240:-64;$('cutz3').max=space?240:64;
  $('position3').min=space?-236:-44;$('position3').max=space?236:60;
  $('depth3').max=space?400:40;
  for(const id of ['position3','depth3','cutz3'])$(id+'-value').textContent=$(id).value;
  renderer.cutZ=Number($('cutz3').value);if(tool==='create')renderer.workPlane=workPlane();
  gravityControls();
  $('scene-note3').textContent=scene==='planet'?'20,000 个 PBF 水粒子 · 三维自引力 · 无地板。可拖动表面、剖切或关闭自引力。':scene==='million'?'1,000,000 个 PBF 粒子实际求解；预览其中 100,000 个。默认无引力；可在重力场面板修改。计算速度取决于显卡。':scene==='metals'?'蓝：理想塑性；珊瑚：线性强化（20°C）。橙：Johnson–Cook；青：简化模型（均为 650°C）。在载荷目录下降压板，比较屈服、硬化与热软化。':scene==='melting'?'相变演示：熔点 120°C，潜热 120 kJ/kg。左侧 20°C 使用 MPM；右侧 180°C 已熔化，使用 PBF。用加热或降温笔完成相变，观察固液数量。':scene==='thermomech'?'此场景只比较固体热软化与蠕变，不包含熔化。需要热时流动，请选择“熔化与凝固”场景。红色：温度相关 J2；青柠色：蠕变。左冷 20°C、右热 180°C。下压并保持压板，用加热/降温笔改变响应，温度着色查看热场。':scene==='porous'?'棕色：低/高剪胀岩土。玫红色：低/高平台强度泡沫。试样使用 20% 随机扰动；下压压板，对比剪胀和永久压密。':'';
}
function startBackend(){
  if(['planet','million'].includes($('scene3').value)&&$('backend3').value!=='gpu')$('scene3').value='coupled';
  if($('backend3').value!=='gpu'&&$('gravity-mode3').value==='self')$('gravity-mode3').value='scene';
  sceneView();
  experiment?.reset();modeling?.reset();end();worker?.terminate();worker=null;lastState=null;paused=false;$('pause3').textContent='暂停';$('error3').hidden=true;
  $('reconnect3').hidden=true;$('performance3').textContent='等待首个物理步…';$('live').textContent='正在启动计算后端…';
  renderer.upload(new Float32Array());renderer.press=null;
  const gpu=$('backend3').value==='gpu',port=Number($('gpu-port3').value);$('gpu-port-controls3').hidden=!gpu;
  connection('connecting','正在启动计算后端…');
  if(gpu&&(!Number.isInteger(port)||port<8765||port>8799)){
    const message='GPU 服务端口必须是 8765–8799 之间的整数。';$('backend-status3').textContent=message;$('reconnect3').hidden=false;connection('failed',message);return;
  }
  $('backend-status3').textContent=gpu?`正在连接本机 Taichi 服务… · 127.0.0.1:${port}`:'CPU · 浏览器 Worker';
  $('performance-title3').textContent=`性能面板 · ${gpu?'Taichi GPU':'CPU'} 求解`;
  const current=new Worker(new URL(gpu?'./gpu-worker.js':'./worker.js',import.meta.url),{type:'module'});worker=current;
  current.onmessage=({data})=>{
    if(worker!==current)return;
    if(data.type==='frame'){
      if(backendState!=='ready')connection('ready');
      const previous=renderer.data.buffer;lastState=data;renderer.upload(data.data);renderer.press=data.press;paused=!!data.paused;$("pause3").textContent=paused?"继续":"暂停";experiment.update(data);modeling.update(data);
      $('backend-status3').textContent=data.backend?.arch==='cpu'?'CPU · 浏览器 Worker':`${data.backend.name} ${data.backend.arch.toUpperCase()} · ${data.backend.device} · 127.0.0.1:${port}`;
      current.postMessage({type:'ack',buffer:previous},[previous]);
    }else if(data.type==='created'){toast(data.message||(data.ok?'部件已生成，可在部件面板设置初始条件':'创建失败：检查本构或生成参数、计算域、尺寸、粒子容量和部件数（最多 127 个）'));if(data.ok)experiment.created(data.partId);}
    else if(data.type==='operation'){
      toast(data.message||(data.ok?'操作已生效':'操作未执行，请检查所选部件、参数或暂停状态'));
      if(data.scene){$('scene3').value=data.scene;sceneView();const url=new URL(location.href);url.searchParams.set('scene',data.scene);history.replaceState(null,'',url);}
    }
    else if(data.type==='domain-configured'){modeling.result(data.ok);toast(data.message||(data.ok?'计算域与网格已应用，采样参数用于之后新建的几何':'计算域设置失败'));}
    else if(data.type==='backend-status')$('backend-status3').textContent=data.message;
    else if(data.type==='backend-error'){
      backendFailed(current,data.message);
    }
  };
  current.onerror=e=>{if(gpu)backendFailed(current,'GPU 连接失败：'+e.message);else fatal('三维模拟启动失败：'+e.message);};
  send({type:'init',scene:$('scene3').value,...(gpu?{port,requireSolidSampling:true,requireDiscretization:true}:{})});send({type:'settings',value:{...gravityValues(),...experiment.settings(),thermal:$('thermal3').checked,stiffness:Number($('stiffness3').value)}});
  const url=new URL(location.href);url.searchParams.set('backend',gpu?'gpu':'cpu');url.searchParams.set('scene',$('scene3').value);history.replaceState(null,'',url);
  if(port!==8765)url.searchParams.set('gpuPort',port);else url.searchParams.delete('gpuPort');history.replaceState(null,'',url);
}
$('backend3').onchange=startBackend;$('reconnect3').onclick=startBackend;
$('gpu-port3').oninput=()=>{$('reconnect3').hidden=false;};
function workPlane(){const axis=Number($('plane3').value),value=Number($('position3').value),point=[0,0,0],normal=[0,0,0];point[axis]=value;normal[axis]=1;return {axis,value,point,normal};}
function planePoint(e){const p=workPlane();return renderer.plane(e.clientX,e.clientY,p.point,p.normal);}
function boxBounds(a,b){const {axis}=workPlane(),depth=Number($('depth3').value),lo=a.map((x,k)=>Math.min(x,b[k])),hi=a.map((x,k)=>Math.max(x,b[k]));lo[axis]-=depth/2;hi[axis]+=depth/2;return [lo,hi];}
function end(){gesture=null;if(renderer)renderer.preview=null;send({type:'drag-end'});}
function chooseTool(value){end();tool=value;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
  $('tool-description').textContent={orbit:'拖动旋转，滚轮缩放；右键始终旋转视角。',create:'在选定平面拖出矩形，松手生成有厚度的三维物体。',drag:'点住物体表面拖动；弹性材料回弹，塑性材料保留部分形变。',erase:'在物体表面拖动，删除拾取位置附近的粒子。',heat:'按住物体表面加热；温度着色可观察热量传播。',cool:'按住物体表面冷却；水降温并释放潜热后凝固成冰。',anchor:'点击物体表面，固定附近粒子。金色外圈表示已固定。',release:'点击固定位置，释放附近粒子。'}[tool];renderer.workPlane=tool==='create'?workPlane():null;
}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>chooseTool(b.dataset.tool));
function pause(value){paused=value;$('pause3').textContent=paused?'继续':'暂停';send({type:'pause',value});}
$('pause3').onclick=()=>{end();pause(!paused);};
$('reset3').onclick=()=>{end();experiment.reset();modeling?.reset();send({type:'reset',scene:$('scene3').value});};
$('scene3').onchange=()=>{end();experiment.reset();modeling?.reset();if(['planet','million'].includes($('scene3').value)&&$('backend3').value!=='gpu'){$('backend3').value='gpu';startBackend();}else{sceneView();send({type:'reset',scene:$('scene3').value});}const url=new URL(location.href);url.searchParams.set('scene',$('scene3').value);history.replaceState(null,'',url);if($('scene3').value==='thermal'){$('mechanics3').value='0';mechanics();$('heatmap3').checked=true;renderer.heatmap=true;}if($('scene3').value==='compression'){$('mechanics3').value='1';mechanics();}};
$('camera3').onclick=()=>{renderer.yaw=.67;renderer.pitch=.35;renderer.fitDomain();};
$('collapse').onclick=()=>{const closed=$('collapse').closest('aside').classList.toggle('collapsed');$('collapse').textContent=closed?'+':'−';$('collapse').setAttribute('aria-expanded',String(!closed));$('collapse').setAttribute('aria-label',closed?'展开控制面板':'收起控制面板');};
for(const id of ['position3','depth3','cutz3','stiffness3'])$(id).oninput=()=>{
  $(id+'-value').textContent=$(id).value+(id==='stiffness3'?' ×':'');
  if(id==='stiffness3')send({type:'settings',value:{stiffness:Number($(id).value)}});
  if(id==='cutz3')renderer.cutZ=Number($(id).value);
  if(tool==='create')renderer.workPlane=workPlane();
};
$('plane3').onchange=()=>{if(tool==='create')renderer.workPlane=workPlane();};
function modelControls(){
  const custom=$('material3').value==='11',model=Number($('model3').value);$('model3').disabled=!custom;
  $('model-description').textContent=custom?MODELS[model].description:($('material3').value==='4'?'冰使用共旋转弹性，融化后切换 PBF。':'流体使用 PBF，不使用固体本构。');
  $('yield-controls').hidden=!custom||model!==2;$('friction-controls').hidden=!custom||model!==3;
  plasticityUI.update(custom,model);
  pressureUI.update(custom,model);thermalMaterialUI.update(custom,model);phaseUI.update();
}
$('material3').onchange=()=>{$('temperature3').value=MATERIALS[Number($('material3').value)].temp;modelControls();chooseTool('create');};
$('model3').onchange=()=>{modelControls();chooseTool('create');};
for(const [id,suffix] of [['yield3','%'],['friction3','°']])$(id).oninput=()=>$(id+'-value').textContent=$(id).value+suffix;
$('thermal3').onchange=()=>send({type:'settings',value:{thermal:$('thermal3').checked}});
$('heatmap3').onchange=()=>{if($('heatmap3').checked){$('mechanics3').value='0';mechanics();}renderer.heatmap=$('heatmap3').checked;};
$('mechanics3').onchange=mechanics;$('mechanics-max3').oninput=mechanics;
$('press3').onchange=()=>press({enabled:$('press3').checked});
$('press-down3').onclick=()=>press({enabled:true,target:-20});$('press-up3').onclick=()=>press({enabled:true,target:64});$('press-hold3').onclick=()=>press({hold:true});
$('press-target3').oninput=()=>{const target=Number($('press-target3').value);$('press-target3-value').textContent=target;press({enabled:true,target});};
$('press-speed3').oninput=()=>{const speed=Number($('press-speed3').value);$('press-speed3-value').textContent=speed;send({type:'press',value:{speed}});};
$('heatmax3').onchange=()=>renderer.heatMax=Number($('heatmax3').value);
$('cut3').onchange=()=>{renderer.cut=$('cut3').checked;renderer.cutZ=Number($('cutz3').value);};
$('marker-scale3').oninput=()=>{renderer.markerScale=Number($('marker-scale3').value)/100;$('marker-scale3-value').textContent=$('marker-scale3').value+'%';};
$('marker-centers3').onchange=()=>{renderer.markerCenters=$('marker-centers3').checked;};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=e=>{
  if(!renderer)return;e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);
  if(e.button===2||tool==='orbit'){gesture={type:'orbit',x:e.clientX,y:e.clientY};return;}
  if(backendState!=='ready'){toast(backendMessage);return;}
  if(tool==='create'){const p=planePoint(e);if(!p){toast('视线接近平面边缘，请旋转视角后再绘制');return;}gesture={type:'create',start:p};renderer.preview=boxBounds(p,p);return;}
  const point=renderer.pick(e.clientX,e.clientY);if(!point){toast('请点在可见物体表面');return;}
  if(tool==='drag'){if(paused){toast('请先继续模拟，再拖拽变形');return;}gesture={type:'drag',point,normal:renderer.basis().forward};send({type:'drag-start',point,radius:9});}
  else {gesture={type:'brush',point,x:e.clientX,y:e.clientY};send({type:'brush',tool,point,radius:9});lastBrush=performance.now();}
};
canvas.onpointermove=e=>{
  if(!gesture)return;
  if(gesture.type==='orbit'){renderer.orbit(e.clientX-gesture.x,e.clientY-gesture.y);gesture.x=e.clientX;gesture.y=e.clientY;}
  else if(gesture.type==='create'){const p=planePoint(e);if(p)renderer.preview=boxBounds(gesture.start,p);}
  else if(gesture.type==='drag'){const p=renderer.plane(e.clientX,e.clientY,gesture.point,gesture.normal);if(p)send({type:'drag',point:p});}
  else {gesture.x=e.clientX;gesture.y=e.clientY;gesture.point=renderer.pick(e.clientX,e.clientY);}
};
canvas.onpointerup=e=>{
  if(gesture?.type==='create'&&renderer.preview){const [a,b]=renderer.preview;send({type:'box',a,b,...materialOptions()});}
  end();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
};
canvas.onpointercancel=end;canvas.onlostpointercapture=end;
canvas.onwheel=e=>{e.preventDefault();renderer.distance=Math.max(20,Math.min(1600,renderer.distance*Math.exp(e.deltaY*.001)));};
window.addEventListener('keydown',e=>{if(multibody?.active||['INPUT','SELECT','BUTTON','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();pause(!paused);}if(e.key==='Escape')end();});
function animate(now){
  if(multibody?.active)multibody.tick(now);else renderer.draw();workbench?.drawCoordinates();frames++;
  if(gesture?.type==='brush'&&gesture.point&&now-lastBrush>33){send({type:'brush',tool,point:gesture.point,radius:9});lastBrush=now;}
  if(now-lastFps>1000){fps=Math.round(frames*1000/(now-lastFps));frames=0;lastFps=now;}
  if(!multibody?.active&&lastState&&now-lastUi>350){const s=lastState;
    diagnostics(s);workbench?.update(s);
    $('live').textContent=`${paused?'已暂停':'模拟中'} · ${s.count.toLocaleString()} / ${s.capacity.toLocaleString()} 粒子 · ${fps} FPS\nMPM 固体 ${s.solids} · 流体 / 气体 ${s.liquids}\n弹性 ${s.models[0]} · 超弹 ${s.models[1]} · 雪 ${s.models[2]} · 砂 ${s.models[3]}\n理想塑性 ${s.models[4]??0} · 线性强化 ${s.models[5]??0} · JC ${s.models[6]??0} · 简化 JC ${s.models[7]??0}\n岩土 ${s.models[8]??0} · 泡沫 ${s.models[9]??0}\n温度 J2 ${s.models[10]??0} · 蠕变 ${s.models[11]??0}\n${s.renderCount<s.count?`预览 ${s.renderCount.toLocaleString()} / 全量计算 ${s.count.toLocaleString()}\n`:''}${s.gravityMode?`重力：${gravityNames[s.gravityMode]} · ${(s.gravityStrength??1).toFixed(2)}×\n`:''}${s.time.toFixed(1)} s · 物理 ${s.ms.toFixed(1)} ms\n${s.min.toFixed(1)}–${s.max.toFixed(1)}°C · 传热 ${$('thermal3').checked&&!paused?(s.heat/1000).toFixed(2):'0.00'} kJ/步\n总质量 ${s.mass.toFixed(1)} kg · 总焓 ${(s.energy/1e6).toFixed(3)} MJ`;lastUi=now;
  }
  requestAnimationFrame(animate);
}
try{
  renderer=new Renderer3(canvas);
  experiment=installExperiment({send,renderer,toast,materialOptions});
  modeling=installModeling({send,renderer,toast,materialOptions});
  multibody=installProjectWorkspace({renderer,toast,onMode(active){if(active){end();if(worker)pause(true);}else{if(!worker)startBackend();workbench?.connection(backendState,backendMessage);}}});
  workbench=installWorkbench(renderer,()=>multibody?.active?multibody.coordinateContext:{renderer,domain:renderer.domain,unit:'simulation',project:false});
  $('gpu-port3').value=new URLSearchParams(location.search).get('gpuPort')??'8765';
  const requested=new URLSearchParams(location.search).get('scene');if([...$('scene3').options].some(o=>o.value===requested))$('scene3').value=requested;
  if(requested==='compression'){$('mechanics3').value='1';mechanics();}
  if(['planet','million'].includes(requested)||new URLSearchParams(location.search).get('backend')==='gpu')$('backend3').value='gpu';
  if(!multibody.active)startBackend();new ResizeObserver(()=>{if(!multibody.active)renderer.resize();}).observe(canvas);requestAnimationFrame(animate);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fatal('图形连接中断，请刷新三维页面。');});
}catch(e){fatal(e.message);}
