// Progress always uses the live solver clock, never the replay cursor.
export function validateRunTarget(target,time){
  if(!Number.isFinite(target)||target<=time+1e-9||target>60)throw Error('结束时间须大于当前已完成时间，且不超过 60 s');
  return target;
}
export class RunMonitor {
  constructor(){this.reset();}
  reset(){this.elapsed=0;this.samples=[];}
  record(simulated,seconds){
    if(!(simulated>0&&seconds>0))return;
    this.elapsed+=seconds;this.samples.push([simulated,seconds]);if(this.samples.length>20)this.samples.shift();
  }
  read(time,target,waiting=0){
    const sim=this.samples.reduce((s,x)=>s+x[0],0),wall=this.samples.reduce((s,x)=>s+x[1],0)+waiting;
    const rate=sim>0&&wall>0?sim/wall:null;
    return {percent:target>0?Math.max(0,Math.min(100,time/target*100)):0,elapsed:this.elapsed+waiting,rate,eta:time>=target?0:rate?(target-time)/rate:null};
  }
}
export function wallTime(seconds){
  if(!Number.isFinite(seconds))return '—';
  if(seconds<60)return seconds.toFixed(1)+' s';
  if(seconds<3600)return (seconds/60).toFixed(1)+' min';
  return (seconds/3600).toFixed(1)+' h';
}
