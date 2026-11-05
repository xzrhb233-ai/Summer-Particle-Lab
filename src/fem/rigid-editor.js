// Reuse the common rigid-body authoring form without routing FEM through Rapier.
export function femEditorModel(p){
  return {name:p.name,gravity:p.environment.gravity,dt:p.solver.dt,iterations:12,joints:[],bodies:p.parts.filter(b=>b.method==='rigid').map(b=>({
    id:b.id,name:b.name,shape:b.geometry.shape,type:b.boundary.motion,size:b.geometry.size,position:b.geometry.center,rotation:b.geometry.rotation,appearance:b.geometry.appearance,
    mass:b.material.mass,velocity:b.initial.velocity,angularVelocity:b.initial.angularVelocity,collisionFamily:b.boundary.collisionFamily??0}))};
}
export function editFEMRigids(project,edit){
  const p=structuredClone(project),model=femEditorModel(p),before=new Set(model.bodies.map(b=>b.id));edit(model);
  const removed=new Set([...before].filter(id=>!model.bodies.some(b=>b.id===id)));
  const bodies=model.bodies.map(b=>{
    const old=p.parts.find(x=>x.id===b.id);
    return {id:b.id,name:b.name,method:'rigid',geometry:{shape:b.shape,size:b.size,center:b.position,rotation:b.rotation,appearance:b.appearance??null},
      material:{cp:500,conductivity:0,...old?.material,mass:b.mass},initial:old?.initial??{velocity:b.velocity??[0,0,0],angularVelocity:b.angularVelocity??[0,0,0],temperature:20},
      boundary:{friction:0,restitution:0,damping:0,...old?.boundary,motion:b.type,collisionFamily:b.collisionFamily??0}};
  });
  p.parts=[...p.parts.filter(b=>b.method!=='rigid'),...bodies];
  p.contactPairs=p.contactPairs.filter(c=>!removed.has(c.a)&&!removed.has(c.b));
  p.loads=p.loads.filter(l=>!removed.has(l.target));
  p.frames=p.frames.filter(f=>!removed.has(f.part));p.selectionSets=p.selectionSets.filter(s=>!removed.has(s.part));
  return p;
}
