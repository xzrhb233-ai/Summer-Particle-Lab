// Limit interactive CUDA batches, not physical stability checks. Small batches
// return visible progress and make Pause responsive at a result boundary.
export function interactiveInterval(frame,outputInterval,remaining,base){
  let quantum=base,interval=base*Math.max(1,Math.floor(outputInterval/base+1e-9));
  if(frame.mixed?.scheme==='resident-four-method/1'){
    const c=frame.mixed.clock;
    quantum=Math.min(base,c.nextDt??c.minDt??base);
    interval=Math.min(outputInterval,16*quantum);
  }
  return Math.min(remaining,interval);
}
