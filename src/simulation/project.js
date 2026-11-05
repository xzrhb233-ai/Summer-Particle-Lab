import {validateModel} from '../multibody/model.js';
import {couplingParameters} from '../multibody/coupling-model.js';
import {validateReferences,compileConnection} from './references.js';
import {normalizeCurves} from './curves.js';
import {isThermalLoad,normalizeThermalLoads} from './thermal-loads.js';
import {validateCouplingOptions} from './coupling-mode.js';
import {normalizeCADCurves} from '../three/cad-tools.js';
import {normalizeCADSurfaces} from '../three/cad-surfaces.js';
import {validateParametricPart} from './cad-parametric.js';

export const PROJECT_SCHEMA = 'summer-project/1';
export const METHODS = Object.freeze({
  rigid: {label: '刚体', available: true},
  pbf: {label: 'PBF', available: true},
  mpm: {label: 'MPM', available: true},
  fem: {label: 'FEM', available: true},
});
const copy = value => structuredClone(value);

// This is the sole editable project document. Solver-specific models are
// compiled projections, not additional documents with their own object IDs.
export function fromLegacy(input) {
  const m = validateModel(input), c = m.coupling;
  const parts = m.bodies.map(b => ({
    id: b.id, name: b.name, method: 'rigid',
    geometry: {shape: b.shape, center: b.position, size: b.size, rotation: b.rotation, appearance:b.appearance},
    material: {mass: b.mass, cp: b.thermal.cp, conductivity: b.thermal.conductivity},
    initial: {velocity: b.velocity, angularVelocity: b.angularVelocity, temperature: b.thermal.temperature},
    boundary: {motion: b.type, friction: b.friction, restitution: b.restitution, damping: b.damping,collisionFamily:b.collisionFamily},
  }));
  const used = new Set(parts.map(p => p.id));
  for (const [i, p] of (c?.parts ?? []).entries()) {
    let id = p.id ?? 'mpm-' + (i + 1);
    if (p.id && used.has(id)) throw Error('部件 ID 不可重复：' + id);
    while (used.has(id)) id += '-mpm';
    used.add(id);
    const {shape, cad, center, size, rotation, name, temperature, velocity, sampling, fixedFace, method, id: oldID, ...material} = p;
    parts.push({id, name, method: method??'mpm', geometry: {shape, ...(cad?{cad}:{}), center, size, rotation}, material,
      initial: {temperature, velocity}, boundary: {fixedFace}, discretization: {sampling}});
  }
  const loads = m.bodies.flatMap(b => [
    {id: 'force-' + b.id, type: 'body-force', target: b.id, force: b.force, torque: b.torque},
    {id: 'heat-' + b.id, type: 'body-heat', target: b.id, power: b.thermal.power},
  ]);
  if (c) loads.push({id: 'mpm-heat', type: 'region-heat', target: 'mpm', ...copy(c.heater)});
  const frames=[],selectionSets=[],connections=copy(m.joints);
  for(const a of c?.attachments??[]){
    if(!frames.some(f=>f.id===a.frame.id))frames.push(copy(a.frame));
    if(!selectionSets.some(s=>s.id===a.selection.id))selectionSets.push(copy(a.selection));
    connections.push({id:a.id,name:a.name,type:'region',a:a.body,b:a.part,mode:a.mode,stiffness:a.stiffness,damping:a.damping,endpoints:{a:{frame:a.frame.id},b:{selection:a.selection.id}}});
  }
  return {
    schema: PROJECT_SCHEMA, name: m.name,
    units: {length: 'm', mass: 'kg', time: 's', temperature: 'degC'},
    parts, connections, loads, frames, selectionSets,curves:copy(m.curves),loadBindings:copy(m.loadBindings),contactPairs:copy(m.contactPairs),
    environment: {gravity: m.gravity},
    discretization: {mpm: c ? copy(c.domain) : null},
    couplings: c ? [{id: 'rigid-mpm', type: 'contact', methods: c.parts.some(p=>p.method==='pbf')?['rigid','mpm','pbf']:['rigid', 'mpm'],
      mechanical: c.mechanical, thermal: c.thermal, friction: c.friction,
      contactConductance: c.contactConductance, thermalScale: c.thermalScale}] : [],
    solver: {adapter: 'cpu-coupled', dt: m.dt, iterations: m.iterations,
      mpmEnabled: c?.enabled ?? false, stiffness: c?.stiffness ?? 1},
  };
}

