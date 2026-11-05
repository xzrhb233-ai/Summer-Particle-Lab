// Background nodes lie on world multiples of h, including when the physical
// domain bounds cut a cell. Guard nodes outside the domain are not modeling aids.
export const coordinateNumber = value => String(Number(value.toFixed(6)));
export function gridAxes(domain) {
  const h=domain?.cellSize;
  if(!Number.isFinite(h)||h<=0||domain.lower?.length!==3||domain.upper?.length!==3||!domain.lower.every(Number.isFinite)||!domain.upper.every(Number.isFinite))return null;
  const axes=domain.lower.map((lo,a)=>{
    const first=Math.ceil(lo/h-1e-9),last=Math.floor(domain.upper[a]/h+1e-9);
    return {first,last,count:last-first+1};
  });
  return axes.some(a=>a.count<1||a.count>128)?null:axes;
}
export function gridSlice(domain,axis,index) {
  const axes=gridAxes(domain);if(!axes||![0,1,2].includes(axis))return null;
  const layer=Math.max(axes[axis].first,Math.min(axes[axis].last,Math.round(index)));
  const other=[0,1,2].filter(a=>a!==axis),points=[],lines=[],h=domain.cellSize;
  for(let i=axes[other[0]].first;i<=axes[other[0]].last;i++)for(let j=axes[other[1]].first;j<=axes[other[1]].last;j++){
    const p=[0,0,0];p[axis]=layer*h;p[other[0]]=i*h;p[other[1]]=j*h;points.push(p);
  }
  for(const a of other){const b=other.find(b=>b!==a);for(let i=axes[a].first;i<=axes[a].last;i++){
    const p=domain.lower.slice(),q=domain.upper.slice();p[axis]=q[axis]=layer*h;p[a]=q[a]=i*h;lines.push([p,q]);
  }}
  return {axes,axis,layer,value:layer*h,points,lines};
}
export function projectCoordinate(point,basis,width,height,near=.01,far=500) {
  const d=point.map((x,i)=>x-basis.eye[i]),dot=v=>v.reduce((s,x,i)=>s+x*d[i],0),z=dot(basis.forward);
  if(z<near||z>far||width<=0||height<=0)return null;
  const scale=height/(2*Math.tan(Math.PI/8)*z);
  const x=width/2+dot(basis.right)*scale,y=height/2-dot(basis.up)*scale;
  return Number.isFinite(x+y)?{x,y,depth:z}:null;
}
export function nearestCoordinate(points,x,y,radius=12) {
  let best=null,distance=radius*radius;
  for(const p of points){const d=(p.x-x)**2+(p.y-y)**2;if(d<distance){distance=d;best=p;}}
  return best;
}

