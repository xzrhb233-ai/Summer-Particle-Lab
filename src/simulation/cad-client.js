import {validateCAD,validateCADRecipe} from '../three/cad-geometry.js';
import {validateCurveSpec,validateCurve,validateMeshOptions,validateCADMesh} from '../three/cad-tools.js';
import {validateSurfaceSpec,validateSurface} from '../three/cad-surfaces.js';

// The browser calls only the application's fixed CAD endpoint. Recipes contain
// declarative geometry; no file paths, executable scripts or API keys are sent.
export async function requestCAD(action,recipe,{signal}={}){
  if(!['health','build','export','curve','mesh','surface'].includes(action))throw Error('未知 CAD 操作');
  let payload;
  if(action==='surface')payload={action,spec:validateSurfaceSpec(recipe)};
  else if(action==='curve')payload={action,spec:validateCurveSpec(recipe)};
  else if(action==='mesh')payload={action,recipe:validateCADRecipe(recipe.recipe),options:validateMeshOptions(recipe.options)};
  else payload=action==='health'?{action}:{action,recipe:validateCADRecipe(recipe)};
  let response;
  try{
    response=await fetch('/api/cad',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
  }catch(error){
    if(error.name==='AbortError')throw error;
    throw Error('无法连接本地 CAD 服务，请检查 Summer Lab 服务是否正在运行');
  }
  if(response.status===404)throw Error('当前服务还未加载 CAD 接口，请重启桌面 Summer Lab 服务');
  let data;
  try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw Error(`CAD 服务返回了无法读取的结果（HTTP ${response.status}）`);}
  if(!response.ok)throw Error(typeof data?.error==='string'?data.error.slice(0,1000):`CAD 运算失败（HTTP ${response.status}）`);
  return data;
}

export async function buildCurve(spec,options){
  const requested=validateCurveSpec(spec),curve=validateCurve(await requestCAD('curve',requested,options));
  if(JSON.stringify(validateCurveSpec(curve.spec))!==JSON.stringify(requested))throw Error('曲线返回的参数与请求不一致');return curve;
}
export async function buildSurface(spec,options){
  const requested=validateSurfaceSpec(spec),surface=validateSurface(await requestCAD('surface',requested,options));
  if(JSON.stringify(validateSurfaceSpec(surface.spec))!==JSON.stringify(requested))throw Error('曲面返回的控制网与请求不一致');return surface;
}
export async function buildMesh(recipe,meshOptions,options){
  const requested=validateCADRecipe(recipe),requestedOptions=validateMeshOptions(meshOptions),mesh=validateCADMesh(await requestCAD('mesh',{recipe:requested,options:requestedOptions},options));
  if(JSON.stringify(validateCADRecipe(mesh.cad.recipe))!==JSON.stringify(requested))throw Error('网格返回的几何步骤与请求不一致');
  if(JSON.stringify(validateMeshOptions(mesh.options))!==JSON.stringify(requestedOptions))throw Error('网格返回的尺寸或容差与请求不一致，请重新生成');return mesh;
}

export async function buildCAD(recipe,options){
  const requested=validateCADRecipe(recipe),built=validateCAD(await requestCAD('build',requested,options));
  if(JSON.stringify(validateCADRecipe(built.recipe))!==JSON.stringify(requested))throw Error('CAD 服务返回的步骤与请求不一致，请重新生成预览');
  return built;
}
