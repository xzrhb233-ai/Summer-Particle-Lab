// Optional GPU mixed-material extension; legacy projects keep constant stiffness.
export const THERMOMECHANICAL_DEFAULTS=Object.freeze({expansion:0,referenceTemperature:20,hotStiffnessRatio:1,plasticHeatFraction:0});
export function particleThermalProperties(material={}){
  const cp=material.cp??1800,conductivity=material.conductivity??.13;
  if(!Number.isFinite(cp)||cp<1||cp>100000||!Number.isFinite(conductivity)||conductivity<0||conductivity>10000)throw Error('MPM 比热容须为 1–100000 J/(kg·K)，导热率须为 0–10000 W/(m·K)');
  return {cp,conductivity};
}
export function thermomechanicalParameters(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(THERMOMECHANICAL_DEFAULTS,k)))throw Error('热力材料参数无效');
  const p={...THERMOMECHANICAL_DEFAULTS,...value};
  if(!Number.isFinite(p.expansion)||Math.abs(p.expansion)>.001||!Number.isFinite(p.referenceTemperature)||p.referenceTemperature< -100||p.referenceTemperature>1500||!Number.isFinite(p.hotStiffnessRatio)||p.hotStiffnessRatio<.01||p.hotStiffnessRatio>1)throw Error('膨胀系数须在 ±0.001/K，参考温度 −100–1500°C，高温刚度比 0.01–1');
  if(!Number.isFinite(p.plasticHeatFraction)||p.plasticHeatFraction<0||p.plasticHeatFraction>1)throw Error('塑性功转热比例须为 0–1');
  return p;
}
export function preserveThermomechanical(original,next){
  for(const b of next.parts){const old=original.parts.find(p=>p.id===b.id);if(b.method==='mpm'&&old){
    if(old.material.thermomechanical)b.material.thermomechanical=thermomechanicalParameters(old.material.thermomechanical);
    if(old.material.cp!==undefined||old.material.conductivity!==undefined)Object.assign(b.material,particleThermalProperties(old.material));
  }}
  return next;
}
