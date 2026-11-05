export function partTemperature(frame,id){
  const part=frame.results?.parts.find(p=>p.id===id),v=part?.values;
  if(!v||!Number.isFinite(v.temperature))return null;
  // Older particle adapters publish only a mean; do not invent their extrema.
  return {mean:v.temperature,min:v.minTemperature??(part.method==='rigid'?v.temperature:null),max:v.maxTemperature??(part.method==='rigid'?v.temperature:null)};
}
// Positive is heat received by B, the FEM side of a mixed contact pair.
export function interfaceHeat(frame,id){
  const p=frame.contactPairs?.find(p=>p.id===id);
  return p?{rate:-p.heatRate,heat:-p.accumulatedHeat}:null;
}
export function thermalHistoryCSV(frames,part,pair){
  const rows=['time_s,temperature_min_degC,temperature_mean_degC,temperature_max_degC,interface_into_B_W,interface_into_B_J,external_heat_J,heat_residual_J,plastic_work_J,plastic_heat_J,friction_loss_J,friction_heat_J,generated_heat_J,generated_into_MPM_J,generated_into_FEM_J'];
  for(const f of frames){const T=partTemperature(f,part),q=interfaceHeat(f,pair),b=f.thermal??f.coupling;
    rows.push([f.time,T?.min,T?.mean,T?.max,q?.rate,q?.heat,b?.externalHeat,b?.residual??b?.thermalResidual,b?.plasticWork,b?.generated?.plastic,b?.frictionLoss,b?.generated?.friction,b?.generatedHeat,b?.generated?.mpm,b?.generated?.fem].map(x=>Number.isFinite(x)?x:'').join(','));}
  return rows.join('\n');
}
