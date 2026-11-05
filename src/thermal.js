import { MATERIALS } from './materials.js';

const FUSION = 334000, BOIL = FUSION + 4180 * 100, VAPOR = BOIL + 2256000;
export function enthalpyAt(material, t) {
  if (material === 4) return 2100 * t;
  if (material === 2) return FUSION + 4180 * t;
  if (material === 3) return VAPOR + 2010 * (t - 100);
  if (material === 1) return 840 * 1000 + 400000 + 1200 * (t - 1000);
  if (material === 10) return 450 * 1538 + 247000 + 820 * (t - 1538);
  return MATERIALS[material].cp * t;
}

// Enthalpy stays continuous through both latent-heat plateaus. Phase changes do
// not change parcel mass. The old phase persists through the mixed phase.
export function decodeEnthalpy(material, h) {
  if ([2,3,4].includes(material)) {
    if (h < 0) return [4, h / 2100];
    if (h < FUSION) return [material === 4 ? 4 : 2, 0];
    if (h < BOIL) return [2, (h - FUSION) / 4180];
    if (h < VAPOR) return [material === 3 ? 3 : 2, 100];
    return [3, 100 + (h - VAPOR) / 2010];
  }
  for (const [solid, liquid, t, latent, cp, liquidCp] of [[0,1,1000,400000,840,1200], [5,10,1538,247000,450,820]]) {
    if (material !== solid && material !== liquid && !(solid === 5 && material === 7)) continue;
    if (h < cp * t) return [material === 7 ? 7 : solid, h / cp];
    if (h < cp * t + latent) return [material, t];
    return [liquid, t + (h - cp * t - latent) / liquidCp];
  }
  return [material, h / MATERIALS[material].cp];
}

// Conductance uses an accelerated 2D contact geometry (20 m), shared by every
// material. Limit the whole explicit step using each node's heat-capacity budget,
// so many simultaneous contacts cannot overshoot. Each Q is applied ±Q exactly.
export function exchangeHeat(s, pairs, dt) {
  const budget = s.thermalBudget;
  budget.fill(0, 0, s.count); s.heat.fill(0, 0, s.count);
  for (let p = 0; p < pairs.length; p += 3) {
    const i = pairs[p], j = pairs[p+1];
    const ki = MATERIALS[s.material[i]].conductivity, kj = MATERIALS[s.material[j]].conductivity;
    const g = pairs[p+2] * 20 * s.settings.heatRate * 2 * ki * kj / (ki + kj);
    pairs[p+2] = g; budget[i] += g; budget[j] += g;
  }
  for (let i = 0; i < s.count; i++) budget[i] = budget[i] ? Math.min(1, .45 * s.mass[i] * MATERIALS[s.material[i]].cp / (dt * budget[i])) : 1;
  for (let p = 0; p < pairs.length; p += 3) {
    const i = pairs[p], j = pairs[p+1];
    const q = (s.temperature[j] - s.temperature[i]) * pairs[p+2] * dt * Math.min(budget[i],budget[j]);
    s.exchangedHeat += Math.abs(q);
    s.heat[i] += q; s.heat[j] -= q;
  }
  for (let i = 0; i < s.count; i++) {
    s.enthalpy[i] += s.heat[i] / s.mass[i];
    if (s.settings.ambient) s.enthalpy[i] -= (s.temperature[i] - 15) * MATERIALS[s.material[i]].cp * dt * .003;
    s.phaseTransition(i);
  }
}