// Validation of numerical ranges stays with the existing, tested physics
// validators. References and unsupported capabilities are checked here first.
export function toLegacy(project) {
  if (project?.schema !== PROJECT_SCHEMA) throw Error('统一项目格式无效');
  const p = normalizeProject(project);
  if(p.parts.some(b=>b.method==='fem')||p.solver.adapter.startsWith('cpu-fem-'))throw Error('FEM 使用独立分析适配器，不能转换为刚体 / MPM 动力学模型');
  if (JSON.stringify(p.units) !== JSON.stringify({length: 'm', mass: 'kg', time: 's', temperature: 'degC'})) {
    // Key order is immaterial for user-authored JSON.
    if (!p.units || p.units.length !== 'm' || p.units.mass !== 'kg' || p.units.time !== 's' || p.units.temperature !== 'degC') throw Error('统一项目使用 m、kg、s、°C');
  }
  if (!Array.isArray(p.parts) || p.parts.length > 80 || !Array.isArray(p.loads) || !Array.isArray(p.connections) || !Array.isArray(p.couplings)) throw Error('项目部件、载荷或连接格式无效');
  if (!['cpu-coupled','taichi-coupled'].includes(p.solver?.adapter)) throw Error('当前项目求解器未注册：' + p.solver?.adapter);
  const ids = new Set();
  for (const part of p.parts) {
    if (!part || !/^[-\w]{1,40}$/.test(part.id) || ids.has(part.id)) throw Error('部件 ID 无效或重复');
    if (!METHODS[part.method]?.available) throw Error(part.method === 'fem' ? 'FEM 求解器尚未实现；当前项目未被替换' : '未知部件离散方法');
    if (!part.geometry || !part.material || !part.initial) throw Error('部件几何、材料或初始条件缺失');
    ids.add(part.id);
  }
  if (p.couplings.length > 1) throw Error('当前接触适配器仅支持一个全局刚体–MPM 接触配置');
  const contact = p.couplings[0];
  if (contact && (contact.type !== 'contact' || !['["rigid","mpm"]','["rigid","mpm","pbf"]'].includes(JSON.stringify(contact.methods)))) throw Error('未实现的耦合接口');
  const rigid = p.parts.filter(x => x.method === 'rigid'), mpm = p.parts.filter(x => ['mpm','pbf'].includes(x.method));
  const loads = new Map(), loadIDs = new Set();
  for (const load of p.loads) {
    if(isThermalLoad(load))continue; // executed by the shared energy receivers
    if(load.type==='fixed-selection'){
      if(!load.id||loadIDs.has(load.id))throw Error('载荷 ID 无效或重复');
      loadIDs.add(load.id);continue;
    }
    const valid = ['body-force', 'body-heat'].includes(load.type) ? rigid.some(b => b.id === load.target)
      : load.type === 'region-heat' && load.target === 'mpm';
    const key = load.type + ':' + load.target;
    if (!valid || !load.id || loadIDs.has(load.id) || loads.has(key)) throw Error('载荷目标无效或载荷重复');
    loads.set(key, load); loadIDs.add(load.id);
  }
  if (mpm.length && (!p.solver.mpmEnabled || !p.discretization?.mpm || !contact)) throw Error('MPM 部件需要启用 MPM 求解、网格和接触配置');
  const c = p.discretization?.mpm ? {
    ...contact, enabled: p.solver.mpmEnabled, domain: p.discretization.mpm,
    stiffness: p.solver.stiffness, heater: loads.get('region-heat:mpm'),
    attachments:p.connections.filter(j=>j.type==='region').map(j=>({...j,body:j.a,part:j.b,frame:copy(p.frames.find(f=>f.id===j.endpoints.a.frame)),selection:copy(p.selectionSets.find(s=>s.id===j.endpoints.b.selection))})),
    parts: mpm.map(b => {
      const regions=p.loads.filter(l=>l.type==='fixed-selection'&&l.target===b.id).map(l=>copy(p.selectionSets.find(s=>s.id===l.selection).region));
      return {...b.material, ...b.geometry, ...b.initial, method:b.method, id: b.id, name: b.name, sampling: b.discretization?.sampling, fixedFace:b.boundary?.fixedFace??b.material.fixedFace,
        fixedRegions:regions.length?regions:undefined};
    }),
  } : null;
  if (p.solver.mpmEnabled && !c) throw Error('MPM 求解缺少网格设置');
  return validateModel({schema: 'summer-mbd/1', name: p.name, dt: p.solver.dt, iterations: p.solver.iterations,
    gravity: p.environment?.gravity, joints: p.connections.filter(j=>j.type!=='region').map(j=>compileConnection(p,j)), coupling: c,curves:p.curves,loadBindings:p.loadBindings,contactPairs:p.contactPairs,
    bodies: rigid.map(b => {
      const f = loads.get('body-force:' + b.id), h = loads.get('body-heat:' + b.id);
      return {id: b.id, name: b.name, shape: b.geometry.shape, size: b.geometry.size,
        position: b.geometry.center, rotation: b.geometry.rotation,appearance:b.geometry.appearance,
        mass: b.material.mass, type: b.boundary?.motion, ...b.boundary,
        ...b.initial, force: f?.force, torque: f?.torque,
        thermal: {temperature: b.initial.temperature, cp: b.material.cp, conductivity: b.material.conductivity, power: h?.power}};
    }),
  });
}