export function installGridCoordinates({parent,getContext}) {
  const panel=document.createElement('details');panel.id='grid-coordinates-panel';panel.className='instrument';
  panel.innerHTML=`<summary>网格坐标与定位</summary>
    <label class="check"><input id="grid-coordinates-show" type="checkbox" checked>显示坐标轴与刻度</label>
    <p class="hint">X 红色 · Y 绿色 · Z 蓝色，每轴 5 个刻度。标号表示世界坐标；刻度间隔不代表网格大小。</p>
    <p id="grid-coordinate-domain" class="hint"></p><button id="grid-coordinate-fit">视角适配坐标范围</button>
    <label class="check"><input id="grid-coordinate-pick" type="checkbox">启用网格节点拾取</label>
    <div id="grid-coordinate-picking-controls" hidden>
      <label for="grid-coordinate-plane">坐标切片平面</label><select id="grid-coordinate-plane"><option value="1">XZ · 沿 Y 移动</option><option value="2">XY · 沿 Z 移动</option><option value="0">YZ · 沿 X 移动</option></select>
      <label for="grid-coordinate-layer">切片网格层 <output id="grid-coordinate-level"></output></label><input id="grid-coordinate-layer" type="range" min="0" max="0" value="0" step="1">
      <p id="grid-coordinate-readout" class="hint" role="status">移动鼠标到节点查看 XYZ；单击节点锁定坐标。</p>
      <div class="buttons"><button id="grid-coordinate-rigid" disabled>填入刚体中心</button><button id="grid-coordinate-mpm" disabled>填入 MPM 中心</button><button id="grid-coordinate-particle" disabled>填入几何中心</button></div>
      <p class="hint">只显示所选节点的坐标。填入只修改生成位置，不创建物体；仍需检查尺寸、边界和已有物体。</p>
    </div>`;
  parent.prepend(panel);
  const $=id=>document.getElementById(id),canvas=document.createElement('canvas');canvas.className='grid-coordinate-overlay';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;document.querySelector('main').append(canvas);
  const ctx=canvas.getContext('2d');let domainKey='',lastDraw='',slice=null,screen=[],locked=null,hover=null,pointer=null,viewer=null,down=null;
  const fmt=p=>`(${p.map(coordinateNumber).join(', ')})`,en=()=>document.documentElement.lang==='en';
  function unit(context){return context.unit==='m'?'m':en()?'sim units':'仿真单位';}
  function info(point,context){return `${point===locked?(en()?'Selected node':'已锁定节点'):(en()?'Node':'节点')} · X ${coordinateNumber(point[0])} · Y ${coordinateNumber(point[1])} · Z ${coordinateNumber(point[2])} ${unit(context)}`;}
  function report(context){const point=locked??hover;
    const message=point?info(point,context):en()?'Move over a node for XYZ; click to select.':'移动鼠标到节点查看 XYZ；单击节点锁定坐标。';
    if($('grid-coordinate-readout').textContent!==message)$('grid-coordinate-readout').textContent=message;
    for(const kind of ['rigid','mpm','particle']){$('grid-coordinate-'+kind).hidden=context.project?kind==='particle':kind!=='particle';$('grid-coordinate-'+kind).disabled=!locked;}
  }
  function connect(next){
    if(viewer===next)return;viewer=next;pointer=null;locked=null;hover=null;lastDraw='';
    if(!next||next.canvas.dataset.coordinateEvents)return;next.canvas.dataset.coordinateEvents='true';
    next.canvas.addEventListener('pointermove',e=>{if(viewer!==next)return;const r=next.canvas.getBoundingClientRect();pointer={x:e.clientX-r.left,y:e.clientY-r.top};});
    next.canvas.addEventListener('pointerleave',()=>{pointer=null;hover=null;lastDraw='';});
    next.canvas.addEventListener('pointerdown',e=>{
      down={x:e.clientX,y:e.clientY,button:e.button};
      if(viewer!==next||e.button!==0||!$('grid-coordinates-show').checked||!$('grid-coordinate-pick').checked)return;
      const r=next.canvas.getBoundingClientRect(),hit=nearestCoordinate(screen,e.clientX-r.left,e.clientY-r.top);
      if(hit){locked=hit.point.slice();lastDraw='';report(getContext());next.canvas.focus({preventScroll:true});e.preventDefault();e.stopImmediatePropagation();}
    },true); // Picking a node must not accidentally paint or heat the model.
    next.canvas.addEventListener('pointerup',e=>{
      if(!$('grid-coordinates-show').checked||!$('grid-coordinate-pick').checked||viewer!==next||down?.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;
      const r=next.canvas.getBoundingClientRect(),hit=nearestCoordinate(screen,e.clientX-r.left,e.clientY-r.top);
      if(hit){locked=hit.point.slice();lastDraw='';report(getContext());}
    });
  }
  function clearSelection(){locked=hover=null;lastDraw='';}
  $('grid-coordinate-plane').onchange=()=>{domainKey='';clearSelection();};
  $('grid-coordinate-layer').oninput=()=>{slice=null;clearSelection();};
  $('grid-coordinate-pick').onchange=()=>{clearSelection();screen=[];if($('grid-coordinate-pick').checked)$('grid-coordinates-show').checked=true;update();};
  $('grid-coordinates-show').onchange=()=>{lastDraw='';if(!$('grid-coordinates-show').checked){canvas.hidden=true;clearSelection();}update();};
  $('grid-coordinate-fit').onclick=()=>{
    const c=getContext(),d=c?.domain;if(!c?.renderer||!d||!gridAxes(d))return;
    c.renderer.target=d.lower.map((lo,a)=>(lo+d.upper[a])/2);
    const extent=Math.max(...d.upper.map((hi,a)=>hi-d.lower[a]));
    c.renderer.distance=Math.max(c.project ? .1 : 20,extent*2/Math.min(1,c.renderer.width/c.renderer.height));lastDraw='';
  };
  function fill(kind){
    if(!locked)return;const c=getContext();
    if(!c||c.renderer!==viewer)return;
    if(kind==='particle'){$('geometry-mode3').value='center';$('geometry-mode3').dispatchEvent(new Event('change'));}
    const prefix={rigid:'mbd-body-position',mpm:'coupling-center',particle:'geometry-c'}[kind];
    for(let i=0;i<3;i++){$(prefix+i).value=coordinateNumber(locked[i]);$(prefix+i).dispatchEvent(new Event('input',{bubbles:true}));}
    window.dispatchEvent(new CustomEvent('workbench-reveal',{detail:{chapter:'geometry',folder:{rigid:'mbd-body-panel',mpm:'mbd-specimen-panel',particle:'geometry-panel3'}[kind]}}));
  }
  for(const kind of ['rigid','mpm','particle'])$('grid-coordinate-'+kind).onclick=()=>fill(kind);
  function update(){
    const c=getContext();if(!c?.renderer){canvas.hidden=true;connect(null);return;}connect(c.renderer);
    const axes=gridAxes(c.domain),enabled=$('grid-coordinates-show').checked,picking=enabled&&!c.fem&&$('grid-coordinate-pick').checked;
    $('grid-coordinate-pick').disabled=!!c.fem;
    $('grid-coordinate-picking-controls').hidden=!picking;
    $('grid-coordinate-fit').disabled=!axes;for(const id of ['grid-coordinate-plane','grid-coordinate-layer'])$(id).disabled=!axes;
    if(!axes){canvas.hidden=true;clearSelection();$('grid-coordinate-domain').textContent=en()?'Apply an MPM domain and grid first.':'请先在计算域与 MPM 离散中应用网格设置。';report(c);return;}
    const axis=Number($('grid-coordinate-plane').value),key=JSON.stringify([c.domain.lower,c.domain.upper,c.domain.cellSize,axis,c.project]);
    if(key!==domainKey){domainKey=key;slice=null;clearSelection();const a=axes[axis];$('grid-coordinate-layer').min=a.first;$('grid-coordinate-layer').max=a.last;$('grid-coordinate-layer').value=Math.max(a.first,Math.min(a.last,0));}
    const layer=Number($('grid-coordinate-layer').value);
    if(!slice||slice.layer!==layer)slice=gridSlice(c.domain,axis,layer);
    const description=`X ${coordinateNumber(c.domain.lower[0])} … ${coordinateNumber(c.domain.upper[0])} · Y ${coordinateNumber(c.domain.lower[1])} … ${coordinateNumber(c.domain.upper[1])} · Z ${coordinateNumber(c.domain.lower[2])} … ${coordinateNumber(c.domain.upper[2])} ${unit(c)}${c.fem?'':`\nh = ${coordinateNumber(c.domain.cellSize)} ${unit(c)}`}`;
    if($('grid-coordinate-domain').textContent!==description)$('grid-coordinate-domain').textContent=description;
    const level='XYZ'[axis]+' = '+coordinateNumber(slice.value)+' '+unit(c);if($('grid-coordinate-level').textContent!==level)$('grid-coordinate-level').textContent=level;
    canvas.hidden=!enabled;report(c);if(!enabled)return;
    const view=c.renderer,r=view.canvas.getBoundingClientRect(),main=canvas.parentElement.getBoundingClientRect(),basis=view.basis(),dpr=Math.min(devicePixelRatio,2);
    if(!r.width||!r.height)return;
    const signature=JSON.stringify([key,layer,basis,r.x,r.y,r.width,r.height,dpr,view.lightBackground,picking,picking?pointer:null,locked,en()]);if(signature===lastDraw)return;lastDraw=signature;
    canvas.style.left=(r.left-main.left)+'px';canvas.style.top=(r.top-main.top)+'px';canvas.style.width=r.width+'px';canvas.style.height=r.height+'px';
    const w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
    const project=p=>projectCoordinate(p,basis,r.width,r.height,c.project ? .01 : 1,c.project?500:2000),light=view.lightBackground;
    const ink=light?'#214c59':'#d2e7ed',background=light?'rgba(244,250,250,.88)':'rgba(12,28,35,.88)';
    screen=picking?slice.points.map(point=>{const p=project(point);return p?{...p,point}:null;}).filter(p=>p&&p.x>4&&p.y>135&&p.x<r.width-4&&p.y<r.height-54):[];
    hover=pointer?nearestCoordinate(screen,pointer.x,pointer.y)?.point??null:null;ctx.fillStyle=ink;
    ctx.globalAlpha=.45;for(const p of screen){ctx.beginPath();ctx.arc(p.x,p.y,1.6,0,2*Math.PI);ctx.fill();}ctx.globalAlpha=1;
    const occupied=[],selected=locked??hover;
    function label(text,x,y,color,bold=false){
      ctx.font=`${bold?'bold 14':'12'}px Consolas, monospace`;
      const width=ctx.measureText(text).width+10,base={x:Math.max(3,Math.min(r.width-width-3,x-width/2)),y:Math.max(4,Math.min(r.height-58,y-10)),w:width,h:20};
      // Keep labels close to their ticks, trying both sides of a collision.
      const candidates=[[0,0],[0,-22],[0,22],[-width-4,0],[width+4,0],[0,-44],[0,44]];
      const box=candidates.map(([dx,dy])=>({...base,x:base.x+dx,y:base.y+dy})).find(box=>box.x>=3&&box.x+box.w<=r.width-3&&box.y>=4&&box.y+box.h<=r.height-38&&!occupied.some(b=>box.x<b.x+b.w+2&&box.x+box.w>b.x-2&&box.y<b.y+b.h+2&&box.y+box.h>b.y-2))??base;
      occupied.push(box);ctx.fillStyle=background;ctx.fillRect(box.x,box.y,box.w,box.h);ctx.fillStyle=color;ctx.fillText(text,box.x+5,box.y+14);
    }
    // Coordinate rulers span the physical domain, independently of h. They
    // meet at world zero when it is in the domain, or its nearest boundary.
    const origin=c.domain.lower.map((lo,a)=>Math.max(lo,Math.min(c.domain.upper[a],0)));
    const colors=light?['#bf3d3d','#247a48','#286ac5']:['#ff8686','#75d79b','#86b7ff'];
    const labels=[];let labeledZero=false;
    for(let a=0;a<3;a++){
      const start=origin.slice(),end=origin.slice();start[a]=c.domain.lower[a];end[a]=c.domain.upper[a];
      const p=project(start),q=project(end);if(!p||!q)continue;
      const length=Math.hypot(q.x-p.x,q.y-p.y);if(length<8)continue;
      const dx=(q.x-p.x)/length,dy=(q.y-p.y)/length,nx=-dy,ny=dx,color=colors[a];
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
      ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(q.x+dx*6,q.y+dy*6);ctx.lineTo(q.x-dx*5+nx*4,q.y-dy*5+ny*4);ctx.lineTo(q.x-dx*5-nx*4,q.y-dy*5-ny*4);ctx.closePath();ctx.fill();
      if(q.x>=0&&q.x<=r.width&&q.y>=0&&q.y<=r.height-54)labels.push(['XYZ'[a],q.x+dx*24,q.y+dy*24,color,true]);
      for(let i=0;i<5;i++){
        const point=origin.slice();point[a]=start[a]+(end[a]-start[a])*i/4;const tick=project(point);
        if(!tick||tick.x<0||tick.x>r.width||tick.y<0||tick.y>r.height-54)continue;
        ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(tick.x-nx*4,tick.y-ny*4);ctx.lineTo(tick.x+nx*4,tick.y+ny*4);ctx.stroke();
        const atZero=point.every(value=>Math.abs(value)<1e-10);
        if(atZero&&labeledZero)continue;if(atZero)labeledZero=true;
        labels.push([coordinateNumber(point[a]),tick.x+nx*17,tick.y+ny*17,atZero?ink:color]);
      }
    }
    // Draw labels after all axis strokes so a later axis cannot strike through them.
    for(const args of labels)label(...args);
    const selectedScreen=selected?project(selected):null;
    if(selectedScreen&&selectedScreen.x>=0&&selectedScreen.x<=r.width&&selectedScreen.y>=135&&selectedScreen.y<=r.height-54){label(fmt(selected),selectedScreen.x,selectedScreen.y-22,light?'#8a4b02':'#ffca72');ctx.strokeStyle=light?'#a65c0c':'#ffd078';ctx.lineWidth=2;ctx.beginPath();ctx.arc(selectedScreen.x,selectedScreen.y,5,0,2*Math.PI);ctx.stroke();}
    ctx.font='11px Consolas, monospace';ctx.fillStyle=background;ctx.fillRect(12,r.height-48,Math.min(r.width-24,370),36);ctx.fillStyle=ink;
    ctx.fillText(`XYZ (${unit(c)})${c.fem?' · FEM':` · h = ${coordinateNumber(c.domain.cellSize)}`}${picking?' · '+level:''}`,20,r.height-33);
    ctx.fillText(selected?fmt(selected):picking?(en()?'Hover / click a grid node':'移动鼠标 / 单击网格节点'):(en()?'5 ticks per axis · world coordinates':'每轴 5 个刻度 · 世界坐标'),20,r.height-18);
    report(c);
  }
  window.addEventListener('workbench-languagechange',()=>{lastDraw='';});
  return {update};
}
