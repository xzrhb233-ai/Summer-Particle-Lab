// Open CAD reference surfaces have their own renderer. They are never converted
// into closed solids and carry no body mass, collision shape or invented volume.
const states=new WeakMap();
const MAX_SURFACES=16,MAX_NODES=4225,MAX_TRIANGLES=8192;
const finite3=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function cadSurfaceBounds(data,{controlNet=false}={}){
  const lower=[Infinity,Infinity,Infinity],upper=[-Infinity,-Infinity,-Infinity];
  const include=p=>{for(let k=0;k<3;k++){lower[k]=Math.min(lower[k],p[k]);upper[k]=Math.max(upper[k],p[k]);}};
  for(const p of data.nodes)include(p);
  if(controlNet)for(const row of data.spec.controlPoints)for(const p of row)include(p);
  return {lower,upper};
}

// Generated only when a validated surface.data object changes. Surface meshes
// use shared vertices, smooth normals, indexed triangles and cached line ranges.
export function cadSurfaceRenderData(data){
  if(data?.schema!=='summer-cad-surface/1'||!Array.isArray(data.nodes)||data.nodes.length<3||data.nodes.length>MAX_NODES||!data.nodes.every(finite3)||!Array.isArray(data.elements)||!data.elements.length||data.elements.length>MAX_TRIANGLES)throw Error('CAD 曲面显示数据无效');
  const nodes=data.nodes,normal=new Float64Array(nodes.length*3),indices=new Uint16Array(data.elements.length*3),edges=new Map();
  let ti=0;
  for(const triangle of data.elements){
    if(!Array.isArray(triangle)||triangle.length!==3||!triangle.every(i=>Number.isInteger(i)&&i>=0&&i<nodes.length))throw Error('CAD 曲面三角形索引无效');
    const [a,b,c]=triangle,pa=nodes[a],pb=nodes[b],pc=nodes[c];
    const ux=pb[0]-pa[0],uy=pb[1]-pa[1],uz=pb[2]-pa[2],vx=pc[0]-pa[0],vy=pc[1]-pa[1],vz=pc[2]-pa[2];
    const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    for(const i of triangle){indices[ti++]=i;for(let k=0;k<3;k++)normal[i*3+k]+=n[k];}
    for(const [i,j] of [[a,b],[b,c],[c,a]]){const low=Math.min(i,j),high=Math.max(i,j),key=low*MAX_NODES+high,old=edges.get(key);if(old)old.count++;else edges.set(key,{a:low,b:high,count:1});}
  }
  const vertices=new Float32Array(nodes.length*6),native=Array.isArray(data.normals)&&data.normals.length===nodes.length&&data.normals.every(finite3)?data.normals:null;
  for(let i=0;i<nodes.length;i++){
    let x=native?.[i][0]??normal[i*3],y=native?.[i][1]??normal[i*3+1],z=native?.[i][2]??normal[i*3+2],length=Math.hypot(x,y,z);
    if(length<1e-30){x=normal[i*3];y=normal[i*3+1];z=normal[i*3+2];length=Math.hypot(x,y,z);}
    if(length<1e-30){x=0;y=1;z=0;length=1;}
    vertices.set(nodes[i],i*6);vertices[i*6+3]=x/length;vertices[i*6+4]=y/length;vertices[i*6+5]=z/length;
  }
  const linePoints=[],append=(a,b)=>linePoints.push(...a,...b);
  const wire={first:0,count:0};for(const edge of edges.values())append(nodes[edge.a],nodes[edge.b]);wire.count=linePoints.length/3;
  const boundary={first:linePoints.length/3,count:0};for(const edge of edges.values())if(edge.count===1)append(nodes[edge.a],nodes[edge.b]);boundary.count=linePoints.length/3-boundary.first;
  const control={first:linePoints.length/3,count:0},net=data.spec?.controlPoints;
  if(!Array.isArray(net)||net.length<2||net.length>8||!net.every(row=>Array.isArray(row)&&row.length===net[0].length&&row.length>=2&&row.length<=8&&row.every(finite3)))throw Error('CAD 曲面控制网无效');
  for(let u=0;u<net.length;u++)for(let v=0;v<net[u].length;v++){
    if(u+1<net.length)append(net[u][v],net[u+1][v]);
    if(v+1<net[u].length)append(net[u][v],net[u][v+1]);
  }
  control.count=linePoints.length/3-control.first;
  return {vertices,indices,lineVertices:new Float32Array(linePoints),wire,boundary,control};
}

