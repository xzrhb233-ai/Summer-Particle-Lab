import {fractureParameters} from '../three/fracture.js';
import {domainParameters,geometryParameters} from '../three/discretization.js';
import {thermalParameters} from '../three/thermal-plasticity.js';
import {phaseParameters} from '../three/phase-change.js';
import {samplingOptions} from '../three/sampling.js';
import {plasticityParameters} from '../three/metal-plasticity.js';
import {pressureParameters} from '../three/pressure-plasticity.js';
import {attachmentDefinitions} from './attachment-model.js';
// A legacy parcel has volume 64 length units³ and 0.001 m³: 1 unit = 0.025 m.
export const LENGTH=.025,MAX_COUPLED_PARTICLES=16384;
const finite=(v,lo,hi,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)throw Error(label+'超出范围');return v;};
const vec=(v,label)=>{if(!Array.isArray(v)||v.length!==3)throw Error(label+'需要 XYZ');return v.map(x=>finite(x,-60,60,label));};
export function bodyThermal(v={}){return {temperature:finite(v.temperature??20,-273.15,2000,'刚体温度'),cp:finite(v.cp??500,1,100000,'刚体比热容'),conductivity:finite(v.conductivity??50,.001,10000,'刚体导热率'),power:finite(v.power??0,-1e7,1e7,'刚体热功率')};}
export function couplingParameters(v){
  if(v==null)return null;
  if(typeof v!=='object'||typeof v.enabled!=='boolean')throw Error('耦合设置无效');
  const domain=v.domain??{lower:[-3,-1,-3],upper:[3,4,3],cellSize:.2,particlesPerAxis:2};
  if(!Number.isInteger(domain.particlesPerAxis)||domain.particlesPerAxis<1||domain.particlesPerAxis>4||domain.cellSize/domain.particlesPerAxis<.025-1e-10||domain.cellSize/domain.particlesPerAxis>.1+1e-10)throw Error('耦合每轴粒子数须为 1–4，粒子间距 h/n 须在 0.025–0.1 m 内');
  const d=domainParameters({lower:vec(domain.lower,'计算域').map(x=>x/LENGTH),upper:vec(domain.upper,'计算域').map(x=>x/LENGTH),cellSize:finite(domain.cellSize,.1,.4,'网格边长')/LENGTH,particlesPerAxis:domain.particlesPerAxis});
  const parts=v.parts??[];if(!Array.isArray(parts)||parts.length>16)throw Error('耦合工作区最多 16 个粒子部件');
  const parsed=parts.map((p,i)=>{
    const shape=p.shape??'box',center=vec(p.center,'试样中心'),size=vec(p.size,'试样尺寸'),rotation=p.rotation??[0,0,0];
    geometryParameters({shape,cad:p.cad,center:center.map(x=>x/LENGTH),size:size.map(x=>x/LENGTH),rotation},d);
    const thermalMaterial=thermalParameters(p.thermalMaterial),phaseChange=phaseParameters(p.phaseChange),sampling=samplingOptions(p.sampling??{enabled:true}),plasticity=plasticityParameters(p.plasticity),pressure=pressureParameters(p.pressure);
    if(!thermalMaterial||!phaseChange||!sampling||!plasticity||!pressure)throw Error('试样本构、相变或采样参数无效');
    const method=p.method??'mpm',fracture=fractureParameters(p.fracture);
    if(!['mpm','pbf'].includes(method))throw Error('粒子离散方法须为 MPM 或 PBF');
    if(method==='pbf'&&(fracture.enabled||phaseChange.enabled||p.fixedFace&&p.fixedFace!=='none'))throw Error('PBF 水不使用固体断裂、固定位移或 MPM 相变参数');
    if(fracture.enabled&&(p.model??10)!==0)throw Error('当前脆性损伤使用共旋转弹性本构');
    const model=finite(p.model??10,0,11,'试样本构');if(!Number.isInteger(model))throw Error('本构编号须为整数');
    const velocity=vec(p.velocity??[0,0,0],'试样初速度');if(velocity.some(x=>Math.abs(x)>2))throw Error('试样初速度各方向最多 2 m/s');
    const fixedFace=p.fixedFace??'none';if(!['none','minX','maxX','minY','maxY','minZ','maxZ'].includes(fixedFace))throw Error('MPM 固定面无效');
    if(p.id!=null&&(typeof p.id!=='string'||!/^[-\w]{1,40}$/.test(p.id)))throw Error('MPM 部件 ID 无效');
    let fixedRegions;
    if(p.fixedRegions!==undefined){
      if(method!=='mpm'||!Array.isArray(p.fixedRegions)||p.fixedRegions.length>256)throw Error('固定区域格式无效');
      fixedRegions=p.fixedRegions.map(r=>{
        if(r?.type==='whole')return {type:'whole'};
        if(r?.type!=='box')throw Error('固定区域仅支持局部框选');
        const lower=vec(r.lower,'固定区域下限'),upper=vec(r.upper,'固定区域上限');
        if(lower.some((x,k)=>x>=upper[k]))throw Error('固定区域下限必须小于上限');
        return {type:'box',lower,upper};
      });
    }
    return {...(shape==='cad'?{cad:structuredClone(p.cad)}:{}),...(fixedRegions?{fixedRegions}:{}),...(p.id?{id:p.id}:{}),name:String(p.name??'MPM '+(i+1)).slice(0,80),shape,center,size,rotation,model,method,fracture,density:finite(p.density??(method==='pbf'?1000:1100),10,20000,'材料密度'),fixedFace,temperature:finite(p.temperature??20,-273.15,2000,'试样温度'),velocity,thermalMaterial,phaseChange,sampling,plasticity,pressure,yieldStrain:finite(p.yieldStrain??.025,.005,.08,'压缩屈服应变'),friction:finite(p.friction??35,15,50,'材料内摩擦角')};
  });
  const heater=v.heater??{};
  if(v.attachments?.length&&!v.enabled)throw Error('区域连接需要启用 MPM 耦合');
  return {enabled:v.enabled,mechanical:v.mechanical!==false,thermal:v.thermal!==false,attachments:attachmentDefinitions(v.attachments),domain:{lower:domain.lower.slice(),upper:domain.upper.slice(),cellSize:domain.cellSize,particlesPerAxis:domain.particlesPerAxis},parts:parsed,stiffness:finite(v.stiffness??1,.25,40,'MPM 刚度'),friction:finite(v.friction??.3,0,2,'耦合摩擦'),contactConductance:finite(v.contactConductance??1000,0,100000,'界面换热系数'),thermalScale:finite(v.thermalScale??1,1,1000,'传热倍率'),heater:{center:vec(heater.center??[0,.5,0],'热源中心'),radius:finite(heater.radius??.5,.01,10,'热源半径'),power:finite(heater.power??0,-1e7,1e7,'试样热功率')}};
}
