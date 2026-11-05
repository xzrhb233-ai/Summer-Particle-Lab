import {MultibodyRenderer} from '../multibody/renderer.js';
import {validateCAD} from '../three/cad-geometry.js';
import {validateCurve,validateCADMesh} from '../three/cad-tools.js';
import {validateSurface} from '../three/cad-surfaces.js';
import {clearCADSurfaceBuffers,disposeCADSurfaceRenderer} from '../three/cad-surface-render.js';

// Event-driven preview: rendering happens only on changes, never per frame.
export function mountCADPreview(canvas){
  let renderer=null,frame=null,drag=null,disposed=false,needsFit=false,lines=null,controlLines=null,lineBounds=null;
  const visible=()=>{const r=canvas.getBoundingClientRect();return r.width>0&&r.height>0;};
  function resize(){
    if(disposed||!renderer||!visible())return;
    renderer.resize();
    if(frame&&needsFit){
      if(lineBounds){renderer.target=lineBounds.lower.map((x,k)=>(x+lineBounds.upper[k])/2);renderer.distance=Math.max(.03,Math.max(...lineBounds.upper.map((x,k)=>x-lineBounds.lower[k]))*2/Math.min(1,renderer.width/renderer.height));}
      else renderer.fit(frame);needsFit=false;
    }
    if(frame)renderer.drawFrame(frame,null);
    else{const gl=renderer.gl;gl.clearColor(.91,.94,.94,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}
    if(lines?.length){renderer.gl.enable(renderer.gl.DEPTH_TEST);renderer.drawLines(lines,[.06,.44,.48]);if(controlLines?.length)renderer.drawLines(controlLines,[.8,.48,.12]);}
  }
  function show(cad){
    if(disposed)throw Error('CAD 预览已经关闭');validateCAD(cad);
    if(!renderer)renderer=new MultibodyRenderer(canvas);
    renderer.cadSurfaces=[];clearCADSurfaceBuffers(renderer);
    lines=controlLines=lineBounds=null;
    renderer.floor=[];renderer.pitch=.55;renderer.yaw=.65;
    frame={bodies:[{id:'cad-preview',shape:'cad',cad,size:cad.upper.map((x,k)=>x-cad.lower[k]),position:cad.lower.map((x,k)=>(x+cad.upper[k])/2),rotation:[0,0,0,1],type:'dynamic'}],joints:[]};
    needsFit=true;resize();
  }
  function showLines(points,edges,controls=null){
    if(disposed)throw Error('CAD 预览已经关闭');
    if(!renderer)renderer=new MultibodyRenderer(canvas);renderer.floor=[];renderer.pitch=.35;renderer.yaw=.4;
    renderer.cadSurfaces=[];clearCADSurfaceBuffers(renderer);
    frame={bodies:[],joints:[]};lines=edges.flatMap(e=>e.flatMap(i=>points[i]));
    controlLines=controls?.slice(1).flatMap((p,i)=>[...controls[i],...p])??null;
    lineBounds={lower:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),upper:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};needsFit=true;resize();
  }
  function showCurve(curve){validateCurve(curve);showLines(curve.points,curve.points.slice(1).map((_,i)=>[i,i+1]),curve.spec.controlPoints);}
  function showMesh(mesh,{cut=1}={}){
    validateCADMesh(mesh);const seen=new Set(),edges=[],lo=Math.min(...mesh.nodes.map(p=>p[1])),hi=Math.max(...mesh.nodes.map(p=>p[1]));
    for(const e of mesh.elements){if(mesh.kind==='volume'&&e.reduce((s,i)=>s+mesh.nodes[i][1],0)/4>lo+(hi-lo)*cut)continue;
      for(let a=0;a<e.length;a++)for(let b=a+1;b<e.length;b++){const k=[e[a],e[b]].sort((x,y)=>x-y).join(',');if(!seen.has(k)){seen.add(k);edges.push([e[a],e[b]]);}}
    }showLines(mesh.nodes,edges);
  }
  function showSurface(surface,{wireframe=true,controlNet=true}={}){
    if(disposed)throw Error('CAD 预览已经关闭');validateSurface(surface);
    if(!renderer)renderer=new MultibodyRenderer(canvas);
    lines=controlLines=lineBounds=null;renderer.floor=[];renderer.pitch=.55;renderer.yaw=.65;
    renderer.cadSurfaces=[{id:'cad-surface-preview',name:'CAD 曲面预览',data:surface,wireframe:!!wireframe,controlNet:!!controlNet}];
    frame={bodies:[],joints:[]};needsFit=true;resize();
  }
  function clear(){
    frame=null;drag=null;lines=controlLines=lineBounds=null;
    if(renderer){renderer.cadSurfaces=[];clearCADSurfaceBuffers(renderer);}
    if(renderer)for(const [key,m] of renderer.meshes){renderer.gl.deleteVertexArray(m.vao);renderer.gl.deleteBuffer(m.buffer);renderer.meshes.delete(key);}
    resize();
  }
  const down=e=>{if(!frame)return;drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
  const up=()=>{drag=null;};
  const move=e=>{if(drag&&renderer){renderer.yaw-=(e.clientX-drag[0])*.01;renderer.pitch=Math.max(-1.45,Math.min(1.45,renderer.pitch+(e.clientY-drag[1])*.01));drag=[e.clientX,e.clientY];resize();}};
  const wheel=e=>{if(frame&&renderer){e.preventDefault();renderer.distance=Math.max(.03,Math.min(200,renderer.distance*Math.exp(e.deltaY*.001)));resize();}};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);canvas.addEventListener('wheel',wheel,{passive:false});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function dispose(){
    if(disposed)return;clear();disposed=true;observer.disconnect();
    canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);
    if(renderer){
      const gl=renderer.gl;
      disposeCADSurfaceRenderer(renderer);
      for(const key of ['pointVAO','lineVAO'])if(renderer[key])gl.deleteVertexArray(renderer[key]);
      for(const key of ['pointBuffer','lineBuffer'])if(renderer[key])gl.deleteBuffer(renderer[key]);
      for(const key of ['points','lines','meshProgram'])if(renderer[key]){for(const shader of gl.getAttachedShaders(renderer[key])??[])gl.deleteShader(shader);gl.deleteProgram(renderer[key]);}
      renderer=null;
    }
  }
  return {show,showCurve,showMesh,showSurface,clear,resize,dispose};
}
