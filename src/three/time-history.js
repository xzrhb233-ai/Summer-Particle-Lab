export function aggregateParts(parts){
  if(!parts.length)return null;
  const total={id:-1,name:'全部部件',count:0,mass:0,center:[0,0,0],velocity:[0,0,0],kinetic:0,maxSpeed:0,displacement:0,pinned:0,stress:0,plastic:0};
  for(const p of parts){
    for(const k of ['count','mass','kinetic','pinned'])total[k]+=p[k];
    for(const k of ['maxSpeed','displacement','stress','plastic'])total[k]=Math.max(total[k],p[k]);
    for(let a=0;a<3;a++){total.center[a]+=p.center[a]*p.mass;total.velocity[a]+=p.velocity[a]*p.mass;}
  }
  total.center=total.center.map(x=>x/total.mass);total.velocity=total.velocity.map(x=>x/total.mass);return total;
}
export class TimeHistory {
  constructor(){this.rows=[];this.target=-1;this.name='全部部件';}
  reset(target=this.target){this.rows=[];this.target=target;}
  sample(time,part,interval=.05){
    if(!part)return;
    this.name=part.name;
    const last=this.rows.at(-1);
    if(last&&time<last[0]-1e-9)this.reset();
    const row=[time,part.count,part.mass,...part.center,...part.velocity,part.kinetic,part.maxSpeed,part.displacement,part.stress,part.plastic];
    if(this.rows.length&&Math.abs(time-this.rows.at(-1)[0])<1e-9){this.rows[this.rows.length-1]=row;return;}
    if(!this.rows.length||time-this.rows.at(-1)[0]>=interval-1e-9){this.rows.push(row);if(this.rows.length>2000)this.rows.shift();}
  }
  csv(){
    const safeName=/^[=+@\-\t\r]/.test(this.name)?"'"+this.name:this.name;
    const name='"'+safeName.replaceAll('"','""')+'"';
    const header='part,time_s,count,mass_kg,com_x_unit,com_y_unit,com_z_unit,vx_unit_s,vy_unit_s,vz_unit_s,kinetic_kg_unit2_s2,max_speed_unit_s,max_displacement_unit,relative_stress,plastic_history';
    return '\uFEFF'+header+'\r\n'+this.rows.map(r=>name+','+r.join(',')).join('\r\n');
  }
}