function program(gl){
  const p=gl.createProgram(),shaders=[];
  const sources=[`#version 300 es
precision highp float;
layout(location=0)in vec3 position;layout(location=1)in vec3 normal;
uniform vec3 eye,right,up,forward;uniform vec4 proj;out vec3 n;
void main(){vec3 d=position-eye;vec3 v=vec3(dot(d,right),dot(d,up),-dot(d,forward));gl_Position=vec4(v.x*proj.x/proj.y,v.y*proj.x,proj.z*v.z+proj.w,-v.z);n=normal;}`,
  `#version 300 es
precision highp float;in vec3 n;uniform vec3 tint;out vec4 color;
void main(){vec3 normal=normalize(n)*(gl_FrontFacing?1.:-1.);float light=.24+.62*max(0.,dot(normal,normalize(vec3(-.4,1.,.65))))+.14*max(0.,dot(normal,normalize(vec3(.65,-.35,-.55))));color=vec4(tint*light,1.);}`];
  try{
    sources.forEach((source,i)=>{const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(p,shader);});
    gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
  }catch(error){gl.deleteProgram(p);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
}

function upload(gl,data){
  const mesh=cadSurfaceRenderData(data),vao=gl.createVertexArray(),vertexBuffer=gl.createBuffer(),indexBuffer=gl.createBuffer(),lineVAO=gl.createVertexArray(),lineBuffer=gl.createBuffer();
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
  gl.bindVertexArray(lineVAO);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.lineVertices,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
  return {vao,vertexBuffer,indexBuffer,lineVAO,lineBuffer,count:mesh.indices.length,wire:mesh.wire,boundary:mesh.boundary,control:mesh.control,seen:0};
}
function remove(gl,mesh){gl.deleteVertexArray(mesh.vao);gl.deleteVertexArray(mesh.lineVAO);gl.deleteBuffer(mesh.vertexBuffer);gl.deleteBuffer(mesh.indexBuffer);gl.deleteBuffer(mesh.lineBuffer);}

export function drawCADSurfaces(renderer){
  const surfaces=renderer.cadSurfaces??[],gl=renderer.gl;
  let state=states.get(renderer);
  if(!state){if(!surfaces.length)return;state={program:program(gl),meshes:new Map(),revision:0};states.set(renderer,state);}
  const count=Math.min(MAX_SURFACES,surfaces.length),revision=++state.revision;
  // Prune before uploading replacements: editing cannot temporarily double the
  // maximum allocation, and deleting all references releases their buffers.
  for(let i=0;i<count;i++){const cached=state.meshes.get(surfaces[i].data);if(cached)cached.seen=revision;}
  for(const [data,mesh] of state.meshes)if(mesh.seen!==revision){remove(gl,mesh);state.meshes.delete(data);}
  if(!count)return;
  const cull=gl.isEnabled(gl.CULL_FACE),offset=gl.isEnabled(gl.POLYGON_OFFSET_FILL),offsetFactor=gl.getParameter(gl.POLYGON_OFFSET_FACTOR),offsetUnits=gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  gl.disable(gl.CULL_FACE);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);renderer.camera(state.program);
  gl.uniform3f(gl.getUniformLocation(state.program,'tint'),.27,.72,.76);
  for(let i=0;i<count;i++){
    const data=surfaces[i].data;let cached=state.meshes.get(data);
    if(!cached){cached=upload(gl,data);cached.seen=revision;state.meshes.set(data,cached);}
    gl.bindVertexArray(cached.vao);gl.drawElements(gl.TRIANGLES,cached.count,gl.UNSIGNED_SHORT,0);
  }
  gl.polygonOffset(offsetFactor,offsetUnits);if(!offset)gl.disable(gl.POLYGON_OFFSET_FILL);if(cull)gl.enable(gl.CULL_FACE);
  renderer.camera(renderer.lines);const tint=gl.getUniformLocation(renderer.lines,'tint');
  for(let i=0;i<count;i++){
    const entry=surfaces[i],cached=state.meshes.get(entry.data);gl.bindVertexArray(cached.lineVAO);
    if(entry.wireframe!==false){gl.uniform3f(tint,.16,.40,.43);gl.drawArrays(gl.LINES,cached.wire.first,cached.wire.count);}
    gl.uniform3f(tint,.055,.22,.25);gl.drawArrays(gl.LINES,cached.boundary.first,cached.boundary.count);
    if(entry.controlNet===true){gl.uniform3f(tint,.93,.43,.075);gl.drawArrays(gl.LINES,cached.control.first,cached.control.count);}
  }
}

export function clearCADSurfaceBuffers(renderer){
  const state=states.get(renderer);if(!state)return;
  for(const mesh of state.meshes.values())remove(renderer.gl,mesh);state.meshes.clear();
}

export function disposeCADSurfaceRenderer(renderer){
  const state=states.get(renderer);if(!state)return;
  clearCADSurfaceBuffers(renderer);renderer.gl.deleteProgram(state.program);states.delete(renderer);
}
