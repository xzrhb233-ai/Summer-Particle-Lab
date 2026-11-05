import {temperatureScale,temperatureColor,temperaturePaletteGLSL} from '../simulation/temperature-display.js';
import {particleLightingGLSL} from '../three/particle-lighting.js';
import {cadDisplayMesh} from '../three/cad-geometry.js';
import {cadSurfaceBounds,drawCADSurfaces} from '../three/cad-surface-render.js';
import {Renderer3} from '../three/renderer.js';
import {drawFEM} from '../fem/renderer.js';
import {rotate,add,norm,qmul,quaternion} from './model.js';
function mesh(shape,tubeRatio=.09){
  const out=[],tri=(a,b,c,na,nb=na,nc=na)=>out.push(...a,...na,...b,...nb,...c,...nc);
  if(shape==='box'){
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const n=[0,0,0];n[axis]=sign;const p=[];for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const q=[0,0,0];q[axis]=sign*.5;q[(axis+1)%3]=u*.5;q[(axis+2)%3]=v*.5;p.push(q);}tri(p[0],p[1],p[2],n);tri(p[0],p[2],p[3],n);}
  }else if(shape==='sphere'){
    const p=(a,b)=>[Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];
    for(let j=0;j<16;j++)for(let i=0;i<24;i++){const ns=[p(j*Math.PI/16,i*Math.PI/12),p((j+1)*Math.PI/16,i*Math.PI/12),p((j+1)*Math.PI/16,(i+1)*Math.PI/12),p(j*Math.PI/16,(i+1)*Math.PI/12)],ps=ns.map(n=>n.map(v=>v*.5));tri(ps[0],ps[1],ps[2],ns[0],ns[1],ns[2]);tri(ps[0],ps[2],ps[3],ns[0],ns[2],ns[3]);}
  }else if(shape==='torus'){
    const vertex=(u,v)=>[((1-tubeRatio)/2+tubeRatio/2*Math.cos(v))*Math.cos(u),((1-tubeRatio)/2+tubeRatio/2*Math.cos(v))*Math.sin(u),.5*Math.sin(v)],normal=(u,v)=>[Math.cos(v)*Math.cos(u),Math.cos(v)*Math.sin(u),tubeRatio*Math.sin(v)];
    for(let i=0;i<48;i++)for(let j=0;j<10;j++){const uv=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>[a*Math.PI/24,b*Math.PI/5]),p=uv.map(x=>vertex(...x)),n=uv.map(x=>normal(...x));tri(p[0],p[1],p[2],n[0],n[1],n[2]);tri(p[0],p[2],p[3],n[0],n[2],n[3]);}
  }else if(shape==='cone'){
    for(let i=0;i<32;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16,p=[Math.cos(a)*.5,-.5,Math.sin(a)*.5],q=[Math.cos(b)*.5,-.5,Math.sin(b)*.5];tri(p,q,[0,.5,0],[Math.cos(a),.5,Math.sin(a)],[Math.cos(b),.5,Math.sin(b)],[Math.cos((a+b)/2),.5,Math.sin((a+b)/2)]);tri([0,-.5,0],q,p,[0,-1,0]);}
  }else{
    for(let i=0;i<32;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16,na=[Math.cos(a),0,Math.sin(a)],nb=[Math.cos(b),0,Math.sin(b)],p=[na.map((v,k)=>k===1?-.5:v*.5),nb.map((v,k)=>k===1?-.5:v*.5),nb.map((v,k)=>k===1?.5:v*.5),na.map((v,k)=>k===1?.5:v*.5)];tri(p[0],p[1],p[2],na,nb,nb);tri(p[0],p[2],p[3],na,nb,na);tri([0,-.5,0],p[1],p[0],[0,-1,0]);tri([0,.5,0],p[3],p[2],[0,1,0]);}
  }return new Float32Array(out);
}
export class MultibodyRenderer extends Renderer3{
  camera(program){super.camera(program);const near=Math.min(.01,this.distance*.01),far=500;this.gl.uniform4f(this.gl.getUniformLocation(program,'proj'),1/Math.tan(Math.PI/8),this.width/this.height,-(far+near)/(far-near),-2*far*near/(far-near));}
  constructor(canvas){
    super(canvas);this.meshes=new Map();this.cadSurfaces=[];const gl=this.gl,p=gl.createProgram();
    const sources=[`#version 300 es
    precision highp float;layout(location=0)in vec3 vertex;layout(location=1)in vec3 normal;uniform vec3 eye,right,up,forward,center,scale;uniform vec4 orientation,proj;out vec3 n;
    vec3 rot(vec3 p){return p+2.*cross(orientation.xyz,cross(orientation.xyz,p)+orientation.w*p);}
    void main(){vec3 world=center+rot(vertex*scale),d=world-eye;vec3 v=vec3(dot(d,right),dot(d,up),-dot(d,forward));gl_Position=vec4(v.x*proj.x/proj.y,v.y*proj.x,proj.z*v.z+proj.w,-v.z);n=rot(normal/scale);}`,
    `#version 300 es
    precision highp float;in vec3 n;uniform vec3 tint;uniform float thermalColors;out vec4 color;void main(){float l=thermalColors>.5?1.:.42+.58*max(0.,dot(normalize(n),normalize(vec3(-.4,1.,.65))));color=vec4(tint*l,1.);}`];
    sources.forEach((source,i)=>{const s=gl.createShader(i===0?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);});gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.meshProgram=p;this.distance=19;this.pitch=.23;this.yaw=.32;this.target=[0,2.6,0];this.setDomain({lower:[-6,0,-4],upper:[6,7,4],cellSize:1});this.showBounds=false;
  }
  fit(frame){
    const candidates=frame.bodies.filter(b=>b.type==='dynamic'||b.id.startsWith('pool-')),visible=candidates.length?candidates:frame.bodies;
    const points=visible.flatMap(b=>(b.appearance?.length?b.appearance:[{position:[0,0,0],rotation:[0,0,0],size:b.size}]).flatMap(s=>{
      const center=add(b.position,rotate(b.rotation,s.position)),rotation=qmul(b.rotation,quaternion(s.rotation));
      return [-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>add(center,rotate(rotation,s.size.map((v,a)=>v*.5*[x,y,z][a]))))));
    }));
    if(frame.particles)for(let i=0;i<frame.particles.length;i+=8)points.push(Array.from(frame.particles.slice(i,i+3)));
    for(const curve of this.cadCurves??[])points.push(...curve.data.points);
    for(const surface of (this.cadSurfaces??[]).slice(0,16)){
      const bounds=cadSurfaceBounds(surface.data,{controlNet:surface.controlNet===true});points.push(bounds.lower,bounds.upper);
    }
    if(frame.fem)for(const p of frame.fem.parts)for(let i=0;i<p.nodes.length;i++)points.push(p.nodes[i].map((x,k)=>x+(this.femSettings?.scale??5)*p.displacement[i*3+k]));
    if(!points.length)return;
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    this.target=lo.map((v,a)=>(v+hi[a])/2);this.distance=Math.max(frame.fem?.parts.length?.005:1,Math.max(...hi.map((x,a)=>x-lo[a]))*1.8/Math.min(1,this.width/this.height));
  }
  drawParticles(frame){
    if(!frame.particles?.length)return;const gl=this.gl;
    if(!this.coupledPoints){
      const p=gl.createProgram(),sources=[`#version 300 es
      precision highp float;layout(location=0)in vec3 vertex;layout(location=1)in float temperature;layout(location=2)in float material;out float kind;uniform vec3 eye,right,up,forward;uniform vec4 proj;uniform float height,radius,sharedTemperature;uniform vec2 temperatureRange;out float heat;out float viewZ;
      void main(){vec3 d=vertex-eye;vec3 v=vec3(dot(d,right),dot(d,up),-dot(d,forward));gl_Position=vec4(v.x*proj.x/proj.y,v.y*proj.x,proj.z*v.z+proj.w,-v.z);gl_PointSize=clamp(radius*height*proj.x/max(.01,-v.z),1.,120.);viewZ=v.z;kind=material;heat=clamp(sharedTemperature>.5?(temperature-temperatureRange.x)/max(1e-30,temperatureRange.y):(temperature-20.)/100.,0.,1.);}`,
      `#version 300 es
      precision highp float;in float heat;in float viewZ;in float kind;uniform float materialColors,sharedTemperature;uniform vec4 proj;uniform float radius;out vec4 color;${temperaturePaletteGLSL}${particleLightingGLSL}
      void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;vec3 n=vec3(p.x,-p.y,sqrt(1.-r));vec3 c=sharedTemperature>.5?temperaturePalette(heat):mix(vec3(.12,.42,.92),vec3(1.,.22,.06),heat);if(materialColors>.5){c=kind<3.?vec3(.12,.55,.85):kind>24.5?vec3(.92,.66,.26):kind>23.5?vec3(.81,.36,.16):vec3(.56,.40,.76);}color=vec4(shadeParticle(c,n),1.);float z=viewZ+radius*n.z;gl_FragDepth=(proj.z*z+proj.w)/(-z)*.5+.5;}`];
      sources.forEach((text,i)=>{const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(p,shader);});gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.coupledPoints=p;this.coupledVAO=gl.createVertexArray();this.coupledBuffer=gl.createBuffer();gl.bindVertexArray(this.coupledVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.coupledBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,1,gl.FLOAT,false,32,16);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,32,12);
    }
    const shared=!!frame.fem&&this.femSettings?.field==='temperature',range=shared?temperatureScale(frame,this.femSettings):{min:20,max:120};
    this.camera(this.coupledPoints);gl.uniform1i(gl.getUniformLocation(this.coupledPoints,'particleShading'),this.particleShading);gl.uniform1f(gl.getUniformLocation(this.coupledPoints,'sharedTemperature'),shared?1:0);gl.uniform2f(gl.getUniformLocation(this.coupledPoints,'temperatureRange'),range.min,range.max-range.min);gl.uniform1f(gl.getUniformLocation(this.coupledPoints,'materialColors'),!shared&&frame.particleColorMode==='material'?1:0);gl.uniform1f(gl.getUniformLocation(this.coupledPoints,'height'),this.canvas.height);gl.uniform1f(gl.getUniformLocation(this.coupledPoints,'radius'),frame.particleRadius);gl.bindVertexArray(this.coupledVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.coupledBuffer);gl.bufferData(gl.ARRAY_BUFFER,frame.particles,gl.DYNAMIC_DRAW);gl.drawArrays(gl.POINTS,0,frame.particles.length/8);
  }
  drawFrame(frame,selected,trace=[]){
    const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.enable(gl.DEPTH_TEST);gl.clearColor(...(this.background||[.91,.94,.94]),1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);this.drawLines(this.floor,this.lightBackground?[.65,.68,.67]:[.13,.21,.24]);
    for(const [key,m] of this.meshes)if(typeof key==='object'&&!frame.bodies.some(b=>b.cad===key)){gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.buffer);this.meshes.delete(key);}
    this.camera(this.meshProgram);const colors=[[.20,.58,.60],[.88,.57,.23],[.54,.47,.77],[.37,.62,.41]];
    const shared=!!frame.fem&&this.femSettings?.field==='temperature',range=frame.fem?temperatureScale(frame,this.femSettings):null;
    frame?.bodies.forEach((b,i)=>{
      const heat=Math.max(0,Math.min(1,((b.temperature??20)-20)/100)),thermal=[.12+.88*heat,.42-.20*heat,.92-.86*heat];
      const shapes=!this.collisionOnly&&b.appearance?b.appearance:[{shape:b.shape==='disc'?'cylinder':b.shape,cad:b.cad,position:[0,0,0],rotation:b.shape==='disc'?[90,0,0]:[0,0,0],size:b.shape==='disc'?[b.size[0],b.size[2],b.size[1]]:b.size}];
      for(const shape of shapes){
        const meshKey=shape.shape==='cad'?shape.cad:shape.shape==='torus'?shape.shape+':'+shape.size[2]/shape.size[0]:shape.shape;let m=this.meshes.get(meshKey);if(!m){const data=shape.shape==='cad'?cadDisplayMesh(shape.cad):mesh(shape.shape,shape.size[2]/shape.size[0]),vao=gl.createVertexArray(),buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);m={vao,buffer,count:data.length/6};this.meshes.set(meshKey,m);}
        const bodyThermal=shared&&Number.isFinite(b.temperature);gl.uniform1f(gl.getUniformLocation(this.meshProgram,'thermalColors'),bodyThermal?1:0);
        const tint=bodyThermal?temperatureColor(b.temperature,range):shape.color?[1,3,5].map(k=>parseInt(shape.color.slice(k,k+2),16)/255):frame.coupling?thermal:b.id===selected?[.95,.68,.30]:b.type==='fixed'?[.50,.56,.58]:colors[i%colors.length];
        for(const [key,value] of [['center',add(b.position,rotate(b.rotation,shape.position))],['scale',shape.size],['tint',tint]])gl.uniform3fv(gl.getUniformLocation(this.meshProgram,key),value);
        gl.uniform4fv(gl.getUniformLocation(this.meshProgram,'orientation'),qmul(b.rotation,quaternion(shape.rotation)));gl.bindVertexArray(m.vao);gl.drawArrays(gl.TRIANGLES,0,m.count);
      }
    });
    this.drawParticles(frame);
    drawFEM(this,frame);
    drawCADSurfaces(this);
    for(const curve of this.cadCurves??[])this.drawLines(curve.data.points.slice(1).flatMap((p,i)=>[...curve.data.points[i],...p]),[.86,.43,.1]);
    if(trace.length>1)this.drawLines(trace.slice(1).flatMap((p,i)=>[...trace[i],...p]),[.91,.45,.16]);
    for(const j of frame?.joints??[]){
      if(j.type==='gear'||this.hideJoints)continue;
      if(j.type==='region'){this.drawLines([...j.a,...j.b],[.88,.55,.08]);}
      else if(j.type==='spring'){const d=j.b.map((x,k)=>x-j.a[k]),len=norm(d),axis=d.map(x=>x/(len||1)),helper=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],u=cross(axis,helper),un=norm(u);for(let k=0;k<3;k++)u[k]/=un||1;const v=cross(axis,u),points=[];for(let k=0;k<=80;k++){const t=k/80,w=Math.sin(Math.PI*t)*.10;points.push(j.a.map((x,a)=>x+d[a]*t+w*(Math.cos(t*16*Math.PI)*u[a]+Math.sin(t*16*Math.PI)*v[a])));}this.drawLines(points.slice(1).flatMap((p,i)=>[...points[i],...p]),[.74,.39,.16]);}
      else{const lines=[];for(let a=0;a<3;a++){const p=j.a.slice(),q=j.a.slice();p[a]-=.12;q[a]+=.12;lines.push(...p,...q);}this.drawLines(lines,[.86,.30,.23]);}
    }
    // Reference graphics are inspection overlays; they do not change colliders.
    gl.disable(gl.DEPTH_TEST);
    for(const f of this.referenceAxes??[]){
      const length=Math.max(.12,Math.min(.8,this.distance*.025));
      [[.9,.18,.16],[.12,.65,.3],[.2,.4,1]].forEach((color,k)=>{
        const axis=[0,0,0];axis[k]=length;
        this.drawLines([...f.position,...add(f.position,rotate(f.orientation,axis))],color);
      });
    }
    if(this.referenceSelection){
      const {set,part,indices}=this.referenceSelection,b=frame.bodies.find(b=>b.id===part.id);
      const lower=set.region.type==='box'?set.region.lower:part.geometry.size.map(x=>-x/2),upper=set.region.type==='box'?set.region.upper:part.geometry.size.map(x=>x/2);
      const world=p=>add(b?.position??part.geometry.center,rotate(b?.rotation??quaternion(part.geometry.rotation),p)),lines=[];
      for(let mask=0;mask<8;mask++)for(let k=0;k<3;k++)if(!(mask&(1<<k))){
        const p=[0,1,2].map(a=>mask&(1<<a)?upper[a]:lower[a]),q=p.slice();q[k]=upper[k];lines.push(...world(p),...world(q));
      }
      this.drawLines(lines,[.88,.55,.08]);
      if(frame.particles){const crosses=[],stride=Math.max(1,Math.ceil(indices.length/600)),r=Math.min(.025,frame.particleRadius*.55);
        for(let n=0;n<indices.length;n+=stride){const i=indices[n]*8,p=Array.from(frame.particles.subarray(i,i+3));for(let k=0;k<3;k++){const a=p.slice(),b=p.slice();a[k]-=r;b[k]+=r;crosses.push(...a,...b);}}
        if(crosses.length)this.drawLines(crosses,[1,.7,.08]);
      }
    }
    gl.enable(gl.DEPTH_TEST);
  }
}
