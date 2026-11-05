// Animate the visual cards, leaving their hit areas and tab order stationary.
export function installIndexWave(list){
  const buttons=[...list.querySelectorAll('[role="tab"]')];
  const states=buttons.map(button=>{
    const card=document.createElement('span');card.className='index-card';
    card.append(...button.childNodes);button.append(card);
    return {button,card,x:0,v:0};
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),compact=matchMedia('(max-width:760px)');
  let frame=0,lastTime=0,hover=null,lastIndex=-1,pulses=[];
  function enabled(){return !reduced.matches&&!compact.matches&&!document.hidden;}
  function reset(){
    cancelAnimationFrame(frame);frame=0;lastTime=0;hover=null;lastIndex=-1;pulses=[];
    for(const s of states){s.x=s.v=0;s.card.style.removeProperty('transform');s.card.style.removeProperty('--wave');s.button.style.removeProperty('z-index');}
    list.classList.remove('wave-moving');
  }
  function wake(){if(!frame&&enabled()){lastTime=performance.now();list.classList.add('wave-moving');frame=requestAnimationFrame(tick);}}
  function tick(now){
    frame=0;if(!enabled()){reset();return;}
    const dt=Math.min(.032,Math.max(.001,(now-lastTime)/1000));lastTime=now;
    pulses=pulses.filter(p=>now-p.time<1400);
    let moving=false;
    states.forEach((s,i)=>{
      let target=hover===null?0:17*Math.exp(-.5*((i-hover)/.82)**2);
      for(const p of pulses){
        const age=(now-p.time)/1000-Math.abs(i-p.index)*.065;
        if(age>=0)target+=6*Math.sin(age*13)*Math.exp(-age*5.5)*Math.exp(-Math.abs(i-p.index)*.28);
      }
      if(s.button.hidden)target=0;
      target=Math.max(-4,Math.min(23,target));
      // Damped spring: interrupted sweeps continue with the current velocity.
      s.v+=(190*(target-s.x)-23*s.v)*dt;s.x+=s.v*dt;
      if(Math.abs(target-s.x)>.015||Math.abs(s.v)>.025)moving=true;
      const lift=s.x;
      s.card.style.transform=`translate3d(${(lift*.28).toFixed(3)}px,${(-lift*.30).toFixed(3)}px,${(lift*.9).toFixed(3)}px) rotateY(${(-lift*.48).toFixed(3)}deg)`;
      s.card.style.setProperty('--wave',Math.max(0,lift/23).toFixed(3));
      s.button.style.zIndex=String(10+Math.round(lift));
    });
    if(moving||pulses.length)frame=requestAnimationFrame(tick);
    else {list.classList.remove('wave-moving');if(hover===null)reset();}
  }
  list.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||!enabled())return;
    let nearest=-1,distance=Infinity;
    states.forEach((s,i)=>{if(s.button.hidden)return;const r=s.button.getBoundingClientRect(),d=Math.abs(e.clientY-r.top-r.height/2);if(d<distance){distance=d;nearest=i;}});
    if(nearest<0)return;
    const r=states[nearest].button.getBoundingClientRect();hover=nearest+Math.max(-.5,Math.min(.5,(e.clientY-r.top-r.height/2)/r.height));
    if(nearest!==lastIndex){lastIndex=nearest;pulses.push({index:nearest,time:performance.now()});pulses=pulses.slice(-8);}
    wake();
  });
  function leave(){hover=null;lastIndex=-1;wake();}
  list.addEventListener('pointerleave',leave);list.addEventListener('pointercancel',leave);
  // Scrolling/filtering must not leave a raised card under a stale pointer.
  list.parentElement.addEventListener('scroll',reset,{passive:true});
  reduced.addEventListener('change',reset);compact.addEventListener('change',reset);
  window.addEventListener('blur',reset);document.addEventListener('visibilitychange',reset);
  return {reset};
}
