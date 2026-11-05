// Solver-independent endpoint data compiled from the unified project.
export function attachmentDefinitions(items=[]) {
  if(!Array.isArray(items)||items.length>64)throw Error('区域连接最多 64 个');
  const ids=new Set(),id=x=>typeof x==='string'&&/^[-\w]{1,40}$/.test(x);
  const vec=(v,limit=1000)=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=limit);
  return items.map(a=>{
    if(!id(a?.id)||ids.has(a.id)||!id(a.body)||!id(a.part)||!['bind','elastic','slide'].includes(a.mode))throw Error('区域连接定义无效');
    ids.add(a.id);
    if(!id(a.frame?.id)||a.frame.part!==a.body||!vec(a.frame.position)||!vec(a.frame.rotation,360))throw Error('区域连接的刚体参考点无效');
    const s=a.selection,r=s?.region;
    if(!id(s?.id)||s.part!==a.part||!['box','whole'].includes(r?.type)||r.type==='box'&&(!vec(r.lower)||!vec(r.upper)||r.lower.some((x,k)=>x>=r.upper[k])))throw Error('区域连接的材料点选区无效');
    const stiffness=a.stiffness??20000,damping=a.damping??100;
    if(!Number.isFinite(stiffness)||stiffness<=0||stiffness>1e7||!Number.isFinite(damping)||damping<0||damping>1e5)throw Error('区域连接刚度或阻尼超出范围');
    return structuredClone({...a,name:String(a.name??a.id).slice(0,80),stiffness,damping});
  });
}
