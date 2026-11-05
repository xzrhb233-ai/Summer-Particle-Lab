// Event-driven engineering surface picker. Uses the actual FEM boundary
// triangles; IDs come from the semantic surface catalog, not screen indices.
export function mountSurfacePreview(canvas,onPick){
  const ctx=canvas.getContext('2d');let mesh=null,selected=new Set(),yaw=.55,pitch=.55,zoom=1,drag=null,projected=[];
  const inside=(p,a,b,c)=>{const side=(u,v)=>(p[0]-v[0])*(u[1]-v[1])-(u[0]-v[0])*(p[1]-v[1]);const s=[side(a,b),side(b,c),side(c,a)];return !(s.some(x=>x<0)&&s.some(x=>x>0));};
  function draw(){
    const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);projected=[];
    if(!mesh){ctx.fillStyle='#657477';ctx.font='12px sans-serif';ctx.fillText('选择 FEM 部件后显示实际边界网格',12,28);return;}
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of mesh.nodes)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    const center=lo.map((v,k)=>(v+hi[k])/2),scale=.68*Math.min(r.width,r.height)/Math.max(...hi.map((v,k)=>v-lo[k]),1e-9)*zoom;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const points=mesh.nodes.map(p=>{const [x,y,z]=p.map((v,k)=>v-center[k]),u=cy*x-sy*z,w=sy*x+cy*z;return [r.width/2+scale*u,r.height/2-scale*(cp*y-sp*w),sp*y+cp*w];});
    projected=mesh.surface.map((f,index)=>({index,key:f.surfaceKey,points:f.nodes.map(i=>points[i]),depth:f.nodes.reduce((s,i)=>s+points[i][2],0)/3})).sort((a,b)=>a.depth-b.depth);
    for(const face of projected){const active=selected.has(face.index);ctx.beginPath();face.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=active?'rgba(229,160,64,.95)':'rgba(103,155,160,.26)';ctx.strokeStyle=active?'#995f24':'rgba(66,107,111,.28)';ctx.lineWidth=active?.7:.35;ctx.fill();ctx.stroke();}
  }
  const down=e=>{if(!mesh)return;drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);};
  const move=e=>{if(!drag)return;yaw-=(e.clientX-drag.x)*.012;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-drag.y)*.012));drag.x=e.clientX;drag.y=e.clientY;draw();};
  const up=e=>{if(!drag)return;const clicked=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4;drag=null;if(!clicked)return;const r=canvas.getBoundingClientRect(),p=[e.clientX-r.left,e.clientY-r.top];const hit=projected.slice().reverse().find(f=>inside(p,...f.points));if(hit?.key)onPick(hit.key);};
  const cancel=()=>{drag=null;};const wheel=e=>{if(!mesh)return;e.preventDefault();zoom=Math.max(.4,Math.min(3,zoom*Math.exp(-e.deltaY*.001)));draw();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('wheel',wheel,{passive:false});
  const observer=new ResizeObserver(draw);observer.observe(canvas);
  return {show(next,indices=[]){if(mesh!==next){zoom=1;mesh=next;}selected=new Set(indices);draw();},clear(){mesh=null;selected.clear();draw();},resize:draw,dispose(){observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('wheel',wheel);}};
}
