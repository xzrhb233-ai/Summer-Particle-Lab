// Authoring definitions use stable part IDs, independent of solver indices.
export function normalizeContactPairs(input=[],bodies=[],coupling=null){
  if(!Array.isArray(input)||input.length>128)throw Error('最多 128 个显式接触对');
  const ids=new Set(),pairs=new Set();
  return input.map(p=>{
    if(!p||typeof p.id!=='string'||!/^[-\w]{1,40}$/.test(p.id)||ids.has(p.id))throw Error('接触对 ID 无效或重复');ids.add(p.id);
    const a=coupling?.parts.find(b=>b.id===p.a),b=coupling?.parts.find(b=>b.id===p.b);
    const fluidSolid=a&&new Set([a.method,b?.method]).size===2&&[a.method,b?.method].every(m=>['mpm','pbf'].includes(m));
    if(!coupling?.enabled||!b||p.a===p.b||(!bodies.some(b=>b.id===p.a)&&!(a?.method==='mpm'&&b.method==='mpm')&&!fluidSolid))throw Error('接触对需要刚体与 MPM / PBF、两个 MPM，或 MPM–PBF 部件');
    const key=JSON.stringify(a?[p.a,p.b].sort():[p.a,p.b]);if(pairs.has(key))throw Error('同一部件对只能有一个接触定义');pairs.add(key);
    const bool=(k,fallback)=>{const v=p[k]??fallback;if(typeof v!=='boolean')throw Error('接触开关无效');return v;};
    const number=(k,fallback,max)=>{const v=p[k]??fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)throw Error('接触参数超出范围：'+k);return v;};
    if(fluidSolid&&(p.friction??0)!==0)throw Error('MPM–PBF 压力边界暂仅支持自由滑移，摩擦系数须为 0');
    return {id:p.id,name:String(p.name??p.id).slice(0,80),a:p.a,b:p.b,
      mechanical:bool('mechanical',coupling.mechanical),thermal:bool('thermal',coupling.thermal),
      friction:number('friction',fluidSolid?0:coupling.friction,2),contactConductance:number('contactConductance',coupling.contactConductance,100000)};
  });
}
export function contactProfiles(model){
  const c=model.coupling;if(!c)return [];
  return model.bodies.map(body=>c.parts.map(part=>{
    const p=model.contactPairs.find(p=>p.a===body.id&&p.b===part.id);
    return {mechanical:c.mechanical,thermal:c.thermal,friction:c.friction,contactConductance:c.contactConductance,...p};
  }));
}
export function materialProfiles(model){
  const c=model.coupling;
  return c.parts.map((a,i)=>c.parts.map((b,j)=>{
    const p=model.contactPairs.find(p=>(p.a===a.id&&p.b===b.id)||(p.b===a.id&&p.a===b.id));
    return {a:a.id,b:b.id,mechanical:c.mechanical,thermal:c.thermal,friction:c.friction,contactConductance:c.contactConductance,...p,
      sign:p?.a===b.id?-1:1,explicit:!!p};
  }));
}
// SI: force/torque on A, positive normal compression, signed heat into A.
export function contactPairResult(definition,v,duration){
  const rate=x=>duration?x/duration:0;
  return {...definition,force:Array.from(v.slice(0,3),rate),torque:Array.from(v.slice(3,6),rate),
    normalForce:rate(v[6]),tangentialForce:Array.from(v.slice(7,10),rate),
    slipSpeed:v[11]?v[10]/v[11]:0,samples:v[11],maxPenetration:v[12],
    heatRate:rate(v[13]),heat:v[13],accumulatedHeat:v[14],thermalSamples:v[15]};
}