export function normalizeProject(input) {
  if(input?.schema === 'summer-mbd/1') return fromLegacy(input);
  const p=copy(input);
  if(p?.schema!==PROJECT_SCHEMA||!Array.isArray(p.parts)||!Array.isArray(p.loads)||!Array.isArray(p.connections)||!Array.isArray(p.couplings))throw Error('统一项目格式无效');
  if(p.units?.length!=='m'||p.units?.mass!=='kg'||p.units?.time!=='s'||p.units?.temperature!=='degC')throw Error('统一项目使用 m、kg、s、°C');
  const ids=new Set();
  for(const b of p.parts){
    if(typeof b?.id!=='string'||!/^[-\w]{1,40}$/.test(b.id)||ids.has(b.id))throw Error('部件 ID 无效或重复');
    if(!METHODS[b.method])throw Error('未知部件离散方法');
    if(!b.geometry||!b.material||!b.initial)throw Error('部件几何、材料或初始条件缺失');
    if(b.modeling!=null)b.modeling=validateParametricPart(b);else delete b.modeling;
    ids.add(b.id);
  }
  // The schema can represent future methods; the selected adapter decides
  // whether it can actually solve them. Never silently remap FEM to rigid/MPM.
  const connectionIDs=new Set();
  for(const j of p.connections){
    if(!/^[-\w]{1,40}$/.test(j.id)||connectionIDs.has(j.id)||!ids.has(j.a)||!ids.has(j.b)||j.a===j.b||(j.carrier!=null&&!ids.has(j.carrier)))throw Error('连接 ID 或引用的部件无效');
    connectionIDs.add(j.id);
  }
  for(const l of p.loads)if(!ids.has(l.target)&&!(l.type==='region-heat'&&METHODS[l.target]))throw Error('载荷目标无效');
  if(typeof p.solver?.adapter!=='string')throw Error('项目求解器缺失');
  validateCouplingOptions(p.solver);
  if(p.solver.diagnostics!==undefined&&typeof p.solver.diagnostics!=='boolean')throw Error('机械诊断开关须为布尔值');
  p.contactPairs??=[];if(!Array.isArray(p.contactPairs))throw Error('接触对格式无效');
  p.curves=normalizeCurves(p.curves);p.loadBindings??=[];
  if(p.cadCurves!==undefined)p.cadCurves=normalizeCADCurves(p.cadCurves);
  if(p.cadSurfaces!==undefined)p.cadSurfaces=normalizeCADSurfaces(p.cadSurfaces);
  if(!Array.isArray(p.loadBindings))throw Error('曲线绑定格式无效');
  return validateReferences(normalizeThermalLoads(p));
}

