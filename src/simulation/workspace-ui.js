import {contactSqueezeExample} from './contact-squeeze-example.js';
import {interactiveInterval} from './interactive-interval.js';
import {RunMonitor,validateRunTarget,wallTime} from './run-monitor.js';
import {stepStatus} from './step-status.js';
import {contactSafetyExample} from './contact-safety-example.js';
import {fourGPUExample,fourGPUFluidImpactExample,unifiedPBDExample} from '../mixed/four-gpu-model.js';
import {couplingMode,supportsUnifiedPBD,validateCouplingOptions} from './coupling-mode.js';
import {mixedScaleProject,mixedGPUThermalProject,mixedGPUThermomechanicalProject,mixedGPUDissipationProject,mixedGPUEnergyProject} from '../mixed/gpu-model.js';
import {mixedAdapter} from '../mixed/adapter.js';
import {wireUnifiedProject} from './unified-ui.js';
import {wireSimpleWorkspace} from './simple-workspace-ui.js';
import {wireAssistant} from './assistant-ui.js';
import {wireCAD} from './cad-ui.js';
import {wireSurfaceSelections} from './surface-ui.js';
import {namedSurfaceExample} from './surface-example.js';
import {wireProjectArchive} from './project-archive-ui.js';
import {createRunRecord} from './run-record.js';
import {queryProjectResults} from './result-query.js';
import {wireResultQueries} from './result-query-ui.js';
import {wireVV} from './vv-ui.js';
import {cadExample} from './cad-example.js';
import {parseProjectText} from './project-io.js';
import {ResultOrigins} from './workspace-context.js';
import {authoringIssue} from './authoring-preview.js';
import {unifiedExample,unifiedContactExample,particlePairExample} from './unified-example.js';
import {emptyProject,prepareProjectMethods} from './part-builder.js';
import {MIXED,mixedImpactProject,mixedThermalContactProject,editMixedParticles} from '../mixed/model.js';
import {editFEMRigids} from '../fem/rigid-editor.js';
import {cantileverProject,dynamicCantileverProject,impactProject} from '../fem/model.js';
import {wireFEM} from '../fem/ui.js';
import {FEMHistory} from '../fem/dynamic.js';
import {applyStudyVisibility} from './workflow.js';
import {materialContactExample} from './material-contact-example.js';
import {contactExample} from './contact-example.js';
import {wireThermal} from './thermal-ui.js';
import {femThermalExample,mpmPartThermalExample} from './part-thermal-example.js';
import {wireContacts} from './contact-ui.js';
import {preset} from '../multibody/presets.js';
import {norm} from '../multibody/model.js';
import {couplingPanel,wireCoupling,coupledCSV} from '../multibody/coupling-ui.js';
import {ProjectSession,SolverRegistry} from './session.js';
import {removePart,emptyCoupling,fromLegacy,editLegacyProject} from './project.js';
import {wireReferences} from './reference-ui.js';
import {referenceExample} from './reference-example.js';
import {gripExample} from './grip-example.js';
import {stagedExample} from './staged-example.js';
import {wireCurves} from './curve-ui.js';
import {thermalExample} from './thermal-example.js';
import {wireAttachments} from './attachment-ui.js';
import {wireValidation} from './validation-ui.js';
import {partField,projectCSV} from './results.js';
import {bicycle,bicycleWall,bicycleCourse,bicycleRamps} from '../multibody/bicycle.js';
// Panels are mounted into the common workflow. Navigation never owns physics.
export function installProjectWorkspace({renderer:particleView,toast,onMode}){
  const $=id=>document.getElementById(id),main=document.querySelector('main');
  const query=new URLSearchParams(location.search),requestedPreset=query.get('mbd');
  const initialPreset=['named-surfaces','cad-hole','unified-pbd','unified-fluid-impact','particle-pairs','contact-squeeze','contact-safety','unified-gpu','unified-contact','unified','mpm-fem-energy','mpm-fem-dissipation','mpm-fem-thermomechanical','mpm-fem-gpu-thermal','mpm-fem-10k','mpm-fem-50k','mpm-fem-thermal-contact','mpm-fem-impact','fem-thermal','mpm-part-thermal','fem-impact','fem-release','fem-cantilever','material-impact','contact-slide','staged-thermal','thermal-grip','thermal-release','grip-stretch','grip-twist','references','pelican-ramps','pelican-course','pelican-climb','pelican-wall','pelican','coupling','pendulum','crank','suspension','collision','empty'].includes(requestedPreset)?requestedPreset:query.get('scene')==='empty'?'empty':'pendulum';
  const option=(value,text)=>`<option value="${value}">${text}</option>`;
  const field=(id,label,value,type='number')=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" ${type==='number'?'step="any"':''} value="${value}">`;
  const select=(id,label,options)=>`<label for="${id}">${label}</label><select id="${id}">${options.map(o=>option(...o)).join('')}</select>`;
  const vec=(id,label,v)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((axis,i)=>`<label>${axis}<input id="${id}${i}" aria-label="${label} ${axis}" type="number" step="any" value="${v[i]}"></label>`).join('')}</div>`;
  const folder=(id,title,content)=>`<details id="${id}" class="instrument"><summary>${title}</summary>${content}</details>`;
  const panels=document.createElement('div');panels.id='mbd-panels';
  panels.innerHTML=folder('mbd-setup','机构与求解',
    '<p class="hint">多刚体约束动力学 · SI 单位（m、kg、s、rad）。可添加 MPM 试样并启用双向力热耦合；切换目录保留状态。</p>'+select('mbd-preset','机构算例',[['coupling','热压头 · MPM · 温度场耦合'],['pendulum','双摆'],['crank','电机驱动曲柄滑块'],['suspension','弹簧阻尼悬架'],['collision','刚体接触与碰撞'],['empty','自定义机构']])+'<button id="mbd-load">载入机构算例</button>'+vec('mbd-gravity','多体重力（m/s²）',[0,-9.81,0])+select('mbd-dt','多体时间步',[['0.008333333333333333','1/120 s'],['0.004166666666666667','1/240 s'],['0.0020833333333333333','1/480 s']])+field('mbd-iterations','约束迭代次数',12)+'<button id="mbd-settings">应用求解设置并重置</button>'+field('mbd-duration','追加多体求解时长（s）',10)+'<div class="buttons"><button id="mbd-run">运行多体</button><button id="mbd-step">多体单步</button></div><p class="hint">每次运行到目标时间自动暂停，累计最多 60 s。模型编辑会重置本工作区的运动和曲线。动画回放不重新求解。</p><p id="mbd-engine-status" role="status" class="hint">正在加载多体引擎…</p>')+
  folder('mbd-body-panel','刚体与质量',select('mbd-body-edit','编辑刚体',[])+'<button id="mbd-body-fill">读取所选刚体参数</button>'+field('mbd-body-name','刚体名称','新刚体','text')+select('mbd-body-type','刚体运动类型',[['dynamic','自由刚体'],['fixed','固定刚体']])+select('mbd-body-shape','刚体形状',[['box','长方体'],['sphere','球（等径）'],['cylinder','Y 轴圆柱']])+vec('mbd-body-size','刚体尺寸（m，直径/高度）',[1,1,1])+vec('mbd-body-position','刚体中心（m）',[0,3,0])+vec('mbd-body-rotation','刚体旋转（度，XYZ）',[0,0,0])+field('mbd-body-mass','刚体质量（kg）',1)+'<p class="hint">均匀实心体，惯量由质量和形状自动计算。球的三轴直径须相等；圆柱 X、Z 直径须相等。</p><div class="buttons"><button id="mbd-body-add">添加刚体</button><button id="mbd-body-update">更新所选刚体</button></div><button id="mbd-body-remove">删除所选刚体及其连接</button>')+
  folder('mbd-joint-panel','运动副与驱动',select('mbd-joint-a','连接刚体 A',[])+select('mbd-joint-b','连接刚体 B',[])+select('mbd-joint-type','运动副类型',[['revolute','转动副'],['prismatic','移动副'],['spherical','球铰'],['fixed','固定副'],['spring','弹簧阻尼']])+vec('mbd-joint-anchor','世界连接点（m）',[0,4,0])+select('mbd-joint-axis','世界连接轴',[['z','Z'],['x','X'],['y','Y']])+'<div id="mbd-spring-fields" hidden>'+vec('mbd-joint-anchor-b','弹簧 B 端世界坐标（m）',[0,2,0])+field('mbd-spring-length','弹簧原长（m）',2)+field('mbd-spring-k','弹簧刚度（N/m）',100)+field('mbd-spring-c','弹簧阻尼（N·s/m）',2)+'</div><div id="mbd-unit-fields"><label class="check"><input id="mbd-limits" type="checkbox">启用运动副限位</label>'+field('mbd-limit-min','运动副下限（rad 或 m）',-1)+field('mbd-limit-max','运动副上限（rad 或 m）',1)+select('mbd-motor','运动副驱动',[['none','无驱动'],['velocity','速度驱动'],['position','位置驱动']])+field('mbd-motor-target','目标（rad、m 或对应每秒）',1)+field('mbd-motor-k','驱动刚度',100)+field('mbd-motor-c','驱动阻尼',10)+'</div><p class="hint">转动副角度使用 rad；移动副使用 m。驱动通过约束施力，不直接覆盖位置。允许不同初始姿态；参考点连接以各端局部坐标定义，共用世界连接轴。连接体之间默认关闭碰撞。</p><button id="mbd-joint-add">添加连接并重置</button>'+select('mbd-joint-edit','已有连接',[])+'<p id="mbd-joint-info" class="hint"></p><button id="mbd-joint-remove">删除所选连接</button>')+
  folder('mbd-load-panel','初始条件与外载荷',select('mbd-load-body','载荷作用刚体',[])+'<button id="mbd-load-fill">读取载荷参数</button>'+vec('mbd-velocity','多体初速度（m/s）',[0,0,0])+vec('mbd-angular','多体初始角速度（rad/s）',[0,0,0])+vec('mbd-force','世界坐标恒力（N）',[0,0,0])+vec('mbd-torque','世界坐标恒力矩（N·m）',[0,0,0])+field('mbd-friction','刚体摩擦系数',.5)+field('mbd-restitution','刚体恢复系数',0)+field('mbd-damping','刚体线性/角阻尼（1/s）',0)+'<button id="mbd-load-apply">应用载荷并重置</button><p class="hint">恒力作用于质心。力矩、重力、运动副驱动共同进入动力学求解；接触使用库伦摩擦和恢复系数。</p>')+
  couplingPanel({folder,field,select,vec})+
  folder('mbd-results-panel','多体结果与回放',select('mbd-result-body','结果刚体',[])+select('mbd-result-field','多体曲线变量',[['temperature','部件温度（°C）'],['particleTemperature','MPM 平均温度（°C）'],['particleMaxTemperature','MPM 最高温度（°C）'],['contactForce','粒子接触力大小（N）'],['contactHeatRate','刚体接触热流（W）'],['thermalResidual','热量平衡残差（J）'],['particlePlastic','MPM 最大塑性应变'],['plastic','部件塑性应变'],['count','部件粒子数'],['dy','Y 位移（m）'],['dx','X 位移（m）'],['dz','Z 位移（m）'],['speed','速度大小（m/s）'],['omega','角速度大小（rad/s）'],['acceleration','加速度大小（m/s²）'],['kinetic','刚体动能（J）'],['energy','刚体与弹簧机械能（J）'],['coordinate','运动副坐标（rad 或 m）'],['error','连接点约束误差（m）'],['springForce','弹簧轴力估计（N）']])+select('mbd-result-joint','结果连接',[])+'<canvas id="mbd-chart" aria-label="部件时程曲线"></canvas><p id="mbd-coupling-readout" class="hint" role="status"></p><p id="mbd-result-readout" class="hint" role="status"></p><label class="check"><input id="mbd-trace" type="checkbox" checked>显示所选部件质心轨迹</label><div class="buttons"><button id="project-export-results">导出全部部件 CSV</button><button id="mbd-export-coupling">导出耦合时程 CSV</button><button id="mbd-export-particles">导出当前粒子 CSV</button><button id="mbd-export-csv">导出刚体运动 CSV</button><button id="mbd-export-joints">导出连接 CSV</button></div><p class="hint">每秒约 60 帧记录，曲线点击可定位回放帧。加速度为相邻物理步速度差分；初帧未计算。刚体与弹簧机械能不含 MPM；启用诊断后可选择统一机械能。耦合粒子回放按内存预算调整采样频率。热量残差检验传热与热源收支，不包含摩擦或塑性耗散生热。暂未输出完整关节反力。</p>')+
  folder('mbd-model-panel','模型保存与编辑','<p class="hint">可编辑完整刚体、连接、限位、驱动及载荷参数；校验通过后才替换当前多体模型。</p><div class="buttons"><button id="mbd-json-refresh">读取当前模型</button><button id="mbd-export-json">保存模型 JSON</button></div><label for="mbd-json">多体模型 JSON</label><textarea id="mbd-json" spellcheck="false" rows="14"></textarea><button id="mbd-json-apply">应用 JSON 并重置</button><p class="hint">最多 64 个刚体、128 个连接；耦合模式最多 16384 粒子。支持 MPM 双向接触及温度交换；支持理想齿轮 / 链传动；未实现 HHT 和完整关节反力。</p>');
  panels.insertAdjacentHTML('beforeend',folder('assembly-panel','参数化刚体装配',
    '<p class="hint">用内置基础体、转动副和理想链传动生成可编辑的鹈鹕自行车。双腿通过闭环关节求解；直线导向限制侧翻，不包含自主平衡。</p>'+field('assembly-radius','车轮半径（m）',.62)+field('assembly-wheelbase','前后轴距（m）',2.1)+field('assembly-rpm','踩踏频率（rpm）',24)+field('assembly-ratio','链传动比（后轮 / 曲柄）',1.6)+vec('assembly-origin','装配原点（m）',[0,0,0])+select('assembly-mode','骑行方式',[['guided','直线导向骑行'],['planar','平面骑行 · 允许升降与俯仰'],['stand','固定支架踩踏']])+'<button id="assembly-build">生成鹈鹕自行车新项目</button><p class="hint">生成会替换当前项目；先保存需要保留的模型。所有部件、连接和外形均可在原有目录编辑。</p><label class="check"><input id="assembly-follow" type="checkbox" checked>相机跟随车架</label><label class="check"><input id="assembly-colliders" type="checkbox">查看碰撞体</label><label class="check"><input id="assembly-joints" type="checkbox">显示关节点</label><p id="assembly-status" class="hint" role="status"></p>'));
  $('controls').append(panels);
  $('mbd-body-edit').setAttribute('aria-describedby','mbd-body-empty');
  $('mbd-body-edit').insertAdjacentHTML('afterend','<p id="mbd-body-empty" class="hint" role="status" hidden>当前项目没有刚体。请在下方填写参数并点击“添加刚体”，添加后即可在此选择。</p>');
  $('mbd-preset').insertAdjacentHTML('afterbegin',option('pelican-ramps','鹈鹕自行车 · 双坡深水池')+option('pelican','鹈鹕骑自行车')+option('pelican-wall','鹈鹕自行车 · MPM 撞墙试验')+option('pelican-climb','鹈鹕自行车 · 前轮牵引攀墙')+option('pelican-course','鹈鹕自行车 · 攀墙 / 涉水 / 破墙'));
  $('assembly-build').insertAdjacentHTML('afterend',field('assembly-gap','前轮至墙面净距（m）',1.8)+vec('assembly-wall-size','墙尺寸（m：X 厚 / Y 高 / Z 宽）',[.4,2.4,1.2])+select('assembly-wall-law','墙体本构',[['0','共旋转弹性'],['4','理想弹塑性 · J2'],['9','泡沫金属 · Deshpande–Fleck'],['10','温度相关 J2 塑性']])+field('assembly-wall-stiffness','墙体刚度倍率（0.25–40）',24)+'<button id="assembly-build-wall">生成自行车撞 MPM 墙新项目</button><p class="hint">自动扩大计算域至 9 × 4.4 × 3.2 m；网格 0.2 m，每格 8 点。墙底面固定，接触反力返回自行车。默认关闭传热，可在载荷与边界启用。</p>');
  $('assembly-build-wall').insertAdjacentHTML('beforebegin','<label class="check"><input id="assembly-climb" type="checkbox" checked>允许沿倒墙攀爬（释放高度与俯仰）</label><label class="check"><input id="assembly-front-drive" type="checkbox" checked>前轮辅助驱动</label>'+field('assembly-pedal-gain','踏板驱动增益（1–1000）',64)+field('assembly-front-torque','前轮传动力矩上限（N·m）',40)+field('assembly-traction','轮胎与 MPM 摩擦系数（0–2）',1.2)+'<p class="hint">攀爬使用平面约束、相对车架的传动和接触摩擦；不预设抬轮轨迹。关闭前轮驱动可比较被动前轮。增大踏板驱动增益可提高低速牵引；打滑或坡度过大仍会停住。</p>');
  $('assembly-panel').insertAdjacentHTML('beforeend', '<details><summary>三段路线 · 水池与破坏墙</summary>'+field('course-water-depth','水池深度（m）',1)+'<label class="check"><input id="course-fill-gap" type="checkbox" checked>水池填满两墙间距</label>'+field('course-water-length','水池长度（m）',5.33)+field('course-wall-x','末端墙位置 X（m）',9.2)+field('course-onset','起裂拉伸应变',.08)+field('course-failure','完全失效拉伸应变',.16)+'<button id="assembly-build-course">生成攀墙、涉水、破墙项目</button><p class="hint">默认填充高度 1.00 m，高于车轮轴心 0.62 m；填满两墙间距时长度自动匹配，两面 MPM 墙作为水池端壁。三组独立粒子：MPM 攀爬墙、PBF 水池、脆性 MPM 墙。失效材料转为无黏聚摩擦 MPM，保留质量和速度。计算域 12 × 4.4 × 3.2 m，网格 0.2 m，每格 8 点。损伤为演示模型，阈值需按材料标定。</p></details>');
  $('assembly-panel').querySelector('summary').insertAdjacentHTML('afterend','<details open><summary>双坡水池 · 稳定坡道</summary>'+field('ramps-angle','坡道角度（°）',34)+field('ramps-water-depth','初始注水高度（m）',.9)+field('ramps-water-friction','水与刚体的切向接触系数',.15)+field('ramps-drive-gain','涉水辅助驱动增益',400)+field('ramps-wheel-torque','每轮辅助力矩上限（N·m）',250)+'<label class="check"><input id="ramps-pitch-support" type="checkbox" checked>启用俯仰助稳弹簧</label><button id="assembly-build-ramps">生成双坡深水池项目</button><p class="hint">固定刚体坡道连接路面与下沉 1.2 m 的池底。默认 34°，分层注水贴合坡面，默认水深 0.90 m，高于半个车轮。前后轮由转矩驱动；坡道、池底与侧壁均可在原有几何目录编辑。</p></details>');
  $('mbd-body-shape').insertAdjacentHTML('beforeend',option('disc','Z 轴车轮 / 圆盘')+option('torus','Z 轴空心轮胎（外径 / 外径 / 管径）'));
  $('mbd-body-panel').insertAdjacentHTML('beforeend',field('mbd-collision-family','碰撞组（0 全部碰撞；同一非零组互不碰撞）',0)+'<label for="mbd-appearance">组合显示外形（局部坐标 JSON）</label><textarea id="mbd-appearance" rows="7" spellcheck="false"></textarea><p class="hint">支持 box、sphere（可拉伸）、cylinder、cone、torus。每项含 position、size、rotation、color。留空使用碰撞体外形；质量、惯量和接触由上方碰撞体尺寸决定。</p>');
  $('mbd-joint-type').insertAdjacentHTML('beforeend',option('planar','平面副 · 轴为平面法向')+option('gear','理想齿轮 / 链传动'));
  $('mbd-joint-add').insertAdjacentHTML('beforebegin','<div id="mbd-gear-fields" hidden>'+select('mbd-gear-carrier','传动参考机架',[])+field('mbd-gear-ratio','传动比（B / A；负数反向）',1.6)+field('mbd-gear-torque','输出力矩上限（N·m）',80)+field('mbd-gear-stiffness','传动扭转刚度（N·m/rad）',800)+field('mbd-gear-damping','传动扭转阻尼（N·m·s/rad）',8)+'<p class="hint">两轴须平行并由转动副支承。机架可俯仰时请选择参考机架，传动按相对角速度求解并返回机架反力矩；不模拟链节接触。</p></div>');
  $('mbd-result-field').insertAdjacentHTML('beforeend',option('damage','部件最大损伤（0–1）')+option('failed','部件失效粒子数')+option('phaseError','传动相位误差（rad）')+option('speedError','传动速比误差（rad/s）')+option('transmittedTorque','传动输出力矩（N·m）')+option('regionForce','区域连接反力（N）')+option('regionTorque','区域连接力矩（N·m）')+option('power','区域连接净功率（W）')+option('work','区域连接累计净功（J）')+option('elasticEnergy','区域连接弹性能（J）'));
  $('mbd-preset').insertAdjacentHTML('beforeend',option('named-surfaces','命名孔壁 · 压力与加热')+option('cad-hole','SMLib CAD · 打孔块 MPM')+option('particle-pairs','MPM–PBF 接触对 · 热块推水')+option('contact-squeeze','多体挤压 · 双球夹持 FEM 板')+option('contact-safety','高速撞板 · 40 m/s 球 / 5 mm 固定薄板')+option('unified-pbd','Unified PBD · 四方法混合耦合')+option('unified-fluid-impact','MPM–PBF · GPU 双向碰撞')+option('unified-gpu','四方法 GPU · 热球 / MPM / PBF / FEM')+option('mpm-fem-energy','MPM–FEM · GPU 能量诊断')+option('mpm-fem-dissipation','MPM–FEM · 滑动撞击与耗散生热')+option('mpm-fem-thermomechanical','MPM–FEM · 热压板接触加热与卸载')+option('mpm-fem-gpu-thermal','MPM–FEM · GPU 加热与冷却')+option('mpm-fem-10k','MPM–FEM · 10,000 粒子撞板')+option('mpm-fem-50k','MPM–FEM · 50,000 粒子撞板')+option('mpm-fem-thermal-contact','MPM–FEM · 热块持续接触薄板')+option('mpm-fem-impact','MPM–FEM · 热块撞击弹性梁')+option('fem-thermal','FEM · 热传导与受约束膨胀')+option('mpm-part-thermal','MPM · 部件热源与冷却')+option('fem-impact','刚体–FEM · 小球撞击弹性梁')+option('fem-release','FEM · 悬臂梁弯曲后释放')+option('fem-cantilever','FEM · 悬臂梁静力弯曲')+option('references','参考点连接与 MPM 区域固定')+option('grip-stretch','夹具拉伸 MPM 试样')+option('grip-twist','夹具扭转 MPM 试样')+option('thermal-grip','热夹具 · 温度相关扭转')+option('thermal-release','加热熔化 · 夹持释放')+option('staged-thermal','分阶段试验 · 加热 / 扭转 / 卸载 / 冷却')+option('contact-slide','热压头 · 压紧 / 滑动 / 分离')+option('material-impact','冷热块 · 碰撞 / 滑动 / 传热'));$('mbd-preset').value=initialPreset;$('mbd-result-field').value='dy';$('coupling-ppc').value='2';$('coupling-law').value='10';
  const canvas=document.createElement('canvas');canvas.id='mbd-world';canvas.tabIndex=0;canvas.hidden=true;canvas.setAttribute('aria-label','统一项目三维画布');main.prepend(canvas);
  const hud=document.createElement('div');hud.id='mbd-summary';hud.className='summary';hud.hidden=true;hud.innerHTML='<span class="eyebrow">PROJECT / MECHANICS / THERMAL</span><h1 id="mbd-title">统一项目</h1><p id="mbd-statistics" role="status"></p><p id="project-run-progress" role="status" hidden></p>';main.append(hud);hud.insertAdjacentHTML('beforeend','<p id="mbd-impact-readout" role="status" hidden></p>');
  const transport=document.createElement('div');transport.className='mbd-transport buttons';transport.hidden=true;transport.innerHTML='<button id="mbd-toggle">运行</button><button id="mbd-reset">重置多体</button><button id="mbd-fit">多体视角</button>';document.querySelector('header').append(transport);
  const timeline=document.createElement('div');timeline.id='mbd-timeline';timeline.hidden=true;timeline.innerHTML='<div class="buttons"><button id="mbd-replay">回放动画</button><button id="mbd-live">回到求解末帧</button><select id="mbd-replay-speed" aria-label="回放速度"><option value=".0005">0.0005× · 慢动作</option><option value=".01">0.01× · 慢动作</option><option value=".25">0.25×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><label for="mbd-frame">回放时间</label><input id="mbd-frame" type="range" min="0" max="0" value="0" step="1"><output id="mbd-frame-time"></output>';main.append(timeline);
  let active=false,view=null,engine=null,sim=null,history=null,frame=null,model=preset(['named-surfaces','cad-hole','unified-pbd','unified-fluid-impact','particle-pairs','contact-squeeze','contact-safety','unified-gpu','unified-contact','unified','mpm-fem-energy','mpm-fem-dissipation','mpm-fem-thermomechanical','mpm-fem-gpu-thermal','mpm-fem-10k','mpm-fem-50k','mpm-fem-thermal-contact','mpm-fem-impact','fem-thermal','mpm-part-thermal','fem-impact','fem-release','fem-cantilever','material-impact','contact-slide','staged-thermal','thermal-grip','thermal-release','references','grip-stretch','grip-twist'].includes(initialPreset)?'coupling':initialPreset),running=false,replaying=false,cursor=null,endTime=0,lastNow=0,budget=0,playTime=0,lastUI=0,loading=null;
  let femUI=null,femSolving=false,unifiedUI=null,simpleUI=null,assistantUI=null,cadUI=null,surfaceUI=null,archiveUI=null,resultQueryUI=null,vvUI=null,batchStarted=0;
  const monitor=new RunMonitor();
  const runWindow=document.createElement('section');runWindow.id='project-run-window';runWindow.setAttribute('aria-label','模拟控制与进度');
  runWindow.innerHTML=`<details open><summary id="run-window-title">时间设置</summary><div class="run-fields">${field('run-target','模拟结束时间（s）',2)}${field('run-dt','最大时间步 Δt（s）',.0002)}</div><div class="buttons"><button id="run-apply-dt">应用时间步并重置</button><button id="run-extend">目标 +1 s</button></div><p id="run-help">结束时间从 t=0 起算；增大 Δt 不会延长模拟。改步长需重置，接触保护仍可自动缩小步长。</p></details><div class="buttons"><button id="run-start">运行至目标</button><button id="run-pause">暂停计算</button></div><p id="run-state" role="status"></p><progress id="run-bar" max="100" value="0" aria-label="模拟进度"></progress><output id="run-time"></output><p id="run-speed"></p><details><summary id="run-details-title">时间步与耗时明细</summary><p id="run-diagnostics"></p></details>`;
  panels.append(runWindow);runWindow.append($('project-run-progress'));
  $('run-help').insertAdjacentHTML('beforebegin','<p id="run-step-status" role="status" aria-live="polite"></p>');
  $('run-help').insertAdjacentHTML('afterend','<p id="run-framework" role="status" hidden></p>');
  $('run-framework').insertAdjacentHTML('afterend',`<details open id="run-coupling-panel"><summary id="run-coupling-title">耦合方式</summary><label for="run-coupling-mode">耦合算法</label><select id="run-coupling-mode"><option value="native">原有耦合 · 冲量 + 位置修正</option><option value="unified-pbd">Unified PBD · 混合耦合（实验）</option></select>${field('run-pbd-iterations','PBD 迭代次数',6)}<button id="run-apply-coupling">应用耦合方式并重置</button><p id="run-coupling-status" role="status"></p><p id="run-coupling-help"></p></details>`);
  let recorded=false,followPosition=null,pendingStep=null,pendingLoad=null,computeError='',referenceUI=null,attachmentUI=null,validationUI=null,curvesUI=null,contactUI=null,thermalUI=null;
  const initialAdapter=query.get('projectBackend')==='gpu'?'taichi-coupled':'cpu-coupled';
  const read=id=>[0,1,2].map(i=>$(id+i).valueAsNumber),num=id=>$(id).valueAsNumber,put=(id,v)=>v.forEach((x,i)=>$(id+i).value=x);
  const resultOrigins=new ResultOrigins();
  function recordFrame(f,force=false){
    if(!history||!f)return;
    resultOrigins.capture(f,sim.document);
    const previous=history.frames.at(-1);
    const previousSample=history.samples?.at(-1);
    history.record(f,force);
    const saved=history.frames.at(-1);
    if(saved!==previous)resultOrigins.alias(saved,f);
    const sample=history.samples?.at(-1);if(sample!==previousSample)resultOrigins.alias(sample,f);
  }
  function queryResults(args){const displayed=displayFrame();return queryProjectResults({project:sim.document,frame:displayed,resultProject:resultOrigins.get(displayed),frames:(history?.samples??history?.frames??[]).map(f=>({frame:f,resultProject:resultOrigins.get(f)}))},args);}
  const runOutcome=()=>computeError?'error':frame?.fem?.analysis==='linear-static'&&frame.fem.solved||frame?.time>=Number($('run-target').value)-1e-10?'completed':'paused';
  function runRecord(outcome){return createRunRecord({project:sim?.document,frame,resultProject:resultOrigins.get(frame),outcome:outcome??runOutcome(),targetTime:Number($('run-target').value)});}
  let archivedFrame=null,archivedOutcome=null;
  function storeRun(outcome=runOutcome()){if(!archiveUI||!frame||frame.preview||frame===archivedFrame&&outcome===archivedOutcome)return;const record=runRecord(outcome);if(!record)return;archivedFrame=frame;archivedOutcome=record.outcome;void archiveUI.recordRun(record);}
  const guard=fn=>async()=>{try{if(pendingLoad)throw Error('项目正在加载，请稍候');await fn();if(pendingLoad)await pendingLoad;}catch(e){running=false;replaying=false;toast(e.message);$('mbd-engine-status').textContent=e.message;}};
  function resetRunControls(){
    monitor.reset();endTime=0;
    if($('project-run-panel'))$('project-run-panel').open=true;
    $('run-target').value=Math.min(60,sim.time+(sim.project.solver.duration??2));
    $('run-dt').value=sim.project.solver.dt;
    $('run-coupling-mode').value=couplingMode(sim.project.solver);
    $('run-pbd-iterations').value=sim.project.solver.pbdIterations??6;
  }
  function updateRunControls(){
    runWindow.hidden=frame.fem?.analysis==='linear-static';if(runWindow.hidden)return;
    const en=document.documentElement.lang==='en',t=(zh,enText)=>en?enText:zh;
    const waiting=pendingStep&&batchStarted?(performance.now()-batchStarted)/1000:0;
    const target=running||pendingStep?endTime:num('run-target'),live=frame.time,stats=monitor.read(live,target,waiting);
    const state=computeError?t('计算失败：','Failed: ')+computeError:pendingLoad?t('正在加载…','Loading…'):pendingStep?t(running?'正在计算':'等待当前批次结束后暂停',running?'Computing':'Pausing after current batch'):running?t('正在计算','Computing'):live>=target-1e-9?t('已到达目标','Target reached'):t('已暂停 / 就绪','Paused / ready');
    $('run-state').textContent=state+(replaying||cursor!=null?t(' · 当前画面为回放，以下为真实求解进度',' · Viewing replay; progress below is live'):'');
    $('run-bar').value=stats.percent;
    $('run-time').textContent=`${stats.percent.toFixed(1)}% · ${live.toFixed(5)} / ${Number.isFinite(target)?target.toFixed(5):'—'} s`;
    $('run-speed').textContent=`${t('计算用时','Compute time')} ${wallTime(stats.elapsed)} · ${t('本批等待','Batch wait')} ${wallTime(waiting)}\n${t('近期速度','Recent rate')} ${stats.rate?stats.rate.toExponential(2)+' sim s / wall s':'—'}\n${t('剩余估计（随接触变化）','Estimated remaining (contact dependent)')} ${wallTime(stats.eta)}`;
    const clock=frame.mixed?.clock,perf=frame.mixed?.performance,safety=frame.mixed?.contactSafety,actual=clock?(clock.steps>0?clock.minDt:null):(frame.fem?.dynamics?.lastDt||null);
    const stepInfo=stepStatus({requested:sim.project.solver.dt,draft:num('run-dt'),clock,dynamics:frame.fem?.dynamics,en});
    $('run-step-status').textContent=stepInfo.status;
    const framework=frame.mixed?.framework;
    $('run-framework').hidden=!framework;
    if(framework)$('run-framework').textContent=t('MPM 统一主框架 · Taichi CUDA','MPM unified framework · Taichi CUDA')+'\n'+framework.domains.map(d=>`${d.method.toUpperCase()} (${d.count})`).join(' / ')+'\n'+t('统一设备数据视图、时间推进、接触传热与失败回滚；保留各域原有算法。','Shared device views, stepping, contact, heat and rollback; native domain algorithms retained.');
    const pbdSupported=supportsUnifiedPBD(sim.project),pbdDraft=$('run-coupling-mode').value==='unified-pbd',busy=running||!!pendingStep||!!pendingLoad;
    $('run-coupling-mode').options[1].disabled=!pbdSupported;
    $('run-coupling-mode').disabled=busy;
    $('run-pbd-iterations').disabled=busy||!pbdDraft;
    $('run-apply-coupling').disabled=busy;
    const modeName=m=>m==='unified-pbd'?'Unified PBD':t('原有冲量耦合','Native impulse coupling');
    const dirty=$('run-coupling-mode').value!==couplingMode(sim.project.solver)||(pbdDraft&&num('run-pbd-iterations')!==(sim.project.solver.pbdIterations??6));
    $('run-coupling-status').textContent=t('已应用：','Applied: ')+modeName(framework?.couplingMode??couplingMode(sim.project.solver))+(framework?.couplingMode==='unified-pbd'?` · ${framework.pbdIterations} `+t('次迭代','iterations'):'')+(dirty?t('；有未应用更改，需重置。','; unapplied changes require reset.'):'');
    $('run-coupling-help').textContent=pbdSupported?t('PBD 将流体密度与四方接触交替投影，保留 MPM/FEM 本构、传热和稳定步长限制。MPM–PBF 仍为无摩擦接触；其他接触使用速度层摩擦。此混合实现不等同于完整 FleX，也不保证更快。','PBD interleaves fluid density and four-domain contact projections. Native MPM/FEM laws, heat and time-step limits remain. MPM–PBF contact is free-slip; other contacts use velocity-level friction. This hybrid is not full FleX and is not necessarily faster.'):t('Unified PBD 目前支持四方法 Taichi GPU：MPM、FEM、PBF、球形刚体各一个。','Unified PBD currently requires a four-domain Taichi GPU project: one MPM, FEM, PBF and spherical rigid part.');
    $('run-coupling-title').textContent=t('耦合方式','Coupling method');
    $('run-apply-coupling').textContent=t('应用耦合方式并重置','Apply coupling & reset');
    document.querySelector('label[for="run-coupling-mode"]').textContent=t('耦合算法','Coupling algorithm');
    document.querySelector('label[for="run-pbd-iterations"]').textContent=t('PBD 迭代次数','PBD iterations');
    $('run-coupling-mode').options[0].textContent=t('原有耦合 · 冲量 + 位置修正','Native · impulse + position correction');
    $('run-coupling-mode').options[1].textContent=t('Unified PBD · 混合耦合（实验）','Unified PBD · hybrid (experimental)');
    $('run-diagnostics').textContent=`${t('用户提交上限','User-submitted maximum')} ${sim.project.solver.dt.toExponential(3)} s\n${t('实际步长（上一批）','Actual step (last batch)')} ${actual?.toExponential(3)??'—'}${actual&&clock?.maxDt?' – '+clock.maxDt.toExponential(3):''} s\n${t('接触重算次数（上一批）','Contact retries (last batch)')} ${safety?.retries??'—'}\n${t('求解 / 回传准备','Solve / output preparation')} ${perf?perf.solverMs.toFixed(1)+' / '+perf.snapshotMs.toFixed(1)+' ms':'—'}\n${t('首次运行可能包含编译；回传准备不含网络和绘制。','First run may include compilation; output preparation excludes network and rendering.')}`;
    $('run-start').disabled=running||!!pendingStep||!!pendingLoad;
    if(safety)$('run-diagnostics').textContent+='\nCCD: '+(safety.algorithm==='interval-separation-v2'?t('区间分离 v2（已更新）','Interval separation v2 (updated)'):t('旧检测器 / 当前后端未提供版本','Legacy detector / backend version unavailable'));
    if(stepInfo.detail)$('run-diagnostics').textContent+='\n'+stepInfo.detail;
    $('run-pause').disabled=!running;
    for(const id of ['run-dt','run-apply-dt'])$(id).disabled=running||!!pendingStep||!!pendingLoad;
    for(const id of ['run-target','run-extend'])$(id).disabled=!!pendingLoad;
    const labels={'run-window-title':['时间设置','Time settings'],'run-start':['运行至目标','Run to target'],'run-pause':['暂停计算','Pause'],'run-apply-dt':['应用时间步并重置','Apply step & reset'],'run-extend':['目标 +1 s','Target +1 s'],'run-details-title':['时间步与耗时明细','Step & timing details'],'run-help':['结束时间从 t=0 起算；增大 Δt 不会延长模拟。改步长需重置，接触保护仍可自动缩小步长。','End time is measured from t=0. A larger step does not extend duration. Applying a step resets the simulation; contact protection may reduce it.']};
    for(const [id,words] of Object.entries(labels))$(id).textContent=t(...words);
    document.querySelector('label[for="run-target"]').textContent=t('模拟结束时间（s）','Simulation end time (s)');document.querySelector('label[for="run-dt"]').textContent=t('最大时间步 Δt（s）','Maximum time step Δt (s)');
  }
  $('run-start').onclick=guard(()=>run());
  $('run-dt').oninput=()=>updateUI();
  $('run-coupling-mode').onchange=()=>updateUI();
  $('run-pbd-iterations').oninput=()=>updateUI();
  $('run-apply-coupling').onclick=guard(async()=>{
    if(running||pendingStep)throw Error('请先暂停并等待当前批次结束');
    const p=sim.project;p.solver.couplingMode=$('run-coupling-mode').value;
    if(p.solver.couplingMode==='unified-pbd')p.solver.pbdIterations=num('run-pbd-iterations');
    validateCouplingOptions(p.solver);await load(p);toast('耦合方式已应用，模拟已重置到 t=0');
  });
  $('run-pause').onclick=()=>{running=false;recordFrame(frame,true);updateUI();};
  $('run-apply-dt').onclick=guard(async()=>{
    if(running||pendingStep)throw Error('请先暂停并等待当前批次结束');
    const dt=num('run-dt'),target=validateRunTarget(num('run-target'),0);
    if(!Number.isFinite(dt)||dt<1e-7||dt>.02)throw Error('时间步须为 1e-7–0.02 s');
    const p=sim.project;p.solver.dt=dt;p.solver.duration=target;await load(p);toast('时间步已应用，模拟已重置到 t=0');
  });
  const changeTarget=()=>{
    try{const target=validateRunTarget(num('run-target'),sim.time);if((running||pendingStep)&&target<endTime)throw Error('运行中可延长目标；缩短目标请先暂停');if(running||pendingStep)endTime=target;}
    catch(e){$('run-target').value=endTime>sim.time?endTime:Math.min(60,sim.time+1);toast(e.message);}
    updateUI();
  };
  $('run-target').onchange=changeTarget;
  $('run-extend').onclick=()=>{$('run-target').value=Math.min(60,Math.max(sim.time,num('run-target')||0)+1);changeTarget();};
  function selectOptions(id,items){
    const select=$(id),value=select.value;
    select.replaceChildren(...items.map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name;o.dataset.userContent='';return o;}));
    if(items.some(x=>x.id===value))select.value=value;
    if(id==='mbd-body-edit'){
      const empty=items.length===0;
      if(empty){const o=document.createElement('option');o.value='';o.textContent='暂无刚体';select.append(o);}
      select.disabled=empty;
      for(const button of ['mbd-body-fill','mbd-body-update','mbd-body-remove'])$(button).disabled=empty;
      $('mbd-body-empty').hidden=!empty;
    }
  }
  const couplingUI=wireCoupling({getSim:()=>sim,getModel:()=>sim?.model??model,mutate,guard,read,num,put,toast,onApplied:()=>curvesUI?.refresh()});
  function refresh(){
    resetRunControls();
    if(simpleUI)queueMicrotask(()=>simpleUI.reset());
    unifiedUI?.refresh();cadUI?.refresh();surfaceUI?.refresh();resultQueryUI?.refresh();vvUI?.refresh();if(sim.document)void archiveUI?.checkpoint(sim.document,'edit');if(view){view.cadCurves=sim.document?.cadCurves??[];view.cadSurfaces=sim.document?.cadSurfaces??[];}
    const fem=sim.project.solver.adapter.startsWith('cpu-fem-');
    for(const id of ['mbd-collision-family','mbd-appearance']){$(id).hidden=fem;document.querySelector(`label[for="${id}"]`).hidden=fem;}
    $('mbd-body-panel').querySelector('p:last-child').hidden=fem;
    if(sim.project.solver.adapter.startsWith('cpu-fem-')){
      if(sim.project.solver.adapter===MIXED)couplingUI.refresh();
      model=sim.model;selectOptions('project-part-select',sim.project.parts.map(p=>({...p,name:`${p.name} · ${p.method.toUpperCase()} · ${p.id}`})));
      selectOptions('mbd-result-body',sim.project.parts);readInitial();$('mbd-json').value=JSON.stringify(sim.project,null,2);femUI?.refresh();curvesUI?.refresh();contactUI?.refresh();thermalUI?.refresh();selectOptions('mbd-body-edit',model.bodies);$('mbd-body-shape').value='sphere';for(const o of $('mbd-body-shape').options)o.disabled=o.value!=='sphere';return;
    }
    femUI?.refresh();referenceUI?.refresh(frame);attachmentUI?.refresh();validationUI?.refresh();curvesUI?.refresh();contactUI?.refresh();thermalUI?.refresh();
    for(const o of $('mbd-body-shape').options)o.disabled=false;
    couplingUI.refresh();$('project-compute').value=sim.project.solver.adapter;$('project-gpu-port').value=sim.project.solver.gpuPort??Number(query.get('projectGpuPort')??8769);
    model=sim.model;
    for(const id of ['mbd-body-edit','mbd-joint-a','mbd-joint-b','mbd-load-body'])selectOptions(id,model.bodies);
    selectOptions('mbd-result-body',sim.project.parts);selectOptions('mbd-gear-carrier',[{id:'',name:'世界参考（机架姿态固定）'},...model.bodies]);
    selectOptions('project-part-select',sim.project.parts.map(p=>({...p,name:`${p.name} · ${p.method.toUpperCase()} · ${p.id}`})));
    readInitial();
    selectOptions('mbd-joint-edit',model.joints);selectOptions('mbd-result-joint',sim.project.connections);
    if($('mbd-joint-a').value===$('mbd-joint-b').value&&model.bodies.length>1)$('mbd-joint-b').value=model.bodies[1].id;
    if(model.bodies.find(b=>b.id===$('mbd-result-body').value)?.type==='fixed')$('mbd-result-body').value=model.bodies.find(b=>b.type==='dynamic')?.id??model.bodies[0]?.id??'';
    $('mbd-json').value=JSON.stringify(sim.project,null,2);put('mbd-gravity',model.gravity);$('mbd-dt').value=String(model.dt);if(!$('mbd-dt').value){const o=document.createElement('option');o.value=String(model.dt);o.textContent=model.dt.toPrecision(5)+' s';$('mbd-dt').append(o);$('mbd-dt').value=o.value;}$('mbd-iterations').value=model.iterations;
    $('mbd-joint-info').textContent=model.joints.map(j=>`${j.name} · ${j.type} · ${j.a} ↔ ${j.b}${j.motor?' · '+j.motor.mode+' '+j.motor.target:''}`).join('\n');
  }
  function finishLoad(nextFrame){if(nextFrame.fem){finishStaticLoad(nextFrame);return;}document.body.classList.remove('fem-active','fem-dynamic','mixed-active');$('mbd-toggle').disabled=false;applyStudyVisibility($('study-kind').value);recorded=false;computeError='';model=sim.model;if(model.coupling?.domain)view.setDomain(model.coupling.domain);else view.setDomain({lower:[-6,0,-4],upper:[6,7,4],cellSize:1});history=new engine.MotionHistory();frame=nextFrame;recordFrame(frame,true);running=false;replaying=false;cursor=null;budget=0;followPosition=null;refresh();const bike=model.bodies.some(b=>b.id==='bike-frame'),ramps=model.bodies.some(b=>b.id==='pool-ramp-entry'),wall=bike&&(ramps||model.coupling?.parts.some(p=>p.id==='impact-wall'));if(ramps){$('ramps-pitch-support').checked=model.joints.some(j=>j.id==='pitch-support');$('ramps-water-friction').value=model.coupling.friction;$('ramps-drive-gain').value=model.joints.find(j=>j.id==='cadence').motor.damping;$('ramps-wheel-torque').value=model.joints.find(j=>j.id==='front-drive').maxTorque;$('ramps-angle').value=Math.abs(model.bodies.find(b=>b.id==='pool-ramp-entry').rotation[2]);$('ramps-water-depth').value=Number(model.coupling.parts.filter(p=>p.method==='pbf').reduce((h,p)=>h+p.size[1],0).toFixed(3));}view.hideJoints=bike&&!$('assembly-joints').checked;if(bike){$('assembly-mode').value=model.joints.some(j=>j.type==='planar')?'planar':model.bodies.find(b=>b.id==='bike-frame').type==='fixed'?'stand':'guided';view.yaw=wall ? .32 : .18;view.pitch=wall ? .19 : .14;const climb=wall&&model.joints.some(j=>j.type==='planar');const course=model.coupling?.parts.some(p=>p.id==='water-pool');if(course){const water=model.coupling.parts.find(p=>p.id==='water-pool'),end=model.coupling.parts.find(p=>p.id==='breakable-wall');$('course-water-depth').value=water.size[1];$('course-water-length').value=Number(water.size[0].toFixed(3));const first=model.coupling.parts.find(p=>p.id==='impact-wall');$('course-fill-gap').checked=!!(first&&end&&Math.abs(water.center[0]-water.size[0]/2-first.center[0]-first.size[0]/2)<1e-7&&Math.abs(water.center[0]+water.size[0]/2-end.center[0]+end.size[0]/2)<1e-7);$('course-water-length').disabled=$('course-fill-gap').checked;if(end){$('course-wall-x').value=end.center[0]-end.size[0]/2;$('course-onset').value=end.fracture.onset;$('course-failure').value=end.fracture.failure;}}$('mbd-preset').value=ramps?'pelican-ramps':course?'pelican-course':wall?(climb?'pelican-climb':'pelican-wall'):'pelican';if(wall){$('assembly-follow').checked=false;$('mbd-duration').value=ramps?20:course?15:climb?10:6;$('assembly-climb').checked=climb;$('assembly-front-drive').checked=model.joints.some(j=>j.id==='front-drive');$('assembly-pedal-gain').value=model.joints.find(j=>j.id==='cadence')?.motor?.damping??64;$('assembly-front-torque').value=model.joints.find(j=>j.id==='front-drive')?.maxTorque??40;$('assembly-traction').value=model.coupling.friction;$('mbd-result-body').value='front-wheel';$('mbd-result-field').value='contactForce';$('mbd-trace').checked=false;}}if(['热夹具 · 温度相关扭转','加热熔化 · 夹持释放'].includes(model.name)){$('mbd-duration').value=model.name.startsWith('加热')?.5:2;$('mbd-result-body').value='specimen';$('mbd-result-field').value='temperature';$('mbd-trace').checked=false;}if(model.name.startsWith('分阶段试验')){$('mbd-duration').value=3.5;$('mbd-result-body').value='specimen';$('mbd-result-field').value='temperature';$('mbd-trace').checked=false;$('mbd-preset').value='staged-thermal';}if(model.name.startsWith('热压头 · 压紧')){$('mbd-duration').value=3;$('mbd-preset').value='contact-slide';$('mbd-result-body').value='specimen';$('mbd-result-field').value='temperature';$('mbd-trace').checked=false;}if(model.name.startsWith('冷热块 ·')){$('mbd-duration').value=3;$('mbd-preset').value='material-impact';$('mbd-result-body').value='hot-block';$('mbd-result-field').value='temperature';$('mbd-trace').checked=false;}if(model.name==='MPM · 部件热源与冷却'){$('mbd-preset').value='mpm-part-thermal';$('mbd-duration').value=8;$('mbd-result-body').value='heated';$('mbd-result-field').value='temperature';$('project-thermal-results').open=true;}view.fit(frame);$('mbd-engine-status').textContent=sim.asynchronous?'Taichi GPU + 刚体 CPU · 就绪':'MPM / MBD / THERMAL · CPU · 就绪';updateUI();}
  function finishStaticLoad(nextFrame){
    document.body.classList.toggle('mixed-active',!!nextFrame.mixed);document.body.classList.add('fem-active');document.body.classList.toggle('fem-dynamic',nextFrame.fem.analysis==='linear-dynamic');applyStudyVisibility($('study-kind').value);
    recorded=false;computeError='';running=false;replaying=false;cursor=null;budget=0;model=sim.model;frame=nextFrame;
    history=frame.fem.analysis==='linear-dynamic'?new FEMHistory():new engine.MotionHistory();if(history instanceof FEMHistory&&sim.project.solver.outputInterval)history.interval=Math.min(history.interval,sim.project.solver.outputInterval);recordFrame(frame,true);timeline.hidden=true;
    const points=[...frame.fem.parts.flatMap(p=>p.nodes),...frame.bodies.flatMap(b=>[-1,1].map(sign=>b.position.map((x,k)=>x+sign*b.size[k]/2)))];
    if(points.length){const lo=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),h=Math.max(...hi.map((x,k)=>x-lo[k]))/10;
      view.setDomain({lower:lo.map(x=>x-h),upper:hi.map(x=>x+h),cellSize:h});}
    if(nextFrame.mixed)view.setDomain(sim.project.discretization.mpm);
    view.yaw=.35;view.pitch=.27;refresh();if(sim.project.name.startsWith('高速撞板'))$('mbd-replay-speed').value='.0005';$(document.body.classList.contains('modeling-advanced')?'fem-geometry':'unified-parts').open=true;view.fit(frame);if(sim.project.solver.thermal){$('fem-field').value='temperature';$('project-thermal-results').open=true;} $('mbd-preset').value=nextFrame.mixed?.backend?(nextFrame.mixed.scheme==='resident-four-method/1'?'unified-gpu':sim.project.name==='MPM–FEM · GPU 能量诊断'?'mpm-fem-energy':sim.project.name==='MPM–FEM · 滑动撞击与耗散生热'?'mpm-fem-dissipation':sim.project.name==='MPM–FEM · 热压板接触加热与卸载'?'mpm-fem-thermomechanical':sim.project.name==='MPM–FEM · GPU 加热与冷却'?'mpm-fem-gpu-thermal':nextFrame.coupling.count>10000?'mpm-fem-50k':'mpm-fem-10k'):nextFrame.mixed?(nextFrame.mixed.thermalMode==='fixed-geometry'?'mpm-fem-thermal-contact':'mpm-fem-impact'):sim.project.solver.thermal?'fem-thermal':frame.bodies.length?'fem-impact':frame.fem.analysis==='linear-dynamic'?'fem-release':'fem-cantilever';if(frame.mixed){$('fem-mixed-energy').open=true;$('project-contact-results').open=true;$('fem-original').checked=false;}if(sim.project.name.startsWith('MPM–PBF 接触对'))$('mbd-preset').value='particle-pairs';if(sim.project.name.startsWith('多体挤压')){$('mbd-preset').value='contact-squeeze';$('mbd-replay-speed').value='.01';}if(sim.project.name.startsWith('高速撞板'))$('mbd-preset').value='contact-safety';if(frame.mixed?.thermalMode==='fixed-geometry'){$('fem-mixed-energy').open=false;$('project-contact-results').open=false;$('project-thermal-results').open=true;view.pitch=.5;}if(frame.bodies.length){$('project-contact-results').open=true;$('fem-dynamic-results').open=true;$('fem-original').checked=false;fillBody();}
    if(sim.project.name==='MPM–FEM · 热压板接触加热与卸载'){
      $('fem-temperature-mode').value='manual';$('fem-temperature-min').value=20;$('fem-temperature-max').value=25;
      $('mixed-material-field').value='maxTemperature';$('fem-mixed-energy').open=true;$('project-contact-results').open=false;
    }
    if(['MPM–FEM · GPU 能量诊断','MPM–FEM · 滑动撞击与耗散生热'].includes(sim.project.name)){
      $('fem-temperature-mode').value='manual';$('fem-temperature-min').value=20;$('fem-temperature-max').value=20.003;
      $('heat-temperature-view').value='rise';$('heat-temperature-part').value=sim.project.parts.find(p=>p.method==='mpm').id;
      $('project-thermal-results').open=!sim.project.solver.diagnostics;$('fem-mixed-energy').open=!!sim.project.solver.diagnostics;$('project-contact-results').open=false;
    }
    if(sim.project.name==='MPM–PBF · GPU 双向碰撞'){
      $('mbd-preset').value='unified-fluid-impact';
      $('pair-result').value=sim.project.contactPairs.find(p=>[p.a,p.b].includes('solid')&&[p.a,p.b].includes('water'))?.id??'';
      $('project-contact-results').open=true;
    }
    $('mbd-engine-status').textContent=frame.fem.analysis==='linear-dynamic'?`FEM / LINEAR DYNAMIC / ${frame.mixed?.backend?'CUDA':'CPU'}`:'FEM / LINEAR STATIC / CPU';updateUI();
  }
  async function solveStatic(){
    if(pendingStep||pendingLoad)throw Error('求解或网格生成正在进行');
    femSolving=true;running=false;replaying=false;cursor=null;femUI.busy(true);updateUI();
    pendingStep=sim.step();let failure=null;
    try{frame=await pendingStep;history=new engine.MotionHistory();recordFrame(frame,true);reveal('results','fem-results');}
    catch(e){failure=e;throw e;}
    finally{pendingStep=null;femSolving=false;femUI.busy(false);if(failure)$('fem-status').textContent=failure.message;updateUI();}
  }
  async function cancelStatic(){if(!pendingStep||!frame?.fem)return;sim.runtime.cancel();try{await pendingStep;}catch{}await load(sim.project);}
  function updateStaticUI(){
    const en=document.documentElement.lang==='en',shown=displayFrame(),parts=shown.fem.parts;
    const progress=$('project-run-progress');progress.hidden=frame.fem.analysis!=='linear-dynamic';
    if(!progress.hidden)progress.textContent=computeError?(en?'Stopped: ':'求解停止：')+computeError:pendingLoad?(en?'Loading project…':'正在加载项目…'):pendingStep&&batchStarted?`${running?(en?'Computing':'正在计算'):(en?'Pausing after current batch':'暂停中，等待当前批次返回')} · ${((performance.now()-batchStarted)/1000).toFixed(1)} s\n${en?'Completed / target':'已完成 / 目标'} ${frame.time.toFixed(5)} / ${endTime.toFixed(5)} s`:running?`${en?'Running toward':'正在推进至'} ${endTime.toFixed(5)} s`:endTime>0&&sim.time>=endTime-1e-9?(en?'Target reached; add duration to continue.':'已到达目标时间；可追加时长继续计算。'):(en?'Paused':'已暂停');
    if(frame.fem.analysis==='linear-dynamic'){
      $('mbd-title').textContent=sim.project.name;
      $('mbd-statistics').textContent=`${parts.length} FEM${shown.mixed?' + '+shown.coupling.count+' MPM/PBF':''}${frame.bodies.length?' + '+frame.bodies.length+' RIGID':''} · ${parts.reduce((s,p)=>s+p.nodes.length,0)} nodes · ${parts.reduce((s,p)=>s+p.cells.length,0)} Tet4\nt = ${shown.time.toFixed(4)} s · Δt ${shown.fem.dynamics.dt.toExponential(2)} s`;
      $('mbd-toggle').textContent=running?(en?'Pause':'暂停'):(en?'Run':'运行');$('mbd-toggle').disabled=!!pendingLoad;
      $('fem-run').disabled=!!pendingLoad||running;$('fem-step').disabled=!!pendingLoad||!!pendingStep||running;
      $('mbd-impact-readout').hidden=true;timeline.hidden=!active||location.hash!=='#results';
      $('mbd-replay').textContent=replaying?(en?'Pause replay':'暂停回放'):(en?'Replay':'回放动画');
      $('mbd-frame').max=Math.max(0,history.frames.length-1);$('mbd-frame').value=cursor??history.frames.length-1;
      $('mbd-frame-time').textContent=`${cursor==null?(en?'Live':'求解末帧'):(en?'Replay':'回放帧')} · ${shown.time.toFixed(4)} / ${frame.time.toFixed(4)} s`;
      if(active)$('workspace-status3').textContent=`${running?'RUNNING':replaying?'REPLAY':'PAUSED'} / ${shown.mixed?.framework?'MPM FRAMEWORK':'FEM'} · ${shown.mixed?.backend?'CUDA':'CPU'} / ${shown.mixed?.thermalMode==='fixed-geometry'?'FIXED GEOMETRY · THERMAL':'LINEAR DYNAMIC'}`;
      femUI?.display(shown);curvesUI?.display(shown);return;
    }
    $('mbd-title').textContent=sim.project.name;
    $('mbd-statistics').textContent=`${parts.length} FEM${shown.mixed?' + '+shown.coupling.count+' MPM/PBF':''}${frame.bodies.length?' + '+frame.bodies.length+' RIGID':''} · ${parts.reduce((s,p)=>s+p.nodes.length,0)} nodes · ${parts.reduce((s,p)=>s+p.cells.length,0)} Tet4\n${femSolving?(en?'Solving static equilibrium…':'正在求解静力平衡…'):frame.fem.solved?(en?'Static solution converged':'静力求解已收敛'):(en?'Mesh ready · not solved':'网格就绪 · 尚未求解')}`;
    $('mbd-toggle').textContent=en?'Solve static':'求解静力';$('mbd-toggle').disabled=femSolving;
    $('mbd-impact-readout').hidden=true;timeline.hidden=true;
    if(active)$('workspace-status3').textContent=`${femSolving?'SOLVING':frame.fem.solved?'CONVERGED':'READY'} / FEM · CPU / LINEAR STATIC`;
    femUI?.display(frame);
  }
  function finishPreview(nextFrame){
    document.body.classList.remove('fem-active','fem-dynamic','mixed-active');
    applyStudyVisibility($('study-kind').value);
    recorded=false;computeError='';running=false;replaying=false;cursor=null;budget=0;
    model=sim.model;frame=nextFrame;history=new engine.MotionHistory();timeline.hidden=true;
    view.referenceAxes=[];view.referenceSelection=null;
    view.setDomain(sim.project.discretization.mpm??{lower:[-6,0,-4],upper:[6,7,4],cellSize:1});
    refresh();view.fit(frame);updateUI();
  }
  async function loadAuthoring(value){
    if(!sim||!view)throw Error('项目尚未就绪');
    if(pendingLoad)throw Error('项目正在加载，请稍候');
    running=false;replaying=false;
    if(pendingStep)try{await pendingStep;}catch{} // An old failed solve cannot block editing.
    storeRun('stopped');
    const issue=authoringIssue(sim.registry,value);
    if(issue){finishPreview(sim.stage(value,issue));return;}
    try{return await load(value,{strict:true});}
    catch(error){finishPreview(sim.stage(value,error.message));}
  }
  function load(value,{strict=false}={}){
    if(!sim||!view)throw Error('项目求解器尚未就绪');
    if(sim.runtime?.preview&&!strict)return loadAuthoring(value);
    const project=value.schema==='summer-project/1'?structuredClone(value):fromLegacy(value);
    if(value.schema!=='summer-project/1'){project.solver.adapter=sim.document?.solver.adapter.startsWith('cpu-fem-')?'cpu-coupled':sim.document?.solver.adapter??initialAdapter;project.solver.gpuPort=sim.document?.solver.gpuPort??Number(query.get('projectGpuPort')??8769);}
    running=false;replaying=false;
    if(pendingStep||sim.registry.adapter(project).asynchronous){
      $('mbd-engine-status').textContent=project.solver.adapter.startsWith('cpu-fem-')?'正在生成 FEM 网格与初始状态…':'正在连接或加载 GPU 项目…';
      pendingLoad=(async()=>{if(pendingStep)await pendingStep;storeRun('stopped');const next=await sim.replaceAsync(project);finishLoad(next);})().catch(e=>{computeError=e.message;throw e;}).finally(()=>{pendingLoad=null;});
      return pendingLoad;
    }
    storeRun('stopped');finishLoad(sim.replace(project));
  }
  function mutate(fn){const result=load(sim.project.solver.adapter===MIXED?editMixedParticles(sim.project,fn):sim.project.solver.adapter==='cpu-fem-dynamic'?editFEMRigids(sim.project,fn):editLegacyProject(sim.project,fn));toast('项目模型已更新，求解和曲线已重置');return result;}
  async function loadCourseRecording(){
    const response=await fetch(query.get('replay')==='ramps'?'/artifacts/ramps-replay.json':'/artifacts/course-replay.json');if(!response.ok)throw Error('尚未生成路线验证回放，请先运行 gpu/benchmark_course.py');
    const {readRecording}=await import('./recording.js'),tape=readRecording(await response.json());
    tape.project.solver.adapter=sim.project.solver.adapter;tape.project.solver.gpuPort=sim.project.solver.gpuPort;
    await load(tape.project);history=new engine.MotionHistory();for(const f of tape.frames)recordFrame(f,true);
    frame=history.frames.at(-1);cursor=0;recorded=true;running=replaying=false;referenceUI?.refresh(history.frames[0]);
    // Include both ends of the ride so the bicycle stays in view during replay.
    view.fit({...history.frames[0],bodies:[...history.frames[0].bodies,...frame.bodies]});
    $('mbd-engine-status').textContent='已载入 CUDA 计算回放；重置后可重新求解。';updateUI();
  }
  function selectedPart(){return sim?.project.parts.find(p=>p.id===$('project-part-select').value);}
  function readInitial(){const p=selectedPart();if(!p){$('project-part-info').textContent='项目尚无部件，请在几何与材料中创建。';return;}
    $('project-part-name').value=p.name;$('project-initial-temperature').value=p.initial.temperature;put('mbd-velocity',p.initial.velocity);put('mbd-angular',p.initial.angularVelocity??[0,0,0]);
    $('project-thermal-properties').hidden=!['rigid','fem'].includes(p.method);$('project-part-cp').value=p.material.cp??500;$('project-part-k').value=p.material.conductivity??50;
    for(let i=0;i<3;i++)$('mbd-angular'+i).disabled=p.method!=='rigid';
    $('project-part-info').textContent=`${p.name}\nID: ${p.id} · ${p.method.toUpperCase()}\n${p.geometry.shape} · ${p.geometry.size.join(' × ')} m\n${p.geometry.center.join(', ')} m · ${p.initial.temperature}°C`;
  }
  function reveal(chapter,folder){window.dispatchEvent(new CustomEvent('workbench-reveal',{detail:{chapter,folder}}));}
  function wireProject(){
    assistantUI=wireAssistant({
      getProject:()=>sim.document,
      queryResults,
      getCADContext:()=>cadUI?.getContext(),
      editCAD:id=>{unifiedUI.edit(id);reveal('geometry','cad-modeler');cadUI?.loadPart(id);},
      getStatus:()=>({time:sim.time,target:Number($('run-target').value),running,pending:!!pendingStep||!!pendingLoad||femSolving,preview:!!frame?.preview,reason:frame?.reason??'',error:computeError,backend:frame?.mixed?.backend??frame?.backend??null,selectedPart:$('unified-edit')?.value||$('project-part-select').value,actualDt:frame?.mixed?.clock?.minDt??frame?.fem?.dynamics?.lastDt??null,particleCount:frame?.coupling?.count??null,thermalResidual:frame?.thermal?.residual??frame?.results?.balance?.thermalResidual??frame?.coupling?.thermalResidual??null}),
      busy:plan=>!!pendingLoad||femSolving||((running||!!pendingStep)&&!(plan.action==='pause'&&!plan.changed)),
      assertApplied:()=>{if(!active)throw Error('请先切换至统一项目工作区');simpleUI?.assertApplied();},load:loadAuthoring,loadStrict:value=>load(value,{strict:true}),
      control:async action=>{
        if(action==='run')return run();
        if(action==='pause'){running=false;replaying=false;updateUI();return;}
        if(action==='reset')return loadAuthoring(sim.project);
        if(action==='step')return stepOnce();
        throw Error('未知模拟操作');
      }
    });
    unifiedUI=wireUnifiedProject({getProject:()=>sim.project,load:loadAuthoring,guard,reveal,onAdvanced:value=>{document.body.classList.toggle('modeling-advanced',value);$('chapter-geometry').classList.toggle('simple-expanded',value);applyStudyVisibility($('study-kind').value);}});
    cadUI=wireCAD({getProject:()=>sim.document,load:loadAuthoring,loadFEM:value=>load(value,{strict:true}),busy:()=>running||!!pendingStep||!!pendingLoad||femSolving,assertApplied:()=>simpleUI?.assertApplied(),editPart:id=>unifiedUI.edit(id)});
    simpleUI=wireSimpleWorkspace({getState:()=>({project:sim.document,frame:displayFrame(),resultProject:resultOrigins.get(displayFrame()),running,pending:!!pendingStep||!!pendingLoad,loading:!!pendingLoad,status:frame?.preview?'editing':running?'running':recorded?'recorded':'ready',error:computeError,target:Number($('run-target').value),field:frame?.fem?$('fem-field')?.selectedOptions[0]?.textContent:frame?.particleColorMode??null,recorded}),load,guard,editPart:id=>{unifiedUI.edit(id);$('project-part-select').value=id;$('project-part-select').dispatchEvent(new Event('change',{bubbles:true}));}});
    femUI=wireFEM({getProject:()=>sim.project,load,guard,getFrame:()=>displayFrame(),getView:()=>view,solve:solveStatic,cancel:cancelStatic,download,reveal,run,pause:()=>{running=false;replaying=false;updateUI();},step:()=>$('mbd-step').click(),getHistory:()=>history?.samples??history?.frames??[]});
    surfaceUI=wireSurfaceSelections({parent:$('chapter-loads'),getProject:()=>sim.document,load:value=>load(value,{strict:true}),busy:()=>running||!!pendingStep||!!pendingLoad||femSolving,assertApplied:()=>simpleUI?.assertApplied(),loadExample:async()=>{const project=await namedSurfaceExample();await load(project,{strict:true});reveal('loads','project-surfaces');}});
    archiveUI=wireProjectArchive({parent:$('chapter-setup'),getProject:()=>sim.document,load:loadAuthoring,busy:()=>running||!!pendingStep||!!pendingLoad||femSolving,getRun:()=>runRecord()});
    resultQueryUI=wireResultQueries({parent:$('chapter-results'),getProject:()=>sim.document,query:queryResults});
    vvUI=wireVV({parent:$('chapter-results'),download,getState:()=>({project:sim.document,frame:displayFrame(),resultProject:resultOrigins.get(displayFrame()),history:(history?.samples??history?.frames??[]).map(f=>({frame:f,resultProject:resultOrigins.get(f)})),computeError})});
    for(const id of ['fem-duration','mbd-duration'])$(id).addEventListener('change',()=>{$('run-target').value=sim.time+num(id);changeTarget();});
    $('fem-dt').addEventListener('change',()=>{$('run-dt').value=$('fem-dt').value;});
    thermalUI=wireThermal({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.samples??history.frames});
    contactUI=wireContacts({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.samples??history.frames});
    curvesUI=wireCurves({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.samples??history.frames});
    referenceUI=wireReferences({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.frames});
    attachmentUI=wireAttachments({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.frames});
    validationUI=wireValidation({getProject:()=>sim.project,load,guard,download,getHistory:()=>history.frames,reveal});
    for(const [value,label] of [['mechanicalEnergy','统一机械能（J）'],['materialElastic','材料弹性储能（J）'],['residual','未分解机械残差（J）'],['positiveCorrectionWork','累计正向修正功（J）'],['momentumChange','总动量变化（kg·m/s）']]){
      const o=document.createElement('option');o.value='diagnostics:'+value;o.textContent=label;$('mbd-result-field').append(o);
    }
    for(const n of [960,1920]){const o=document.createElement('option');o.value=String(1/n);o.textContent=`1/${n} s`;$('mbd-dt').append(o);}
    $('project-compute-apply').onclick=guard(()=>{const draft=sim.project;draft.solver.adapter=$('project-compute').value;draft.solver.gpuPort=num('project-gpu-port');return load(draft);});
    $('project-gravity-apply').onclick=guard(()=>mutate(d=>{d.gravity=read('mbd-gravity');}));
    $('project-domain-apply').onclick=guard(()=>mutate(d=>{d.coupling??={...emptyCoupling(),enabled:false};d.coupling.domain={lower:read('coupling-lower'),upper:read('coupling-upper'),cellSize:num('coupling-grid'),particlesPerAxis:Number($('coupling-ppc').value)};d.coupling.stiffness=num('coupling-stiffness');}));
    $('project-part-select').onchange=readInitial;$('project-initial-read').onclick=readInitial;
    $('project-initial-apply').onclick=guard(()=>{const p=selectedPart();if(!p)throw Error('请先选择部件');const draft=sim.project,b=draft.parts.find(b=>b.id===p.id);b.name=$('project-part-name').value;b.initial.temperature=num('project-initial-temperature');b.initial.velocity=read('mbd-velocity');if(['rigid','fem'].includes(b.method)){b.material.cp=num('project-part-cp');b.material.conductivity=num('project-part-k');}if(b.method==='rigid')b.initial.angularVelocity=read('mbd-angular');load(draft);});
    $('project-part-remove').onclick=guard(()=>{const p=selectedPart();if(p)return loadAuthoring(prepareProjectMethods(removePart(sim.project,p.id)));});
    $('project-edit-initial').onclick=()=>{readInitial();reveal('parts','project-initial-panel');};
    $('project-edit-geometry').onclick=guard(()=>{const p=selectedPart();if(!p)throw Error('请先选择部件');unifiedUI.edit(p.id);});
    $('mbd-settings').onclick=guard(()=>mutate(d=>{d.dt=sim.document.solver.dt;d.iterations=num('mbd-iterations');if(!d.coupling&&$('coupling-enabled').checked)d.coupling=emptyCoupling();if(d.coupling){if(!$('coupling-enabled').checked&&d.coupling.parts.length)throw Error('请先删除 MPM 部件再关闭 MPM 求解');d.coupling.enabled=$('coupling-enabled').checked;}}));
  }
  function selectedBody(id='mbd-body-edit'){const b=model.bodies.find(b=>b.id===$(id).value);if(!b)throw Error('请先选择一个刚体');return b;}
  function nextId(items,prefix){let i=1;while(items.some(x=>x.id===prefix+i))i++;return prefix+i;}
  function bodyFields(){return {name:$('mbd-body-name').value,type:$('mbd-body-type').value,shape:$('mbd-body-shape').value,size:read('mbd-body-size'),position:read('mbd-body-position'),rotation:read('mbd-body-rotation'),mass:num('mbd-body-mass'),collisionFamily:num('mbd-collision-family'),appearance:$('mbd-appearance').value.trim()?JSON.parse($('mbd-appearance').value):null};}
  function run(){
    if(sim?.runtime?.preview)throw Error('模型尚未就绪：'+frame.reason);
    if(!sim?.document?.parts.length)throw Error('请先添加部件，再运行模拟');
    simpleUI?.assertApplied();
    if(sim?.project.solver.adapter==='cpu-fem-static')return solveStatic();
    if(recorded)throw Error('当前是已计算回放；请先点击重置，再重新求解。');if(!sim)throw Error('多体引擎尚未就绪');
    const dynamic=sim.project.solver.analysis==='linear-dynamic',target=validateRunTarget(num('run-target'),sim.time);
    if(Math.abs(num('run-dt')-sim.project.solver.dt)>1e-12)throw Error('时间步尚未应用，请点击“应用时间步并重置”，或恢复已应用值');
    if($('run-coupling-mode').value!==couplingMode(sim.project.solver)||($('run-coupling-mode').value==='unified-pbd'&&num('run-pbd-iterations')!==(sim.project.solver.pbdIterations??6)))throw Error('耦合方式尚未应用，请点击“应用耦合方式并重置”');
    if(running)return;
    computeError='';cursor=null;replaying=false;running=true;endTime=target;budget=0;toast('已开始继续求解');
    const generation=frame.mixed?.backend&&(sim.project.parts.some(b=>b.material.thermomechanical?.plasticHeatFraction>0)||sim.project.contactPairs.some(p=>p.frictionHeatFraction>0));
    if(dynamic&&location.hash!=='#solver')reveal('results',frame.mixed?.energy?.enabled?'fem-mixed-energy':frame.mixed?.thermalMode==='fixed-geometry'||generation?'project-thermal-results':frame.mixed?'project-contact-results':'fem-dynamic-results');
  }
  $('mbd-load').onclick=guard(()=>{const kind=$('mbd-preset').value;if(kind==='named-surfaces')return namedSurfaceExample().then(p=>load(p,{strict:true}));if(kind==='cad-hole')return cadExample().then(loadAuthoring);if(kind==='particle-pairs')return load(particlePairExample());if(kind==='contact-squeeze')return load(contactSqueezeExample());if(kind==='contact-safety')return load(contactSafetyExample());if(kind==='unified-pbd'||kind==='unified-gpu'||kind==='unified-fluid-impact'){const p=kind==='unified-pbd'?unifiedPBDExample():kind==='unified-fluid-impact'?fourGPUFluidImpactExample():fourGPUExample();p.solver.mixedGpuPort=Number(query.get('mixedGpuPort')??8796);return load(p);}if(kind==='mpm-fem-energy'||kind==='mpm-fem-dissipation'||kind==='mpm-fem-thermomechanical'||kind==='mpm-fem-gpu-thermal'||kind==='mpm-fem-10k'||kind==='mpm-fem-50k'){const p=kind==='mpm-fem-energy'?mixedGPUEnergyProject():kind==='mpm-fem-dissipation'?mixedGPUDissipationProject():kind==='mpm-fem-thermomechanical'?mixedGPUThermomechanicalProject():kind==='mpm-fem-gpu-thermal'?mixedGPUThermalProject():mixedScaleProject(kind==='mpm-fem-10k'?10000:50000);p.solver.mixedGpuPort=Number(query.get('mixedGpuPort')??8795);return load(p);}if(kind==='mpm-fem-thermal-contact')return load(mixedThermalContactProject());if(kind==='mpm-fem-impact')return load(mixedImpactProject());if(kind==='fem-thermal')return load(femThermalExample());if(kind==='mpm-part-thermal')return load(mpmPartThermalExample());if(kind==='fem-cantilever')return load(cantileverProject());if(kind==='fem-impact')return load(impactProject());if(kind==='fem-release')return load(dynamicCantileverProject());if(kind!=='material-impact'&&kind!=='contact-slide'&&kind!=='staged-thermal'&&!kind.startsWith('thermal-')&&!kind.startsWith('grip-')&&kind!=='references')return load(preset(kind));const p=kind==='material-impact'?materialContactExample():kind==='contact-slide'?contactExample():kind==='staged-thermal'?stagedExample():kind.startsWith('thermal-')?thermalExample(kind==='thermal-release'):kind==='references'?referenceExample():gripExample(kind==='grip-twist');p.solver.adapter=sim.project.solver.adapter.startsWith('cpu-fem-')?'cpu-coupled':sim.project.solver.adapter;p.solver.gpuPort=sim.project.solver.gpuPort;return load(p);});
  $('assembly-build').onclick=guard(async()=>{await load(bicycle({radius:num('assembly-radius'),wheelbase:num('assembly-wheelbase'),rpm:num('assembly-rpm'),ratio:num('assembly-ratio'),origin:read('assembly-origin'),mode:$('assembly-mode').value}));$('mbd-duration').value=12;$('mbd-result-body').value='rear-wheel';$('mbd-result-joint').value='chain';$('mbd-result-field').value='omega';$('mbd-trace').checked=false;});
  function matchCourseLength(){if($('course-fill-gap').checked){const first=bicycleWall({climb:true}).coupling.parts[0];$('course-water-length').value=Number((num('course-wall-x')-first.center[0]-first.size[0]/2).toFixed(3));}}
  $('course-fill-gap').onchange=()=>{$('course-water-length').disabled=$('course-fill-gap').checked;if(!$('course-fill-gap').checked)$('course-water-length').value=1.2;else matchCourseLength();};
  $('course-wall-x').oninput=matchCourseLength;
  $('course-water-length').disabled=true;
  $('assembly-build-ramps').onclick=guard(()=>load(bicycleRamps({angle:num('ramps-angle'),waterDepth:num('ramps-water-depth'),waterFriction:num('ramps-water-friction'),driveGain:num('ramps-drive-gain'),wheelTorque:num('ramps-wheel-torque'),pitchSupport:$('ramps-pitch-support').checked})));
  $('assembly-build-course').onclick=guard(()=>load(bicycleCourse({waterDepth:num('course-water-depth'),fillGap:$('course-fill-gap').checked,waterLength:num('course-water-length'),wallX:num('course-wall-x'),fractureOnset:num('course-onset'),fractureFailure:num('course-failure')})));
  $('assembly-build-wall').onclick=guard(()=>{const [thickness,height,width]=read('assembly-wall-size');load(bicycleWall({radius:num('assembly-radius'),wheelbase:num('assembly-wheelbase'),rpm:num('assembly-rpm'),ratio:num('assembly-ratio'),origin:read('assembly-origin'),climb:$('assembly-climb').checked,frontDrive:$('assembly-front-drive').checked,frontTorque:num('assembly-front-torque'),pedalGain:num('assembly-pedal-gain'),traction:num('assembly-traction'),gap:num('assembly-gap'),thickness,height,width,wallModel:Number($('assembly-wall-law').value),stiffness:num('assembly-wall-stiffness')}));});
  $('assembly-colliders').onchange=()=>{if(view)view.collisionOnly=$('assembly-colliders').checked;};
  $('assembly-joints').onchange=()=>{if(view)view.hideJoints=!$('assembly-joints').checked;};
  $('mbd-settings').onclick=guard(()=>mutate(d=>{d.gravity=read('mbd-gravity');d.dt=sim.document.solver.dt;d.iterations=num('mbd-iterations');}));
  $('mbd-run').onclick=guard(run);$('mbd-toggle').onclick=guard(()=>{if(running){running=false;recordFrame(frame,true);}else run();});
  async function stepOnce(){if(sim.runtime?.preview)throw Error('模型尚未就绪：'+frame.reason);if(!sim.document.parts.length)throw Error('请先添加部件');simpleUI?.assertApplied();if(sim.project.solver.adapter==='cpu-fem-static')return solveStatic();if(recorded)throw Error('当前是已计算回放；请先点击重置，再重新求解。');if(pendingStep)await pendingStep;const stepDt=frame.fem?.dynamics?.dt??model.dt;if(sim.time+stepDt>60)throw Error('累计时间已达 60 s');running=false;replaying=false;cursor=null;pendingStep=Promise.resolve(sim.step(stepDt));try{frame=await pendingStep;recordFrame(frame,true);updateUI();}finally{pendingStep=null;}}
  $('mbd-step').onclick=guard(stepOnce);
  $('mbd-reset').onclick=guard(()=>load(sim.project));$('mbd-fit').onclick=()=>view?.fit(displayFrame());
  function fillBody(){const b=selectedBody();$('mbd-body-name').value=b.name;$('mbd-body-type').value=b.type;$('mbd-body-shape').value=b.shape;for(const k of ['size','position','rotation'])put('mbd-body-'+k,b[k]);$('mbd-body-mass').value=b.mass;$('mbd-collision-family').value=b.collisionFamily;$('mbd-appearance').value=b.appearance?JSON.stringify(b.appearance,null,2):'';}
  $('mbd-body-fill').onclick=guard(fillBody);
  async function editBody(fn){await mutate(fn);reveal('geometry','mbd-body-panel');}
  $('mbd-body-add').onclick=guard(()=>editBody(d=>d.bodies.push({id:nextId(d.bodies,'body-'),...bodyFields()})));
  $('mbd-body-update').onclick=guard(()=>{const b=selectedBody();return editBody(d=>Object.assign(d.bodies.find(x=>x.id===b.id),bodyFields()));});
  $('mbd-body-remove').onclick=guard(()=>{const b=selectedBody();return editBody(d=>{d.bodies=d.bodies.filter(x=>x.id!==b.id);d.joints=d.joints.filter(j=>j.a!==b.id&&j.b!==b.id&&j.carrier!==b.id);});});
  $('mbd-joint-type').onchange=()=>{const type=$('mbd-joint-type').value;$('mbd-spring-fields').hidden=type!=='spring';$('mbd-unit-fields').hidden=!['revolute','prismatic'].includes(type);$('mbd-gear-fields').hidden=type!=='gear';};
  $('mbd-joint-add').onclick=guard(()=>{const d=sim.project;const type=$('mbd-joint-type').value,unit=['revolute','prismatic'].includes(type),mode=$('mbd-motor').value;d.connections.push(referenceUI.attach({id:nextId(d.connections,'joint-'),type,a:$('mbd-joint-a').value,b:$('mbd-joint-b').value,anchor:read('mbd-joint-anchor'),anchorB:type==='spring'?read('mbd-joint-anchor-b'):undefined,axis:{x:[1,0,0],y:[0,1,0],z:[0,0,1]}[$('mbd-joint-axis').value],carrier:type==='gear'?($('mbd-gear-carrier').value||undefined):undefined,ratio:num('mbd-gear-ratio'),maxTorque:num('mbd-gear-torque'),restLength:num('mbd-spring-length'),stiffness:num(type==='gear'?'mbd-gear-stiffness':'mbd-spring-k'),damping:num(type==='gear'?'mbd-gear-damping':'mbd-spring-c'),limits:unit&&$('mbd-limits').checked?[num('mbd-limit-min'),num('mbd-limit-max')]:null,motor:unit&&mode!=='none'?{mode,target:num('mbd-motor-target'),stiffness:num('mbd-motor-k'),damping:num('mbd-motor-c')}:null}));return load(d);});
  $('mbd-joint-remove').onclick=guard(()=>mutate(d=>{d.joints=d.joints.filter(j=>j.id!==$('mbd-joint-edit').value);}));
  $('mbd-load-fill').onclick=guard(()=>{const b=selectedBody('mbd-load-body');for(const key of ['force','torque'])put('mbd-'+key,b[key]);for(const key of ['friction','restitution','damping'])$('mbd-'+key).value=b[key];});
  $('mbd-load-apply').onclick=guard(()=>{const b=selectedBody('mbd-load-body');mutate(d=>Object.assign(d.bodies.find(x=>x.id===b.id),{force:read('mbd-force'),torque:read('mbd-torque'),friction:num('mbd-friction'),restitution:num('mbd-restitution'),damping:num('mbd-damping')}));});
  $('mbd-json-refresh').onclick=()=>{$('mbd-json').value=JSON.stringify(sim.project,null,2);};$('mbd-json-apply').onclick=guard(()=>load(parseProjectText($('mbd-json').value)));
  function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('project-export-results').onclick=guard(()=>download('\ufeff'+projectCSV(history.frames),'summer-project-results.csv','text/csv;charset=utf-8'));
  $('mbd-export-coupling').onclick=guard(()=>{if(!frame.coupling)throw Error('请先启用耦合');download('\ufeff'+coupledCSV(history.frames),'summer-coupled-history.csv','text/csv;charset=utf-8');});
  $('mbd-export-particles').onclick=guard(()=>{const f=displayFrame();if(!f.particles)throw Error('请先启用耦合');const rows=['time_s,particle,x_m,y_m,z_m,temperature_C,relative_stress,plastic_strain'];for(let i=0;i<f.particles.length;i+=8)rows.push([f.time,i/8,...f.particles.slice(i,i+3),f.particles[i+4],f.particles[i+6],f.particles[i+7]].join(','));download('\ufeff'+rows.join('\n'),'summer-coupled-particles.csv','text/csv;charset=utf-8');});
  $('mbd-export-json').onclick=()=>download(JSON.stringify(sim.project,null,2),'summer-project.json','application/json');
  $('mbd-export-csv').onclick=guard(()=>download('\ufeff'+history.csv(),'summer-multibody-bodies.csv','text/csv;charset=utf-8'));
  $('mbd-export-joints').onclick=guard(()=>{const rows=['time_s,joint_id,type,coordinate_rad_or_m,anchor_error_m,spring_force_estimate_N,transmission_phase_error_rad,transmission_speed_error_rad_s,transmission_torque_Nm'];for(const f of history.frames)for(const j of f.joints)rows.push([f.time,j.id,j.type,j.coordinate??'',j.error,j.springForce??'',j.phaseError??'',j.speedError??'',j.transmittedTorque??''].join(','));download('\ufeff'+rows.join('\n'),'summer-multibody-joints.csv','text/csv;charset=utf-8');});
  function seek(i){running=false;replaying=false;cursor=Math.max(0,Math.min(history.frames.length-1,Math.round(i)));updateUI();}
  $('mbd-frame').oninput=()=>seek(Number($('mbd-frame').value));$('mbd-live').onclick=()=>{cursor=null;replaying=false;updateUI();};
  $('mbd-replay').onclick=()=>{if(!history||history.frames.length<2)return;running=false;if(replaying){replaying=false;return;}if(cursor==null||cursor===history.frames.length-1)cursor=0;playTime=history.at(cursor).time;replaying=true;};
  function displayFrame(){return cursor==null?frame:history.at(cursor);}
  function valueAt(f){const b=f.bodies.find(b=>b.id===$('mbd-result-body').value),j=f.joints.find(j=>j.id===$('mbd-result-joint').value),key=$('mbd-result-field').value;if(['temperature','dx','dy','dz','speed','contactForce','plastic','count','damage','failed'].includes(key))return partField(f,$('mbd-result-body').value,key);if(key.startsWith('diagnostics:'))return f.diagnostics?.[key.slice(12)]??null;if(key==='energy')return f.energy;const coupled={particleTemperature:'meanTemperature',particleMaxTemperature:'maxTemperature',thermalResidual:'thermalResidual',particlePlastic:'maxPlastic'};if(key in coupled)return f.coupling?.[coupled[key]]??null;if(key==='temperature'||key==='contactHeatRate')return b?.[key]??null;if(key==='contactForce')return b?.contactForce?norm(b.contactForce):null;if(['coordinate','error','springForce','phaseError','speedError','transmittedTorque','power','bodyPower','work','elasticEnergy'].includes(key))return j?.[key]??null;if(key==='regionForce')return j?.force?norm(j.force):null;if(key==='regionTorque')return j?.torque?norm(j.torque):null;if(!b)return null;return {dx:b.displacement[0],dy:b.displacement[1],dz:b.displacement[2],speed:norm(b.velocity),omega:norm(b.angularVelocity),acceleration:f.time===0?null:norm(b.acceleration),kinetic:b.kinetic}[key];}
  function chart(){const c=$('mbd-chart'),rect=c.getBoundingClientRect();if(!rect.width||!history)return;const dpr=Math.min(devicePixelRatio,2);c.width=Math.round(rect.width*dpr);c.height=Math.round(165*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=165,data=history.frames.map(f=>[f.time,valueAt(f)]).filter(p=>p[1]!==null),color=getComputedStyle(document.body).getPropertyValue('--ink')||'#333';ctx.clearRect(0,0,w,h);ctx.strokeStyle='#8a999980';ctx.strokeRect(39,12,w-47,h-37);if(!data.length)return;let lo=Math.min(...data.map(p=>p[1])),hi=Math.max(...data.map(p=>p[1]));if(hi-lo<1e-9){hi+=.5;lo-=.5;}const tmax=Math.max(.001,history.frames.at(-1).time),x=t=>39+t/tmax*(w-47),y=v=>12+(hi-v)/(hi-lo)*(h-37);ctx.font='9px Consolas';ctx.fillStyle=color;ctx.fillText(hi.toPrecision(3),1,17);ctx.fillText(lo.toPrecision(3),1,h-23);ctx.fillText('0 s',39,h-7);ctx.fillText(tmax.toFixed(2)+' s',w-52,h-7);ctx.beginPath();data.forEach(([t,v],i)=>i?ctx.lineTo(x(t),y(v)):ctx.moveTo(x(t),y(v)));ctx.strokeStyle='#429eab';ctx.lineWidth=1.7;ctx.stroke();ctx.beginPath();ctx.moveTo(x(displayFrame().time),12);ctx.lineTo(x(displayFrame().time),h-25);ctx.strokeStyle='#c48b48';ctx.stroke();}
  $('mbd-chart').onpointerdown=e=>{if(!history?.frames.length)return;const rect=$('mbd-chart').getBoundingClientRect(),t=Math.max(0,Math.min(1,(e.clientX-rect.left-39)/(rect.width-47)))*history.frames.at(-1).time;let i=history.frames.findIndex(f=>f.time>=t);seek(i<0?history.frames.length-1:i);};
  for(const id of ['mbd-result-body','mbd-result-field','mbd-result-joint'])$(id).onchange=()=>updateUI();
  function updateUI(){if(!frame)return;updateRunControls();simpleUI?.update();assistantUI?.update();
    if(!running&&!pendingStep&&!pendingLoad&&!femSolving)storeRun();
    $('model-editing-status').hidden=!frame.preview;
    if(frame.preview){
      const message='模型编辑中 · 仅显示初始几何，尚未生成计算结果。'+frame.reason;
      $('model-editing-status').textContent=message;$('mbd-engine-status').textContent=message;
      $('mbd-title').textContent=sim.project.name;$('mbd-statistics').textContent=sim.project.parts.length+' 部件 · 几何预览';
      $('run-state').textContent=message;$('mbd-toggle').disabled=true;$('fem-run').disabled=true;$('fem-step').disabled=true;
      $('mbd-result-readout').textContent='尚无计算结果';timeline.hidden=true;
      $('workspace-status3').textContent='EDITING / GEOMETRY PREVIEW';return;
    }
    if(frame.fem){updateStaticUI();return;}const f=displayFrame(),b=f.bodies.find(b=>b.id===$('mbd-result-body').value),j=f.joints.find(j=>j.id===$('mbd-result-joint').value);$('mbd-title').textContent=model.name;$('mbd-statistics').textContent=`${model.bodies.length} 刚体 · ${f.coupling?f.coupling.count+' MPM/PBF · ':''}${f.joints.length} 连接 · ${f.time.toFixed(3)} s\n最大连接点误差 ${f.maxError.toExponential(2)} m`;
    const frameBody=f.bodies.find(b=>b.id==='bike-frame'),frameOmega=frameBody?.angularVelocity[2]??0,wheel=f.bodies.find(b=>b.id==='rear-wheel'),crank=f.bodies.find(b=>b.id==='crank'),gear=f.joints.find(j=>j.type==='gear');const en=document.documentElement.lang==='en';$('assembly-status').textContent=wheel&&crank?`${en?'Rear wheel':'后轮'} ${(frameOmega-wheel.angularVelocity[2]).toFixed(2)} rad/s · ${en?'Cadence':'踏频'} ${((frameOmega-crank.angularVelocity[2])*30/Math.PI).toFixed(1)} rpm\n${en?'Distance':'前进'} ${wheel.displacement[0].toFixed(2)} m · ${en?'Phase error':'传动相位误差'} ${(gear?.phaseError??0).toExponential(2)} rad`:'';
    const front=f.bodies.find(b=>b.id==='front-wheel'),impact=!!front&&(model.bodies.some(b=>b.id==='pool-ramp-entry')||model.coupling?.parts.some(p=>p.id==='impact-wall'));$('mbd-impact-readout').hidden=!impact;if(impact)$('mbd-impact-readout').textContent=`${en?'Travel':'前进'} ${front.displacement[0].toFixed(2)} m · ${en?'Speed':'车速'} ${front.velocity[0].toFixed(2)} m/s\n${en?'Front wheel contact':'前轮接触力'} ${norm(front.contactForce??[0,0,0]).toFixed(1)} N\n${en?'Front axle rise':'前轴升高'} ${front.displacement[1].toFixed(2)} m · ${en?'Frame pitch':'车架俯仰'} ${(frameBody?Math.atan2(2*(frameBody.rotation[3]*frameBody.rotation[2]+frameBody.rotation[0]*frameBody.rotation[1]),1-2*(frameBody.rotation[1]**2+frameBody.rotation[2]**2))*180/Math.PI:0).toFixed(1)}°`;
    $('mbd-toggle').textContent=running?'暂停':'运行';$('mbd-replay').textContent=replaying?'暂停回放':'回放动画';$('mbd-frame').max=Math.max(0,history.frames.length-1);$('mbd-frame').value=cursor??history.frames.length-1;$('mbd-frame-time').textContent=`${cursor==null?'求解末帧':'回放帧'} · ${f.time.toFixed(3)} / ${frame.time.toFixed(3)} s`;
    const c=f.coupling;$('mbd-coupling-readout').textContent=c?`MPM ${c.solids} · PBF ${c.liquids} · ${c.minTemperature.toFixed(2)}–${c.maxTemperature.toFixed(2)}°C\n热量残差 ${c.thermalResidual.toExponential(2)} J · 外部热量 ${c.externalHeat.toFixed(1)} J\n${f.particleColorMode==='material'?(model.bodies.some(b=>b.id==='pool-ramp-entry')?(en?'Blue: PBF · grey: fixed ramps':'蓝：PBF 水 · 灰：固定坡道'):(en?'Blue: PBF · purple: wall · orange: brittle · gold: failed':'蓝：PBF · 紫：原墙 · 橙：脆性墙 · 金：失效')):'温度着色 20–120°C'} · ${model.coupling.thermal?`传热 ${model.coupling.thermalScale}×`:"传热关闭"}`:'';
    if(c?.damaged)$('mbd-coupling-readout').textContent+=`\n${en?'Failed MPM particles':'失效 MPM 粒子'} ${c.damaged}`;
    const value=valueAt(f);$('mbd-result-readout').textContent=`t ${f.time.toFixed(4)} s · ${$('mbd-result-field').selectedOptions[0].textContent}: ${value==null?'—':value.toPrecision(6)}\n${b?`位置 (${b.position.map(x=>x.toFixed(4)).join(', ')}) m\n姿态 q (${b.rotation.map(x=>x.toFixed(4)).join(', ')})\n速度 (${b.velocity.map(x=>x.toFixed(4)).join(', ')}) m/s\n角速度 (${b.angularVelocity.map(x=>x.toFixed(4)).join(', ')}) rad/s`:''}${j?`\n${j.name} · ${j.type} · 连接点误差 ${j.error.toExponential(3)} m`:''}`;
    const device=recorded?'Taichi CUDA · RECORDED':f.backend?`Taichi ${f.backend.arch.toUpperCase()} + CPU`:'CPU';$('project-compute-apply').disabled=!!pendingLoad;$('project-compute-status').textContent=computeError?`${device} · ${computeError}`:pendingLoad?'正在连接或加载 GPU 项目…':f.backend?`${device} · ${f.backend.device}\n${en?'Last batch':'上一批次'} ${(f.performance?.stepMs??0).toFixed(1)} ms · ${en?'Simulation rate':'模拟速度'} ${(f.performance?.rate??0).toFixed(2)}×${f.performance?.couplingPath==='gpu-regions'?`\n${en?'Region constraints, solid contact & enabled heat transfer on GPU':'区域连接、固体接触及启用的传热在 GPU 求解'}`:''}`:'CPU · MPM / MBD / THERMAL';if(recorded)$('project-compute-status').textContent=en?'Recorded CUDA results · reset to solve again':'已计算的 CUDA 回放 · 重置后可重新求解';
    if(active)$('workspace-status3').textContent=`${running?'SOLVING':replaying?'REPLAY':recorded?'RECORDED CUDA':'PAUSED'} / PROJECT · ${device} / ${f.time.toFixed(3)} s / ${history.frames.length} 帧`;chart();
  }
  let drag=null;canvas.oncontextmenu=e=>e.preventDefault();canvas.onpointerdown=e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};canvas.onpointermove=e=>{if(!e.buttons)drag=null;if(drag&&view){view.orbit(e.clientX-drag[0],e.clientY-drag[1]);drag=[e.clientX,e.clientY];}};canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;canvas.onwheel=e=>{e.preventDefault();if(view)view.distance=Math.max(frame?.fem?.005:.1,Math.min(500,view.distance*Math.exp(e.deltaY*.001)));};
  canvas.onkeydown=e=>{if(e.code==='Space'){e.preventDefault();e.stopPropagation();$('mbd-toggle').click();}};
  window.addEventListener('workbench-study',e=>{const next=e.detail==='project';if(next===active)return;active=next;document.body.classList.toggle('mbd-active',active);canvas.hidden=hud.hidden=transport.hidden=!active;timeline.hidden=!active||frame?.fem?.analysis==='linear-static'||location.hash!=='#results';running=false;replaying=false;lastNow=0;onMode(active);
    if(active&&!loading){loading=(async()=>{try{engine=await import('../multibody/engine.js');await engine.initialize();const {cpuCoupledAdapter}=await import('./cpu-adapter.js');const {gpuCoupledAdapter}=await import('./gpu-adapter.js');const {femStaticAdapter,femDynamicAdapter}=await import('../fem/adapter.js');sim=new ProjectSession(new SolverRegistry().register(cpuCoupledAdapter).register(gpuCoupledAdapter()).register(femStaticAdapter).register(femDynamicAdapter).register(mixedAdapter));wireProject();const {MultibodyRenderer}=await import('../multibody/renderer.js');view=new MultibodyRenderer(canvas);new ResizeObserver(()=>{if(active)view.resize();}).observe(canvas);const initial=initialPreset==='named-surfaces'?await namedSurfaceExample():initialPreset==='cad-hole'?await cadExample():initialPreset==='unified-pbd'?unifiedPBDExample():initialPreset==='particle-pairs'?particlePairExample():initialPreset==='contact-squeeze'?contactSqueezeExample():initialPreset==='contact-safety'?contactSafetyExample():initialPreset==='unified-fluid-impact'?fourGPUFluidImpactExample():initialPreset==='unified-gpu'?fourGPUExample():initialPreset==='empty'?emptyProject():initialPreset==='unified-contact'?unifiedContactExample():initialPreset==='unified'?unifiedExample():initialPreset==='mpm-fem-energy'?mixedGPUEnergyProject():initialPreset==='mpm-fem-dissipation'?mixedGPUDissipationProject():initialPreset==='mpm-fem-thermomechanical'?mixedGPUThermomechanicalProject():initialPreset==='mpm-fem-gpu-thermal'?mixedGPUThermalProject():['mpm-fem-10k','mpm-fem-50k'].includes(initialPreset)?mixedScaleProject(initialPreset==='mpm-fem-10k'?10000:50000):initialPreset==='mpm-fem-thermal-contact'?mixedThermalContactProject():initialPreset==='mpm-fem-impact'?mixedImpactProject():initialPreset==='fem-thermal'?femThermalExample():initialPreset==='mpm-part-thermal'?mpmPartThermalExample():initialPreset==='fem-impact'?impactProject():initialPreset==='fem-release'?dynamicCantileverProject():initialPreset==='fem-cantilever'?cantileverProject():initialPreset==='material-impact'?materialContactExample():initialPreset==='contact-slide'?contactExample():initialPreset==='staged-thermal'?stagedExample():initialPreset.startsWith('thermal-')?thermalExample(initialPreset==='thermal-release'):initialPreset.startsWith('grip-')?gripExample(initialPreset==='grip-twist'):initialPreset==='references'?referenceExample():fromLegacy(model);if(initial.solver.computeBackend==='gpu')initial.solver.mixedGpuPort=Number(query.get('mixedGpuPort')??initial.solver.mixedGpuPort??8795);if(initial.solver.adapter.startsWith('cpu-fem-'))await loadAuthoring(initial);else finishLoad(sim.replace(initial));if(initialAdapter==='taichi-coupled'&&!initial.solver.adapter.startsWith('cpu-fem-')){initial.solver.adapter=initialAdapter;initial.solver.gpuPort=Number(query.get('projectGpuPort')??8769);await load(initial);}if(['course','ramps'].includes(query.get('replay')))await loadCourseRecording();}catch(e){loading=null;$('mbd-engine-status').textContent='项目求解器加载失败：'+e.message;toast(e.message);}})();}else if(active&&view){view.resize();updateUI();}

  });
  window.addEventListener('workbench-chapter',e=>{timeline.hidden=!active||frame?.fem?.analysis==='linear-static'||e.detail!=='results';if(active)updateUI();});
  return {get active(){return active;},get coordinateContext(){return {renderer:view,domain:frame?.fem?view?.domain:model.coupling?.domain??null,unit:'m',project:true,fem:!!frame?.fem};},tick(now){if(!active||!view||!sim||!frame)return;const elapsed=lastNow?Math.min(.05,(now-lastNow)/1000):0;lastNow=now;
    try{if(running&&sim.asynchronous&&!pendingStep&&!pendingLoad){
      const base=frame.fem?.dynamics?.dt??Math.min(model.dt,model.coupling?.enabled?1/480:model.dt);
      const outputInterval=sim.project.solver.outputInterval??(frame.mixed?.backend ? .01 : frame.mixed?.thermalMode==='fixed-geometry' ? .1 : 1/60);
      const dt=interactiveInterval(frame,outputInterval,endTime-sim.time,base),before=frame.time;batchStarted=performance.now();
      pendingStep=sim.step(dt).then(next=>{monitor.record(next.time-before,(performance.now()-batchStarted)/1000);batchStarted=0;frame=next;recordFrame(frame,!running);if(sim.time>=endTime-1e-9){running=false;recordFrame(frame,true);}updateUI();}).catch(e=>{running=false;computeError=e.message;toast(e.message);$('mbd-engine-status').textContent=e.message;}).finally(()=>{pendingStep=null;batchStarted=0;});
    }else if(running&&!sim.asynchronous&&!pendingLoad){const before=frame.time;budget+=elapsed;const deadline=performance.now()+9;while(budget>=model.dt&&running&&performance.now()<deadline){const dt=Math.min(model.dt,endTime-sim.time);frame=sim.step(dt);recordFrame(frame);budget-=dt;if(sim.time>=endTime-1e-9){running=false;recordFrame(frame,true);}}monitor.record(frame.time-before,elapsed);budget=Math.min(budget,.1);}
      if(replaying){playTime+=elapsed*Number($('mbd-replay-speed').value);while(cursor<history.frames.length-1&&history.at(cursor+1).time<=playTime)cursor++;if(cursor===history.frames.length-1)replaying=false;}
    }catch(e){running=false;replaying=false;toast(e.message);$('mbd-engine-status').textContent=e.message;}
    view.particleShading=particleView.particleShading;view.background=particleView.background;view.lightBackground=particleView.lightBackground;const f=displayFrame(),selected=$('mbd-result-body').value,trace=$('mbd-trace').checked?history.frames.filter((x,i)=>i%2===0&&x.time<=f.time).map(f=>f.results?.parts.find(b=>b.id===selected)?.values.position).filter(Boolean):[];const bike=f.bodies.find(b=>b.id==='bike-frame');if(bike&&$('assembly-follow').checked&&followPosition)view.target=view.target.map((x,a)=>x+bike.position[a]-followPosition[a]);followPosition=bike?.position.slice()??null;if(f.preview){view.referenceAxes=[];view.referenceSelection=null;}else if(f.fem){view.referenceAxes=[];view.referenceSelection=null;femUI?.display(f);curvesUI?.display(f);contactUI?.display(f);thermalUI?.display(f);}else{referenceUI?.display(f,view);attachmentUI?.display(f);validationUI?.display(f);curvesUI?.display(f);contactUI?.display(f);thermalUI?.display(f);}view.drawFrame(f,selected,trace);if(now-lastUI>100){updateUI();lastUI=now;}
  }};
}
