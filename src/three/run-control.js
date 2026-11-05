export class RunControl {
  constructor(){this.paused=false;this.end=null;this.pending=0;this.completed=false;}
  reset(){this.end=null;this.pending=0;this.completed=false;}
  pause(value,time){this.paused=!!value;this.pending=0;if(!value&&this.end!==null&&time>=this.end-1e-9)this.reset();}
  start(duration,time){if(!Number.isFinite(duration)||duration<=0||duration>600)return false;this.end=time+duration;this.paused=false;this.completed=false;this.pending=0;return true;}
  single(){if(!this.paused)return false;this.reset();this.pending=1;return true;}
  dt(time){if(this.pending){this.pending--;return 1/60;}if(this.paused)return 0;return this.end===null?1/60:Math.max(0,Math.min(1/60,this.end-time));}
  advanced(time){if(this.end!==null&&time>=this.end-1e-9){this.paused=true;this.completed=true;}}
  snapshot(){return {end:this.end,status:this.completed?'completed':this.paused?'paused':'running'};}
}
