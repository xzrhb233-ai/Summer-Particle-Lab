// A constrained, stationary experiment: no mechanical state is advanced.
// Reject motion/strain/phase inputs instead of silently ignoring their physics.
export function validateFixedThermal(p){
  const mode=p.solver.thermalMode??'coupled';
  if(!['coupled','fixed-geometry'].includes(mode))throw Error('未知混合传热模式');
  if(mode==='coupled')return;
  const fail=()=>{throw Error('固定几何传热需要：零重力、零初速、无力学载荷或载荷曲线、FEM 热膨胀为零，所有 MPM 全域固定且关闭相变；接触对只启用传热');};
  if(!p.solver.thermal||p.solver.initialState!=='rest'||p.environment.gravity.some(x=>x!==0)||p.loadBindings.some(b=>b.enabled))fail();
  if(p.contactPairs.some(c=>c.mechanical)||p.couplings.some(c=>c.thermalScale!==1))fail();
  for(const b of p.parts){
    if(b.initial.velocity.some(x=>x!==0))fail();
    if(b.method==='fem'){if(b.material.expansion!==0)fail();}
    else if(b.method!=='mpm'||b.material.model!==0||b.material.phaseChange.enabled||!p.loads.some(l=>l.type==='fixed-selection'&&l.target===b.id&&p.selectionSets.some(s=>s.id===l.selection&&s.part===b.id&&s.region.type==='whole')))fail();
  }
  for(const l of p.loads)if(l.type==='fem-force'&&l.force.some(x=>x!==0)||l.type==='fem-pressure'&&l.pressure!==0)fail();
}

export function advanceParticleThermal(m,tick){
  m.loadProgram.apply(m.time,tick.dt);
  m.heatStep(tick.dt);m.externalHeat+=m.partThermalLoads.step(tick.dt);
  m.time=tick.end;m.steps++;m.particles.time=tick.end;
}
export function advanceFEMThermal(f,tick){
  f.lastStart=f.time;f.lastEnd=tick.end;f.lastDt=tick.dt;
  f.thermal.step(tick.dt);f.time=tick.end;f.steps++;
}
