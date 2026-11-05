import {temperatureScale,temperaturePaletteGLSL} from '../simulation/temperature-display.js';
const heat=v=>v<.5?[.12+.26*v,.30+1.12*v,.85-.5*v]:[.25+1.5*(v-.5),.86-1.26*(v-.5),.60-1.04*(v-.5)];
export function femMinimum(frame,field){return field==='temperature'?Math.min(...frame.fem.parts.map(p=>Math.min(...p.temperature??[0]))):0;}
export function femRange(frame,field){
  if(field==='temperature')return Math.max(...frame.fem.parts.map(p=>Math.max(...p.temperature??[0])));
  let max=0;
  for(const p of frame.fem.parts){
    if(field==='displacement')for(let i=0;i<p.nodes.length;i++)max=Math.max(max,Math.hypot(...p.displacement.subarray(3*i,3*i+3)));
    else if(field==='vonMises')for(const x of p.vonMises)max=Math.max(max,x);
    else for(const e of p.strain)max=Math.max(max,Math.sqrt(e[0]**2+e[1]**2+e[2]**2+.5*(e[3]**2+e[4]**2+e[5]**2)));
  }return max;
}
export function drawFEM(view,frame){
  if(!frame.fem)return;
  const gl=view.gl,settings=view.femSettings??{field:'displacement',scale:5,wire:true,original:true},key=JSON.stringify(settings);
  if(!view.femGL){
    const program=gl.createProgram();
    for(const [type,source] of [[gl.VERTEX_SHADER,`#version 300 es
precision highp float;layout(location=0)in vec3 vertex;layout(location=1)in vec3 tint;uniform vec3 eye,right,up,forward;uniform vec4 proj;out vec3 c;
void main(){vec3 d=vertex-eye;vec3 v=vec3(dot(d,right),dot(d,up),-dot(d,forward));gl_Position=vec4(v.x*proj.x/proj.y,v.y*proj.x,proj.z*v.z+proj.w,-v.z);c=tint;}`],[gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;in vec3 c;uniform float temperatureMode;out vec4 color;${temperaturePaletteGLSL}
void main(){color=vec4(temperatureMode>.5?temperaturePalette(c.x):c,1.);}`]]){
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(program,s);
    }
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    const vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
    view.femGL={program,vao,buffer};
  }
  const cache=view.femGL,range=temperatureScale(frame,settings);
  if(cache.frame!==frame||cache.key!==key){
    const vertices=[],lines=[],original=[],fixed=[],loaded=[],max=femRange(frame,settings.field),min=femMinimum(frame,settings.field);
    for(const p of frame.fem.parts){
      const pos=i=>p.nodes[i].map((x,k)=>x+settings.scale*p.displacement[3*i+k]);
      const fixedIndices=new Set(p.fixedTriangles??[]),loadedIndices=new Set(p.loadedTriangles??[]);
      for(const [triangleIndex,t] of p.surface.entries()){
        for(const i of t.nodes){
          const e=p.strain[t.element],value=settings.field==='temperature'?(p.temperature?.[i]??0):settings.field==='displacement'?Math.hypot(...p.displacement.subarray(i*3,i*3+3)):
            settings.field==='vonMises'?(p.vonMises[t.element]??0):e?Math.sqrt(e[0]**2+e[1]**2+e[2]**2+.5*(e[3]**2+e[4]**2+e[5]**2)):0;
          vertices.push(...pos(i),...(settings.field==='temperature'?[(value-range.min)/(range.max-range.min),0,0]:heat(max>min?Math.max(0,Math.min(1,(value-min)/(max-min))):0)));
        }
        for(let k=0;k<3;k++){
          const a=t.nodes[k],b=t.nodes[(k+1)%3];
          if(settings.wire)lines.push(...pos(a),...pos(b));
          if(settings.original)original.push(...p.nodes[a],...p.nodes[b]);
          if(fixedIndices.has(triangleIndex)||(p.fixedFaces??[]).includes(t.face))fixed.push(...pos(a),...pos(b));
          if(loadedIndices.has(triangleIndex)||(p.loadedFaces??[]).includes(t.face))loaded.push(...pos(a),...pos(b));
        }
      }
    }
    Object.assign(cache,{frame,key,count:vertices.length/6,lines,original,fixed,loaded});
    gl.bindBuffer(gl.ARRAY_BUFFER,cache.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
  }
  view.camera(cache.program);gl.uniform1f(gl.getUniformLocation(cache.program,'temperatureMode'),settings.field==='temperature'?1:0);gl.bindVertexArray(cache.vao);
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.drawArrays(gl.TRIANGLES,0,cache.count);gl.disable(gl.POLYGON_OFFSET_FILL);
  if(cache.lines.length)view.drawLines(cache.lines,[.12,.21,.27]);
  if(cache.original.length)view.drawLines(cache.original,view.lightBackground?[.55,.59,.60]:[.35,.42,.46]);
  view.drawLines(cache.fixed,[.12,.75,.38]);view.drawLines(cache.loaded,[1,.55,.13]);
}