// Normalize physical values through the solver compiler without replacing the
// authoring document with its lossy legacy projection.
export function normalizeSolverProject(input) {
  const p=normalizeProject(input),base=fromLegacy(toLegacy(p));
  restoreParametricModeling(p,base);
  if(p.cadCurves!==undefined)base.cadCurves=copy(p.cadCurves);
  if(p.cadSurfaces!==undefined)base.cadSurfaces=copy(p.cadSurfaces);
  base.frames=p.frames;base.selectionSets=p.selectionSets;base.solver={...p.solver,...base.solver,adapter:p.solver.adapter};
  base.connections=base.connections.map(j=>{
    const original=p.connections.find(x=>x.id===j.id);
    if(original.endpoints)return {...j,endpoints:copy(original.endpoints)};
    return j;
  });
  base.loads.push(...p.loads.filter(l=>l.type==='fixed-selection'||isThermalLoad(l)));
  for(const b of base.parts)delete b.material.fixedRegions;
  return validateReferences(base);
}

export function editLegacyProject(input,edit) {
  const p=normalizeProject(input),draft=toLegacy(p);edit(draft);
  draft.loadBindings=draft.loadBindings.filter(b=>b.kind==='motor-target'?draft.joints.some(j=>j.id===b.target):b.kind==='region-heat'?draft.coupling?.parts.length:draft.bodies.some(x=>x.id===b.target));
  if(!draft.coupling?.parts.length)draft.loadBindings=draft.loadBindings.filter(b=>!b.kind.endsWith('heat'));
  if(draft.coupling)draft.coupling.attachments=draft.coupling.attachments.filter(a=>draft.bodies.some(b=>b.id===a.body)&&draft.coupling.parts.some(b=>b.id===a.part));
  draft.contactPairs=draft.contactPairs.filter(p=>(draft.bodies.some(b=>b.id===p.a)||draft.coupling?.parts.some(b=>b.id===p.a))&&draft.coupling?.parts.some(b=>b.id===p.b));
  const next=fromLegacy(draft),ids=new Set(next.parts.map(b=>b.id));
  restoreParametricModeling(p,next,{allowDetach:true});
  if(p.cadCurves!==undefined)next.cadCurves=copy(p.cadCurves);
  if(p.cadSurfaces!==undefined)next.cadSurfaces=copy(p.cadSurfaces);
  next.frames=p.frames.filter(f=>f.part===null||ids.has(f.part));
  next.selectionSets=p.selectionSets.filter(s=>ids.has(s.part));
  next.connections=next.connections.map(j=>{
    const old=p.connections.find(x=>x.id===j.id);
    return old?.endpoints?{...j,endpoints:copy(old.endpoints)}:j;
  });
  next.loads.push(...p.loads.filter(l=>(l.type==='fixed-selection'||isThermalLoad(l))&&ids.has(l.target)));
  next.solver={...p.solver,...next.solver,adapter:p.solver.adapter};
  for(const b of next.parts)delete b.material.fixedRegions;
  return normalizeProject(next);
}

function restoreParametricModeling(source,target,{allowDetach=false}={}){
  for(const part of target.parts){
    const modeling=source.parts.find(b=>b.id===part.id)?.modeling;
    if(modeling==null)continue;
    part.modeling=copy(modeling);
    try{part.modeling=validateParametricPart(part);}catch(error){
      // A legacy geometry editor can intentionally replace a raw CAD recipe.
      // Keep metadata for material, placement and size edits; detach only when
      // the new shape no longer represents the saved parameter specification.
      if(allowDetach&&error.issues?.every(i=>['parametric.stale','parametric.geometry'].includes(i.code)))delete part.modeling;
      else throw error;
    }
  }
}

export function removePart(project, id) {
  const p = copy(project);
  p.parts = p.parts.filter(b => b.id !== id);
  p.contactPairs=(p.contactPairs??[]).filter(p=>p.a!==id&&p.b!==id);
  p.connections = p.connections.filter(j => j.a !== id && j.b !== id && j.carrier !== id);
  p.loadBindings=(p.loadBindings??[]).filter(b=>b.kind==='motor-target'?p.connections.some(j=>j.id===b.target):b.target!==id);
  if(!p.parts.some(b=>['mpm','pbf'].includes(b.method)))p.loadBindings=p.loadBindings.filter(b=>!b.kind.endsWith('heat'));
  p.loads = p.loads.filter(l => l.target !== id);
  p.frames=(p.frames??[]).filter(f=>f.part!==id);
  p.selectionSets=(p.selectionSets??[]).filter(s=>s.part!==id);
  return normalizeProject(p);
}

export function emptyCoupling() { return couplingParameters({enabled: true}); }
