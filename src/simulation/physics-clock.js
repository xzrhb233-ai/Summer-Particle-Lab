// A state-dependent CFL bound chooses a dyadic level on an absolute time grid.
// Communication / recording boundaries aligned to baseDt never add a tiny step.
// An explicitly requested off-grid endpoint is honored, and reported as a cut.
export class PhysicsClock {
  constructor(baseDt){
    this.baseDt=baseDt;this.steps=0;this.minDt=Infinity;this.maxDt=0;
    this.requestCuts=0;this.eventCuts=0;
  }
  next(time,end,stable,{maxDt=Infinity,nextEvent=Infinity}={}){
    const limit=Math.min(stable,maxDt,this.baseDt);
    if(!Number.isFinite(limit)||limit<1e-7)throw Error('稳定时间步过小，求解已停止');
    let quantum=this.baseDt;
    while(quantum>limit*(1+1e-12))quantum*=.5;
    const eps=1e-10;
    const boundary=(Math.floor(time/quantum+1e-8)+1)*quantum;
    let target=boundary,cut=null;
    if(nextEvent>time+eps&&nextEvent<target-eps){target=nextEvent;cut='event';}
    if(end<target-eps){target=end;cut='request';}
    if(cut==='event')this.eventCuts++;
    if(cut==='request')this.requestCuts++;
    const dt=target-time;
    if(!(dt>0))throw Error('物理时钟未向前推进');
    this.steps++;this.minDt=Math.min(this.minDt,dt);this.maxDt=Math.max(this.maxDt,dt);
    return {dt,end:target};
  }
  snapshot(){
    return {scheme:'dyadic-clock/1',baseDt:this.baseDt,steps:this.steps,
      minDt:this.steps?this.minDt:null,maxDt:this.steps?this.maxDt:null,
      requestCuts:this.requestCuts,eventCuts:this.eventCuts};
  }
}
