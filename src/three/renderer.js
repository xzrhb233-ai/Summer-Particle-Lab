import {particleLightingGLSL} from './particle-lighting.js';
import { add,sub,mul,dot,cross,norm,clamp } from './math.js';
import {DEFAULT_DOMAIN,domainParameters,transform} from './discretization.js';
const cameraGLSL=`uniform vec3 eye;uniform vec3 right;uniform vec3 up;uniform vec3 forward;uniform vec4 proj;
vec3 view(vec3 p){vec3 d=p-eye;return vec3(dot(d,right),dot(d,up),-dot(d,forward));}
vec4 project(vec3 p){return vec4(p.x*proj.x/proj.y,p.y*proj.x,proj.z*p.z+proj.w,-p.z);}`;
function program(gl,vs,fs){
  const p=gl.createProgram();for(const [type,text] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
}
function cubeLines(a,b){
  const out=[];for(let axis=0;axis<3;axis++)for(let u=0;u<2;u++)for(let v=0;v<2;v++){
    const p=a.slice(),q=a.slice(),j=(axis+1)%3,k=(axis+2)%3;p[j]=q[j]=u?b[j]:a[j];p[k]=q[k]=v?b[k]:a[k];q[axis]=b[axis];out.push(...p,...q);
  }return out;
}
export class Renderer3 {
  constructor(canvas){
    this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl2',{antialias:true,alpha:false});if(!gl)throw Error('此设备未提供 WebGL 2，无法打开三维视图。');
    this.yaw=.67;this.pitch=.35;this.distance=220;this.target=[0,0,0];this.heatmap=false;this.heatMax=100;this.cut=false;this.cutZ=64;this.data=new Float32Array();this.preview=null;this.workPlane=null;
    this.space=false;this.mechanics=0;this.mechanicsMax=.3;this.press=null;this.markerScale=1;this.markerCenters=false;this.particleShading=true;
    this.points=program(gl,`#version 300 es
precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec3 info;layout(location=2)in vec2 mechanical;${cameraGLSL}
uniform float height;uniform float markerScale;uniform bool markerCenters;out vec3 meta;out float viewZ;out vec3 world;out vec2 diagnostic;flat out float markerRadius;flat out float centerMarker;
void main(){vec3 p=view(position);int m=int(info.x+.1);bool solid=m==0||(m>=4&&m<=9)||(m>=11&&m<=22);centerMarker=markerCenters&&solid?1.:0.;markerRadius=1.8*markerScale*(centerMarker>.5?.25:1.);gl_Position=project(p);gl_PointSize=clamp(2.*markerRadius*height*.5*proj.x/max(.1,-p.z),1.,100.);meta=info;viewZ=p.z;world=position;diagnostic=mechanical;}`,
`#version 300 es
precision highp float;in vec3 meta;in float viewZ;in vec3 world;in vec2 diagnostic;flat in float markerRadius;flat in float centerMarker;uniform vec4 proj;uniform bool heatmap;uniform float heatMax;uniform int mechanics;uniform float mechanicsMax;uniform bool cutting;uniform float cutZ;out vec4 color;${particleLightingGLSL}
void main(){if(cutting&&world.z>cutZ)discard;vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;vec3 n=vec3(p.x,-p.y,sqrt(1.-r));
int m=int(meta.x+.1);vec3 c=m==11?vec3(.62,.43,.91):m==12?vec3(.28,.78,.52):m==13?vec3(.89,.94,1.):m==14?vec3(.88,.65,.28):m==15?vec3(.24,.55,1.):m==16?vec3(.96,.43,.47):m==17?vec3(1.,.55,.16):m==18?vec3(.18,.85,.83):m==19?vec3(.60,.39,.21):m==20?vec3(.88,.25,.60):m==21?vec3(.92,.17,.21):m==22?vec3(.61,.79,.18):m==23?vec3(.95,.40,.12):m==2?vec3(.12,.53,.66):m==4?vec3(.58,.85,.94):m==1?vec3(1.,.35,.07):m==3?vec3(.7,.75,.8):vec3(.35,.43,.39);
if(heatmap)c=mix(vec3(.12,.38,1.),vec3(1.,.22,.07),clamp(meta.y/heatMax,0.,1.));
if(mechanics>0){float v=clamp((mechanics==1?diagnostic.x:diagnostic.y)/max(.001,mechanicsMax),0.,1.);c=v<.5?mix(vec3(.12,.30,.85),vec3(.25,.88,.63),v*2.):mix(vec3(.25,.88,.63),vec3(1.,.23,.08),(v-.5)*2.);if(m==1||m==2||m==3||m==10||m==23)c=vec3(.27,.35,.40);}
if(centerMarker<.5)c=shadeParticle(c,n);
if(meta.z>.5&&r>.5)c=vec3(.95,.82,.53);float z=viewZ+(centerMarker>.5?0.:markerRadius*n.z);gl_FragDepth=((proj.z*z+proj.w)/(-z))*.5+.5;color=vec4(c,1.);}`);
    this.lines=program(gl,`#version 300 es
precision highp float;layout(location=0)in vec3 position;${cameraGLSL}void main(){gl_Position=project(view(position));}`,
`#version 300 es
precision highp float;uniform vec3 tint;out vec4 color;void main(){color=vec4(tint,1.);}`);
    this.pointVAO=gl.createVertexArray();gl.bindVertexArray(this.pointVAO);this.pointBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.pointBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,32,12);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,32,24);
    this.lineVAO=gl.createVertexArray();gl.bindVertexArray(this.lineVAO);this.lineBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.lineBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
    this.showGrid=true;this.setDomain(domainParameters(DEFAULT_DOMAIN));this.resize();
  }
  setDomain(d){this.domain=d;const [a,b,h]=[d.lower,d.upper,d.cellSize];this.bounds=cubeLines(a,b);this.floor=[];
    for(let x=Math.ceil(a[0]/h)*h;x<=b[0]+1e-8;x+=h)this.floor.push(x,a[1],a[2],x,a[1],b[2]);
    for(let z=Math.ceil(a[2]/h)*h;z<=b[2]+1e-8;z+=h)this.floor.push(a[0],a[1],z,b[0],a[1],z);
  }
  fitDomain(){const d=this.domain;this.target=d.lower.map((v,a)=>(v+d.upper[a])/2);this.distance=Math.max(40,Math.max(...d.size)*1.9);}
  setGeometryPreview(g){const half=g.size.map(v=>v*.5),lines=[],point=p=>transform(g.R,p).map((v,a)=>v+g.center[a]);
    if(g.shape==='box'){const raw=cubeLines(half.map(v=>-v),half);for(let i=0;i<raw.length;i+=3)lines.push(...point(raw.slice(i,i+3)));}
    else{const axes=g.shape==='ellipsoid'?[0,1,2]:[1];for(const axis of axes)for(const level of g.shape==='cylinder'?[-1,1]:[0])for(let i=0;i<64;i++)for(const t of [i,i+1]){const p=[0,0,0],a=(axis+1)%3,b=(axis+2)%3;p[axis]=half[axis]*level;p[a]=half[a]*Math.cos(t*Math.PI/32);p[b]=half[b]*Math.sin(t*Math.PI/32);lines.push(...point(p));}
      if(g.shape==='cylinder')for(let i=0;i<8;i++)for(const y of [-1,1])lines.push(...point([half[0]*Math.cos(i*Math.PI/4),y*half[1],half[2]*Math.sin(i*Math.PI/4)]));}
    this.geometryPreview=lines;
  }
  resize(){const r=this.canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio,2);this.width=r.width;this.height=r.height;this.canvas.width=Math.round(r.width*d);this.canvas.height=Math.round(r.height*d);}
  basis(){
    const offset=[Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch)];
    const eye=add(this.target,mul(offset,this.distance)),forward=norm(sub(this.target,eye)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
    return {eye,forward,right,up};
  }
  camera(program){
    const gl=this.gl,b=this.basis();gl.useProgram(program);
    for(const key of ['eye','forward','right','up'])gl.uniform3fv(gl.getUniformLocation(program,key),b[key]);
    gl.uniform4f(gl.getUniformLocation(program,'proj'),1/Math.tan(Math.PI/8),this.width/this.height,-2001/1999,-4000/1999);
  }
  ray(x,y){
    const r=this.canvas.getBoundingClientRect(),b=this.basis(),f=1/Math.tan(Math.PI/8),u=((x-r.left)/r.width*2-1)*r.width/r.height/f,v=(1-(y-r.top)/r.height*2)/f;
    return {origin:b.eye,direction:norm(add(b.forward,add(mul(b.right,u),mul(b.up,v))))};
  }
  plane(x,y,point,normal){const ray=this.ray(x,y),den=dot(ray.direction,normal);if(Math.abs(den)<.015)return null;const t=dot(sub(point,ray.origin),normal)/den;return t>0?add(ray.origin,mul(ray.direction,t)):null;}
  pick(x,y){
    const ray=this.ray(x,y);let best=Infinity,result=null;
    for(let p=0;p<this.data.length;p+=8){const pos=Array.from(this.data.subarray(p,p+3));if(this.cut&&pos[2]>this.cutZ)continue;const d=sub(pos,ray.origin),t=dot(d,ray.direction);if(t<0)continue;
      const m=Math.round(this.data[p+3]),solid=m===0||(m>=4&&m<=9)||(m>=11&&m<=22);
      // Match marker size, with a two-pixel tolerance for small center markers.
      const radius=Math.max(1.8*this.markerScale*(this.markerCenters&&solid ? .25 : 1),2*t*Math.tan(Math.PI/8)/this.height);
      const distance=dot(d,d)-t*t;if(distance>radius**2)continue;const hit=t-Math.sqrt(Math.max(0,radius**2-distance));if(hit<best){best=hit;result=pos;}}
    return result;
  }
  upload(data){this.data=data;const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.pointBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);}
  drawLines(data,color){const gl=this.gl;this.camera(this.lines);gl.uniform3fv(gl.getUniformLocation(this.lines,'tint'),color);gl.bindVertexArray(this.lineVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINES,0,data.length/3);}
  draw(){
    const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.enable(gl.DEPTH_TEST);gl.clearColor(...(this.background||[.025,.041,.057]),1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!this.space){if(this.showGrid)this.drawLines(this.floor,this.lightBackground?[.56,.61,.61]:[.10,.18,.21]);this.drawLines(this.bounds,this.lightBackground?[.36,.43,.45]:[.19,.30,.34]);}
    if(this.workPlane){const {axis,value}=this.workPlane,a=this.domain.lower.slice(),b=this.domain.upper.slice();a[axis]=b[axis]=value;this.drawLines(cubeLines(a,b),[.26,.45,.49]);}
    if(this.preview)this.drawLines(cubeLines(...this.preview),[.8,.67,.95]);
    if(this.geometryPreview)this.drawLines(this.geometryPreview,[.22,.72,.65]);
    if(this.press?.enabled){
      const y=this.press.y,a=this.domain.lower,b=this.domain.upper,h=this.domain.cellSize,lines=cubeLines([a[0],y,a[2]],[b[0],y+3,b[2]]);
      for(let x=a[0]+h;x<b[0];x+=2*h)lines.push(x,y,a[2],x,y,b[2]);
      for(let z=a[2]+h;z<b[2];z+=2*h)lines.push(a[0],y,z,b[0],y,z);
      this.drawLines(lines,[.73,.82,.88]);
      if(Math.abs(y-this.press.target)>1)this.drawLines(cubeLines([a[0],this.press.target,a[2]],[b[0],this.press.target,b[2]]),[.38,.28,.16]);
    }
    this.camera(this.points);gl.uniform1i(gl.getUniformLocation(this.points,'particleShading'),this.particleShading);gl.uniform1f(gl.getUniformLocation(this.points,'height'),this.canvas.height);gl.uniform1i(gl.getUniformLocation(this.points,'heatmap'),this.heatmap);gl.uniform1f(gl.getUniformLocation(this.points,'heatMax'),this.heatMax);
    gl.uniform1f(gl.getUniformLocation(this.points,'markerScale'),this.markerScale);gl.uniform1i(gl.getUniformLocation(this.points,'markerCenters'),this.markerCenters);
    gl.uniform1i(gl.getUniformLocation(this.points,'cutting'),this.cut);gl.uniform1f(gl.getUniformLocation(this.points,'cutZ'),this.cutZ);
    gl.uniform1i(gl.getUniformLocation(this.points,'mechanics'),this.mechanics);gl.uniform1f(gl.getUniformLocation(this.points,'mechanicsMax'),this.mechanicsMax);
    gl.bindVertexArray(this.pointVAO);gl.drawArrays(gl.POINTS,0,this.data.length/8);
    gl.disable(gl.DEPTH_TEST);
    if(this.selection)this.drawLines(cubeLines(...this.selection),[.95,.78,.35]);
    if(this.gravityCenter){const c=this.gravityCenter,lines=[];for(let a=0;a<3;a++){const lo=c.slice(),hi=c.slice();lo[a]-=6;hi[a]+=6;lines.push(...lo,...hi);}this.drawLines(lines,[1,.75,.35]);}
    gl.enable(gl.DEPTH_TEST);
  }
  orbit(dx,dy){this.yaw-=dx*.006;this.pitch=clamp(this.pitch+dy*.006,-1.4,1.4);}
}
