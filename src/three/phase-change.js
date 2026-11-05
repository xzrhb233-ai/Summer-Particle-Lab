// Optional enthalpy-based melting of custom MPM material (id 11).
// Both phases retain its density, specific heat and conductivity. The previous
// solver is retained on the latent-heat plateau; only full melting/freezing switches it.
export const PHASE_DEFAULTS=Object.freeze({enabled:false,meltingPoint:120,latentHeat:120000});
export function phaseParameters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p={...PHASE_DEFAULTS,...input};
  if(Object.keys(input).some(k=>!Object.hasOwn(PHASE_DEFAULTS,k))||typeof p.enabled!=='boolean'||!Number.isFinite(p.meltingPoint)||p.meltingPoint< -100||p.meltingPoint>2000||!Number.isFinite(p.latentHeat)||p.latentHeat<1000||p.latentHeat>2000000)return null;
  return Object.freeze(p);
}
export function phaseEnthalpy(T,p,cp=1800){return cp*T+(p.enabled&&T>p.meltingPoint?p.latentHeat:0);}
export function decodePhase(h,wasLiquid,p,cp=1800){
  if(!p.enabled)return {liquid:false,temperature:h/cp};
  const start=cp*p.meltingPoint,end=start+p.latentHeat;
  if(h<=start)return {liquid:false,temperature:h/cp};
  if(h>=end)return {liquid:true,temperature:(h-p.latentHeat)/cp};
  return {liquid:!!wasLiquid,temperature:p.meltingPoint};
}
