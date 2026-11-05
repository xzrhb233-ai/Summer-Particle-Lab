import { RunControl } from './run-control.js';
import { Simulation3 } from './simulation.js';
const s=new Simulation3(),control=new RunControl();let ready=false,busy=false,pending=false,ms=0,recycled=null,rate=0,lastTick=0;
function publish(){if(busy){pending=true;return;}pending=false;const started=performance.now(),state=s.snapshot(recycled);recycled=null;busy=true;self.postMessage({type:'frame',...state,ms,paused:control.paused,run:control.snapshot(),rate,backend:{name:'JavaScript',arch:'cpu',device:'浏览器 Worker'},snapshotMs:performance.now()-started},[state.data.buffer]);}
function tick(){
  const dt=control.dt(s.time);
  if(dt>0){const start=performance.now(),before=s.time;s.step(dt);control.advanced(s.time);ms=performance.now()-start;const now=performance.now();rate=lastTick?(s.time-before)/((now-lastTick)/1000):0;lastTick=now;publish();}
  setTimeout(tick,control.paused?40:Math.max(0,16-ms));
}
self.onmessage=({data:d})=>{
  if(d.type==='init'){s.reset(d.scene);publish();if(!ready){ready=true;tick();}}
  else if(d.type==='ack'){busy=false;if(d.buffer)recycled=d.buffer;if(pending)publish();}
  else if(d.type==='pause'){control.pause(d.value,s.time);lastTick=0;publish();}
  else if(d.type==='reset'){s.reset(d.scene);control.reset();ms=0;rate=0;lastTick=0;publish();}
  else if(d.type==='run'||d.type==='step'){const ok=d.type==='run'?control.start(d.duration,s.time):control.single();self.postMessage({type:'operation',ok});publish();}
  else if(d.type==='part'){self.postMessage({type:'operation',ok:s.lab.command(d)});publish();}
  else if(d.type==='press'){s.setPress(d.value);publish();}
  else if(d.type==='settings'){s.setSettings(d.value);publish();}
  else if(d.type==='domain'){try{s.configureDomain(d.value);self.postMessage({type:'domain-configured',ok:true});}catch(e){self.postMessage({type:'domain-configured',ok:false,message:e.message});}publish();}
  else if(d.type==='box'||d.type==='geometry'){
    try{const partId=s.createGeometry(d);self.postMessage({type:'created',ok:true,partId});}catch(e){self.postMessage({type:'created',ok:false,message:e.message});}publish();
  }
  else if(d.type==='brush'){s.brush(d.tool,d.point,d.radius);publish();}
  else if(d.type==='drag-start')s.beginDrag(d.point,d.radius);
  else if(d.type==='drag'){if(s.drag)s.drag.point=d.point;}
  else if(d.type==='drag-end')s.drag=null;
};
