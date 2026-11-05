export function partField(frame, id, key) {
  const v = frame.results?.parts.find(p => p.id === id)?.values;
  if (!v) return null;
  if (['dx','dy','dz'].includes(key)) return v.displacement?.[['dx','dy','dz'].indexOf(key)] ?? null;
  if (key === 'speed') return v.velocity ? Math.hypot(...v.velocity) : null;
  if (key === 'contactForce') return v.contactForce ? Math.hypot(...v.contactForce) : null;
  return v[key] ?? null;
}
export function projectCSV(frames) {
  const rows = ['time_s,part_id,method,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s,temperature_C,particle_count,plastic_strain,damage,failed_particle_count'];
  for (const frame of frames) for (const p of frame.results?.parts ?? []) {
    const v=p.values;
    rows.push([frame.time,p.id,p.method,...(v.position??['','','']),...(v.velocity??['','','']),v.temperature??'',v.count??'',v.plastic??'',v.damage??'',v.failed??''].join(','));
  }
  return rows.join('\n');
}
