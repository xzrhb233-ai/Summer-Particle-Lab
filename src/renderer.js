const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec4 aParticle;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform vec2 uCamera;
uniform float uScale;
uniform float uDpr;
out float vMaterial;
out float vTemperature;
out float vNoise;
void main(){
  float seed=float(gl_InstanceID)*4.+float(gl_VertexID);
  vec2 offset=vec2(float(gl_VertexID&1)-.5,float((gl_VertexID>>1)&1)-.5)*1.65;
  float angle=fract(sin(float(gl_InstanceID)*73.13)*13758.5453)*6.283;
  offset=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*offset;
  vec2 pixel=(aParticle.xy+offset-uCamera)*uScale+uCenter;
  gl_Position=vec4(pixel/uResolution*2.0-1.0,0.,1.);
  float radius=aParticle.z==3.0?3.5:1.16;
  gl_PointSize=clamp(radius*2.0*uScale*uDpr,1.,100.);
  vMaterial=aParticle.z;
  vTemperature=aParticle.w;
  vNoise=fract(sin(seed*127.13)*43758.5453);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in float vMaterial;
in float vTemperature;
in float vNoise;
uniform bool uEmission;
uniform bool uHeatmap;
uniform float uHeatMax;
out vec4 fragColor;
void main(){
  vec2 p=gl_PointCoord*2.-1.;
  float r=dot(p,p);
  if(r>1.)discard;
  vec3 color;
  float alpha=1.-smoothstep(.5,1.,r);
  float sphere=sqrt(max(0.,1.-r));
  float light=.60+.31*sphere+.11*dot(p,vec2(-.6,-.8));
  float noise=.68+.48*vNoise;
  float emission=0.;
  int m=int(vMaterial+.1);
  if(m==0){color=vec3(.21,.28,.26)*noise;}
  else if(m==1){
    float heat=clamp((vTemperature-600.)/850.,0.,1.);
    color=mix(vec3(.35,.08,.025),vec3(1.,.43,.085),heat);
    color=mix(color,vec3(1.,.67,.21),smoothstep(.7,1.,vNoise)*heat*.8);
    color*=noise;light=1.;emission=heat*.75;
  }
  else if(m==2){color=mix(vec3(.08,.28,.36),vec3(.32,.63,.69),vNoise*.6);alpha*=.92;}
  else if(m==3){color=vec3(.57,.73,.77);alpha=pow(max(0.,1.-r),2.)*(.015+.025*vNoise);light=1.;}
  else if(m==4){color=vec3(.62,.84,.86)*noise;}
  else if(m==5||m==7){color=vec3(.48,.60,.62)*noise;light+=pow(sphere,10.)*.16;}
  else if(m==8){color=vec3(.83,.46,.40)*noise;}
  else if(m==9){color=vec3(.84,.72,.45)*noise;}
  else if(m==10){color=vec3(1.,.5,.08)*noise;emission=.9;}
  else if(m==11){color=vec3(.65,.48,.92)*noise;light+=.12*sphere;}
  else{color=vec3(.65,.51,.30)*noise;}
  if(m!=1&&m!=3&&vTemperature>650.){
    float hot=clamp((vTemperature-650.)/1250.,0.,1.);
    color=mix(color,vec3(1.,.30,.035),hot);emission=hot*.4;
  }
  if(uHeatmap){color=mix(vec3(.1,.4,.95),vec3(1.,.22,.06),clamp(vTemperature/uHeatMax,0.,1.));alpha=max(alpha,.6);light=1.;}
  if(uEmission)fragColor=vec4(color*emission,alpha);
  else fragColor=vec4(color*light,alpha);
}`;
const screenVertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
 vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
 vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);
}`;
const blurFragment = `#version 300 es
precision highp float;
in vec2 vUv;uniform sampler2D uImage;uniform vec2 uDirection;out vec4 fragColor;
void main(){
 vec3 c=texture(uImage,vUv).rgb*.227027;
 c+=texture(uImage,vUv+uDirection*1.384615).rgb*.316216;
 c+=texture(uImage,vUv-uDirection*1.384615).rgb*.316216;
 c+=texture(uImage,vUv+uDirection*3.230769).rgb*.070270;
 c+=texture(uImage,vUv-uDirection*3.230769).rgb*.070270;
 fragColor=vec4(c,1.);
}`;
const compositeFragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;uniform sampler2D uGlow;
uniform vec2 uResolution;uniform float uGlowStrength;uniform vec2 uPlanet;
out vec4 fragColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 pixel=vUv*uResolution;
 float halo=exp(-length((vUv-uPlanet)*vec2(uResolution.x/uResolution.y,1.))*5.);
 vec3 bg=vec3(.025,.040,.052)+vec3(.015,.031,.034)*halo;
 vec2 cell=floor(pixel/43.);
 vec2 star=fract(pixel/43.)-vec2(hash(cell),hash(cell+4.));
 float twinkle=hash(cell+18.);
 float s=(1.-smoothstep(.002,.023,length(star)))*step(.78,twinkle);
 bg+=vec3(.11,.15,.16)*s;
 vec4 scene=texture(uScene,vUv);
 vec3 glow=texture(uGlow,vUv).rgb*uGlowStrength;
 vec3 color=scene.rgb+bg*(1.-scene.a)+glow;
 float vignette=1.-.20*length(vUv-.5);
 fragColor=vec4(color*vignette,1.);
}`;

function program(gl, vs, fs) {
  const shaders = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(([type, source]) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const p = gl.createProgram(); shaders.forEach(s => gl.attachShader(p, s)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  shaders.forEach(s => gl.deleteShader(s));
  return p;
}
function uniforms(gl, p, keys) { return Object.fromEntries(keys.map(k => [k, gl.getUniformLocation(p, k)])); }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('此浏览器未启用 WebGL2。请使用支持 WebGL2 的浏览器，并开启硬件加速。');
    this.points = program(gl, vertexSource, fragmentSource);
    this.blur = program(gl, screenVertex, blurFragment);
    this.composite = program(gl, screenVertex, compositeFragment);
    this.pu = uniforms(gl, this.points, ['uResolution', 'uCenter', 'uCamera', 'uScale', 'uDpr', 'uEmission','uHeatmap','uHeatMax']);
    this.bu = uniforms(gl, this.blur, ['uImage', 'uDirection']);
    this.cu = uniforms(gl, this.composite, ['uScene', 'uGlow', 'uResolution', 'uGlowStrength', 'uPlanet']);
    this.buffer = gl.createBuffer(); this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, 16000 * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    this.count = 0; this.targets = []; this.glow = true; this.scene = 'planet';
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.overlay=document.createElement('canvas');this.overlay.className='structure-overlay';this.overlay.setAttribute('aria-hidden','true');canvas.after(this.overlay);
    this.ctx=this.overlay.getContext('2d');this.heatmap=false;this.heatMax=1600;this.showSolidLinks=true;
    this.resize();
  }
  makeTarget(w, h) {
    const gl = this.gl, texture = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('无法创建绘图缓冲区，请降低浏览器窗口大小后重试。');
    return { texture, fbo, w, h };
  }
  resize() {
    const gl = this.gl;
    this.width = this.canvas.clientWidth; this.height = this.canvas.clientHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 1.75);
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr)); this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.overlay.width=this.canvas.width;this.overlay.height=this.canvas.height;
    this.center = { x: this.width <= 760 ? this.width / 2 : (this.width - 215) / 2 + 20, y: this.height * .53 };
    this.baseScale = this.width <= 760 ? Math.min(this.width / 380, (this.height - 190) / 370) : Math.min((this.height - 155) / 365, (this.width - 350) / 420);
    for (const target of this.targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.fbo); }
    const w = this.canvas.width, h = this.canvas.height, bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    this.targets = [this.makeTarget(w, h), this.makeTarget(bw, bh), this.makeTarget(bw, bh), this.makeTarget(bw, bh)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get scale() {
    const framing = this.scene === 'thermal' ? (this.width <= 760 ? 1.6 : 2.2) : this.scene === 'collision' ? (this.width <= 760 ? .6 : .8) : this.scene === 'binary' && this.width <= 760 ? .72 : 1;
    return this.baseScale * framing * this.camera.zoom;
  }
  screenToWorld(x, y) { return { x: (x - this.center.x) / this.scale + this.camera.x, y: (this.height - y - this.center.y) / this.scale + this.camera.y }; }
  zoomAt(factor, x = this.center.x, y = this.height - this.center.y) {
    const before = this.screenToWorld(x, y);
    this.camera.zoom = Math.max(.25, Math.min(7, this.camera.zoom * factor));
    const after = this.screenToWorld(x, y);
    this.camera.x += before.x - after.x; this.camera.y += before.y - after.y;
  }
  upload(buffer, count) {
    const gl = this.gl; this.count = count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(buffer, 0, count * 4));
    if(this.scene==='thermal'){
      this.thermalSamples={};const data=new Float32Array(buffer,0,count*4);
      for(let i=0;i<count;i++){
        const side=data[i*4]<0?'iron':'water',t=data[i*4+3];
        const range=this.thermalSamples[side] ||= [Infinity,-Infinity];range[0]=Math.min(range[0],t);range[1]=Math.max(range[1],t);
      }
    }
  }
  drawPoints(target, emission) {
    const gl = this.gl, u = this.pu;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (emission) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.points); gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uResolution, this.width, this.height);
    gl.uniform2f(u.uCenter, this.center.x, this.center.y);
    gl.uniform2f(u.uCamera, this.camera.x, this.camera.y);
    gl.uniform1f(u.uScale, this.scale); gl.uniform1f(u.uDpr, target.w / this.width);
    gl.uniform1i(u.uEmission, emission ? 1 : 0);
    gl.uniform1i(u.uHeatmap,this.heatmap?1:0);
    gl.uniform1f(u.uHeatMax,this.heatMax);
    gl.drawArraysInstanced(gl.POINTS, 0, 4, this.count);
    gl.bindVertexArray(null); gl.disable(gl.BLEND);
  }
  draw() {
    const gl = this.gl, [scene, glow, blurA, blurB] = this.targets;
    this.drawPoints(scene, false);
    if (this.glow) {
      this.drawPoints(glow, true);
      gl.useProgram(this.blur); gl.uniform1i(this.bu.uImage, 0); gl.activeTexture(gl.TEXTURE0);
      for (const [source, target, dx, dy] of [[glow, blurA, 1 / glow.w, 0], [blurA, blurB, 0, 1 / glow.h]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.w, target.h);
        gl.bindTexture(gl.TEXTURE_2D, source.texture); gl.uniform2f(this.bu.uDirection, dx, dy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.texture); gl.uniform1i(this.cu.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurB.texture); gl.uniform1i(this.cu.uGlow, 1);
    gl.uniform1f(this.cu.uGlowStrength, this.glow ? .8 : 0);
    gl.uniform2f(this.cu.uResolution, this.width, this.height);
    gl.uniform2f(this.cu.uPlanet, this.center.x / this.width, this.center.y / this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawStructures();
  }
  drawStructures(){
    const c=this.ctx,d=this.dpr;c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,this.width,this.height);
    const screen=(x,y)=>[(x-this.camera.x)*this.scale+this.center.x,this.height-this.center.y-(y-this.camera.y)*this.scale];
    const line=(x1,y1,x2,y2)=>{c.beginPath();c.moveTo(...screen(x1,y1));c.lineTo(...screen(x2,y2));c.stroke();};
    if(this.structure){
      const {lines,anchors}=this.structure;
      c.lineCap='round';
      // Batch natural solid bonds so a cold planet is visibly connected without
      // thousands of separate canvas strokes. Temperature remains on particles.
      if(this.showSolidLinks){
        c.lineWidth=Math.max(.6,this.scale*.6);c.globalAlpha=.35;
        for(const [mat,color] of [[0,'#87998e'],[4,'#bde5ed'],[5,'#b0bbc2']]){
          c.strokeStyle=color;c.beginPath();
          for(let i=0;i<lines.length;i+=6)if(lines[i+4]===mat){c.moveTo(...screen(lines[i],lines[i+1]));c.lineTo(...screen(lines[i+2],lines[i+3]));}
          c.stroke();
        }
      }
      c.globalAlpha=1;c.lineWidth=Math.max(1.5,this.scale*1.7);
      for(let i=0;i<lines.length;i+=6)if(lines[i+4]>=7){
        c.strokeStyle=lines[i+5]>.12?'#ee795e':lines[i+4]===8?'#d38c81':lines[i+4]===9?'#d6bd83':'#9fb9bf';
        line(lines[i],lines[i+1],lines[i+2],lines[i+3]);
      }
      c.strokeStyle='#d9f5e8';c.lineWidth=1;
      for(let i=0;i<anchors.length;i+=2){const [x,y]=screen(anchors[i],anchors[i+1]);c.strokeRect(x-3,y-3,6,6);}
    }
    if(this.preview){
      const p=this.preview;c.strokeStyle='#b9e7d7';c.lineWidth=1.5;c.setLineDash([5,4]);
      if(p.shape==='panel'){const a=screen(p.x1,p.y1),b=screen(p.x2,p.y2);c.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
      else line(p.x1,p.y1,p.x2,p.y2);
      c.setLineDash([]);
    }
    if(this.heatmap){c.fillStyle='#c5d6dc';c.font='11px sans-serif';c.textAlign='center';c.fillText(`温度色阶：蓝 0°C → 红 ${this.heatMax}°C（超出范围饱和）`,this.center.x,this.height-88);}
    if(this.scene==='softbody'){
      const a=screen(-170,145),b=screen(170,-145);
      c.strokeStyle='#6d939f88';c.lineWidth=1;c.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);
    }
    if(this.scene==='thermal' && this.thermalSamples){
      c.fillStyle='#c5d6dc';c.font='12px sans-serif';c.textAlign='center';
      for(const [key,x,label] of [['iron',-65,'铁'],['water',65,'水']]){
        const r=this.thermalSamples[key];if(r)c.fillText(`${label}  ${r[0].toFixed(1)}–${r[1].toFixed(1)} °C`,...screen(x,-29));
      }
    }
  }
}
