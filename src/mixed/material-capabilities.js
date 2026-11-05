// Keep authoring, validation and transport capability checks on one list.
export const MIXED_MPM_MODELS=Object.freeze([0,1,4,5,6,7,10,11]);
export const MIXED_PLASTIC_MODELS=Object.freeze([4,5,6,7,10,11]);
export const MIXED_METALS_FEATURE='mixedMetalPlasticityV1';
export const usesMixedMetals=project=>project.parts.some(p=>p.method==='mpm'&&[4,5,6,7].includes(p.material.model));
export function requireMixedMaterialFeatures(project,features=[]){
  if(usesMixedMetals(project)&&!features.includes(MIXED_METALS_FEATURE))throw Error('当前 GPU 服务尚未加载 J2 / Johnson–Cook 联算本构。请启动新版 start-mixed-gpu.ps1，或使用新端口；当前项目未替换。');
}
