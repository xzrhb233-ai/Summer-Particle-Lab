// Shared, SI thermal boundary contract. A receiver changes energy, never just
// a display temperature. Regions follow the material points selected at init.
import {normalizeCurves,curveValue,curveIntegral,curveBounds} from './curves.js';
import {validateSurfaceRegion} from './surface-selections.js';
export const THERMAL_LOAD_TYPES=['thermal-power','thermal-temperature','thermal-convection'];
export const isThermalLoad=l=>THERMAL_LOAD_TYPES.includes(l.type);
const faces=['x-','x+','y-','y+','z-','z+'];
export function normalizeThermalLoads(project){
  const loads=project.loads.filter(isThermalLoad),ids=new Set();
  if(loads.length>32)throw Error('最多 32 个统一热载荷');
  for(const l of project.loads){if(ids.has(l.id))throw Error('载荷 ID 重复');ids.add(l.id);}
  project.loads=project.loads.map(l=>{
    if(!isThermalLoad(l))return l;
    const p=project.parts.find(p=>p.id===l.target),selection=l.selection===undefined?null:project.selectionSets?.find(s=>s.id===l.selection);
    if(l.selection!==undefined&&(!selection||p?.method!=='fem'||selection.part!==l.target||selection.entity!=='face'||!['face','surface'].includes(selection.region?.type)))throw Error('热载荷须引用目标 FEM 部件的面选择集');
    const region=selection?.region??l.region??{type:'whole'};
    if(!p||!/^[-\w]{1,40}$/.test(l.id))throw Error('热载荷目标或 ID 无效');
    const cadFEM=p.method==='fem'&&p.geometry.shape==='cad'&&p.discretization?.mesh?.schema==='summer-tet4/1';
    if(!['whole','face','surface'].includes(region.type)||region.type==='face'&&(!faces.includes(region.face)||p.geometry.shape!=='box'&&!cadFEM||p.method==='rigid'))throw Error('热载荷支持整个部件、长方体局部面或 CPU FEM 命名表面；刚体使用整体温度');
    if(region.type==='surface'){
      validateSurfaceRegion(p,region);
      if(project.solver?.computeBackend==='gpu')throw Error('命名表面热载荷当前仅支持 CPU FEM');
    }
    if(l.type==='thermal-convection'&&!['box','sphere'].includes(p.geometry.shape)&&!cadFEM)throw Error('当前对流面积支持长方体、球体和 CAD FEM 表面网格；其他形状可使用总功率或定温边界');
    const r={...l,name:String(l.name??l.id).slice(0,80),enabled:l.enabled??true,region:region.type==='whole'?{type:'whole'}:region.type==='face'?{type:'face',face:region.face}:{type:'surface',surface:region.surface}};
    if(typeof r.enabled!=='boolean')throw Error('热载荷开关须为布尔值');
    if(l.type==='thermal-power'&&(!Number.isFinite(l.power)||Math.abs(l.power)>1e7))throw Error('热功率须在 ±1e7 W');
    if(l.type!=='thermal-power'&&(!Number.isFinite(l.temperature)||l.temperature< -273.15||l.temperature>2000))throw Error('边界温度须在 −273.15 至 2000°C');
    if(l.type==='thermal-convection'&&(!Number.isFinite(l.coefficient)||l.coefficient<0||l.coefficient>1e5))throw Error('对流系数须在 0–100000 W/m²/K');
    if(l.program){
      if(!['linear','smooth','step'].includes(l.program.type))throw Error('热边界时间表支持线性、平滑或阶跃插值');
      r.program=normalizeCurves([{...l.program,id:l.id}])[0];
      const [lo,hi]=curveBounds(r.program);
      if(l.type==='thermal-power'?(lo< -1e7||hi>1e7):(lo< -273.15||hi>2000))throw Error('热边界时间表超出功率或温度范围');
    }
    return r;
  });return project;
}

export class PartThermalLoads{
  constructor(project,ports){
    this.time=0;
    this.items=project.loads.filter(isThermalLoad).map(definition=>{
      const port=ports.get(definition.target);if(!port)throw Error('当前求解器没有该部件的热量接收接口：'+definition.target);
      const entries=port.select(definition.region);
      if(!entries.length)throw Error('热边界没有选中节点或材料点，请检查几何与离散尺寸');
      return {definition,entries,heat:0,intervalHeat:0,requested:0};
    });
    const temperatures=new Map();
    for(const l of this.items)if(l.definition.enabled&&l.definition.type==='thermal-temperature')for(const e of l.entries){
      const key=l.definition.target+'|'+e.index,previous=temperatures.get(key);
      const signature=JSON.stringify([l.definition.temperature,l.definition.program?.type,l.definition.program?.points]);
      if(previous!==undefined&&previous!==signature)throw Error('同一热节点不能指定两个不同温度');temperatures.set(key,signature);
    }
  }
  begin(){for(const l of this.items)l.intervalHeat=0;}
  step(dt){
    let external=0;
    // Reservoirs enforce temperature after powers/convection, recording the
    // actual supplied/removed energy (including latent heat when applicable).
    for(const mode of ['thermal-power','thermal-convection','thermal-temperature'])for(const l of this.items){
      const d=l.definition;if(!d.enabled||d.type!==mode)continue;
      const commanded=d.program?(mode==='thermal-temperature'||!dt?curveValue(d.program,this.time+dt):curveIntegral(d.program,this.time,this.time+dt)/dt):(mode==='thermal-power'?d.power:d.temperature);
      const total=l.entries.reduce((s,e)=>s+e.weight,0);let delivered=0,requested=0;
      for(const e of l.entries){
        const q=mode==='thermal-power'?commanded*dt*e.weight/total:mode==='thermal-temperature'?e.energyAt(commanded)-e.energy():
          (commanded-e.temperature())*e.capacity()*(-Math.expm1(-d.coefficient*e.area*dt/e.capacity()));
        if(!Number.isFinite(q))throw Error('热载荷计算出现非有限值');
        requested+=q;delivered+=e.receive(q);
      }
      l.heat+=delivered;l.intervalHeat+=delivered;l.requested+=requested;external+=delivered;
    }
    this.time+=dt;return external;
  }
  results(dt){return this.items.map(l=>({id:l.definition.id,target:l.definition.target,type:l.definition.type,enabled:l.definition.enabled,heat:l.heat,intervalHeat:l.intervalHeat,heatRate:dt?l.intervalHeat/dt:0,requestedHeat:l.requested}));}
  backup(){const values=this.items.map(l=>({heat:l.heat,intervalHeat:l.intervalHeat,requested:l.requested}));values.time=this.time;return values;}
  restore(values){this.time=values.time??0;this.items.forEach((l,i)=>Object.assign(l,values[i]));}
  // The GPU receives the exact same initial material selection and SI weights.
  descriptors(){return this.items.map(l=>({definition:l.definition,entries:l.entries.map(e=>({index:e.index,weight:e.weight,area:e.area}))}));}
}
