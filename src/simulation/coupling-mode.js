export const couplingMode = solver => solver.couplingMode ?? 'native';
export const supportsUnifiedPBD = p => p.solver.computeBackend === 'gpu' &&
  p.parts.length === 4 && ['mpm','fem','pbf','rigid'].every(m=>p.parts.filter(b=>b.method===m).length===1);
export function validateCouplingOptions(solver){
  if(!['native','unified-pbd'].includes(couplingMode(solver)))throw Error('未知耦合方式');
  const n=solver.pbdIterations??6;
  if(!Number.isInteger(n)||n<1||n>20)throw Error('PBD 迭代次数须为 1–20 的整数');
}
export function requireCouplingSupport(project){
  validateCouplingOptions(project.solver);
  if(couplingMode(project.solver)==='unified-pbd'&&!supportsUnifiedPBD(project))throw Error('Unified PBD 混合耦合目前需要 Taichi GPU，且 MPM、FEM、PBF、球形刚体各一个');
}
