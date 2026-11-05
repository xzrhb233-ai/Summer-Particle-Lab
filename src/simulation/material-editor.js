import {PLASTICITY_DEFAULTS,plasticityParameters} from '../three/metal-plasticity.js';
import {THERMAL_DEFAULTS,thermalParameters} from '../three/thermal-plasticity.js';
import {PRESSURE_DEFAULTS,pressureParameters} from '../three/pressure-plasticity.js';

export const materialGroups={
  plasticity:{defaults:PLASTICITY_DEFAULTS,validate:plasticityParameters,fields:[
    ['A','屈服强度 A / E₀',[4,5,6,7]],['B','硬化系数 B / E₀',[5,6,7]],['n','硬化指数 n',[6,7]],['C','应变率系数 C',[6,7]],['rate0','参考应变率（1/s）',[6,7]],['Tref','JC 参考温度（°C）',[6]],['Tm','JC 熔化参考温度（°C）',[6]],['m','热软化指数 m',[6]]]},
  thermalMaterial:{defaults:THERMAL_DEFAULTS,validate:thermalParameters,fields:[
    ['Tref','参考温度（°C）',[10,11]],['Thot','高温参考点（°C）',[10]],['hotRatio','高温屈服强度比',[10]],['A','参考屈服强度 / E₀',[10]],['H','硬化模量 / E₀',[10]],['rate','参考蠕变率（1/s）',[11]],['Q','激活能（J/mol）',[11]],['n','蠕变指数',[11]],['stress','参考蠕变应力 / E₀',[11]]]},
  pressure:{defaults:PRESSURE_DEFAULTS,validate:pressureParameters,fields:[
    ['cohesion','黏聚力 / E₀',[8]],['slope','压力敏感系数',[8]],['dilatancy','剪胀系数',[8]],['tension','拉伸强度 / E₀',[8]],['alpha','泡沫压力敏感系数 α',[9]],['plateau','平台屈服强度 / E₀',[9]],['gamma','线性硬化系数 / E₀',[9]],['densify','压密系数 / E₀',[9]],['beta','压密指数',[9]],['epsD','压密参考应变',[9]]]}
};
// Existing solver convention: E_internal=rho*0.001/64*16000*s,
// E_SI=E_internal/LENGTH, LENGTH=0.025 m. This is a reference E, not
// the evolving tangent modulus after thermal softening or snow compaction.
export const referenceYoung=(density,stiffness)=>10*density*stiffness;
export function materialParameterPatch(model,values){
  const patch={};
  for(const [group,spec] of Object.entries(materialGroups))if(spec.fields.some(f=>f[2].includes(model))){
    const parsed=spec.validate(values[group]);if(!parsed)throw Error('本构参数无效：'+group);
    patch[group]=parsed;
  }
  return patch;
}
