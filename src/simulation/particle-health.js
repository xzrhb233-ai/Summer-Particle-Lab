// CPU diagnostic reduction only. Call from an existing full-particle observer;
// this module never advances, repairs or clamps the physical state.
export function createParticleHealth(){
  return {schema:'summer-particle-health/1',scope:'cpu-particle-stored-state',
    inspectedParticles:0,solidParticles:0,nonfiniteParticles:0,invalidJCount:0,
    minJ:null,maxJ:null,maxNormalizedStress:null,
    determinantMeaning:'stored-F determinant; plastic stored F is not total deformation J',
    invalidJMeaning:'finite stored-F determinant <= 0',
    stressUnits:'dimensionless-von-mises-over-reference-E'};
}

export function observeParticleHealth(health,s,i,solid,F,C,J){
  health.inspectedParticles++;
  let finite=Number.isFinite(s.mass[i])&&Number.isFinite(s.x[i])&&Number.isFinite(s.y[i])&&Number.isFinite(s.z[i])&&
    Number.isFinite(s.vx[i])&&Number.isFinite(s.vy[i])&&Number.isFinite(s.vz[i]);
  for(const key of ['temperature','enthalpy','damage'])if(s[key]&&!Number.isFinite(s[key][i]))finite=false;
  if(solid){
    health.solidParticles++;
    for(let k=0;k<9;k++)if(!Number.isFinite(F[k])||!Number.isFinite(C[k]))finite=false;
    const stress=s.mpm.stress[i],plastic=s.mpm.plastic[i];
    if(!Number.isFinite(J)||!Number.isFinite(stress)||!Number.isFinite(plastic))finite=false;
    if(Number.isFinite(J)){
      health.minJ=health.minJ===null?J:Math.min(health.minJ,J);
      health.maxJ=health.maxJ===null?J:Math.max(health.maxJ,J);
      if(J<=0)health.invalidJCount++;
    }
    if(Number.isFinite(stress))health.maxNormalizedStress=health.maxNormalizedStress===null?stress:Math.max(health.maxNormalizedStress,stress);
  }
  if(!finite)health.nonfiniteParticles++;
}
