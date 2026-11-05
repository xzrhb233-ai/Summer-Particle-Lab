import test from 'node:test';
import assert from 'node:assert/strict';
import {cadSurfaceBounds,cadSurfaceRenderData,drawCADSurfaces,disposeCADSurfaceRenderer} from '../src/three/cad-surface-render.js';
import {MultibodyRenderer} from '../src/multibody/renderer.js';

const surface=()=>({schema:'summer-cad-surface/1',nodes:[[0,0,0],[0,0,1],[1,0,0],[1,0,1]],elements:[[0,1,2],[1,3,2]],normals:[[0,1,0],[0,1,0],[0,1,0],[0,1,0]],spec:{controlPoints:[[[0,0,0],[0,0,1]],[[1,.4,0],[1,0,1]]]}});

test('surface triangles share smooth vertices; wireframe, boundary and controls remain distinct',()=>{
  const s=surface(),data=cadSurfaceRenderData(s);
  assert.equal(data.vertices.length,4*6);assert.equal(data.indices.length,6);
  assert.equal(data.wire.count,10);assert.equal(data.boundary.count,8);assert.equal(data.control.count,8);
  assert.ok(data.vertices.every(Number.isFinite));assert.deepEqual(Array.from(data.vertices.slice(3,6)),[0,1,0]);
  assert.deepEqual(cadSurfaceBounds(s),{lower:[0,0,0],upper:[1,0,1]});
  assert.deepEqual(cadSurfaceBounds(s,{controlNet:true}),{lower:[0,0,0],upper:[1,.4,1]});
  delete s.normals;assert.deepEqual(Array.from(cadSurfaceRenderData(s).vertices.slice(3,6)),[0,1,0]);
  const fit={cadSurfaces:[{data:s,controlNet:true}],width:800,height:600};MultibodyRenderer.prototype.fit.call(fit,{bodies:[],joints:[]});
  assert.deepEqual(fit.target,[.5,.2,.5]);assert.ok(Number.isFinite(fit.distance)&&fit.distance>0);
});

test('64 × 64 subdivision surface fits Uint16 indices and finite bounded buffers',()=>{
  const s=surface();s.nodes=[];s.elements=[];delete s.normals;
  for(let u=0;u<=64;u++)for(let v=0;v<=64;v++)s.nodes.push([u/64,Math.sin(u/64*Math.PI)*Math.sin(v/64*Math.PI)*.2,v/64]);
  for(let u=0;u<64;u++)for(let v=0;v<64;v++){const a=u*65+v,b=a+1,c=a+65,d=c+1;s.elements.push([a,b,c],[b,d,c]);}
  const data=cadSurfaceRenderData(s);assert.equal(s.nodes.length,4225);assert.equal(s.elements.length,8192);assert.equal(data.indices.length,24576);
  assert.equal(Math.max(...data.indices),4224);assert.equal(data.boundary.count,512);assert.ok(data.vertices.every(Number.isFinite));
  assert.ok(data.vertices.byteLength+data.indices.byteLength+data.lineVertices.byteLength<500000);
});

function fakeGL(){
  const counts={buffers:0,maxBuffers:0,vaos:0,programs:0,uploads:0,draws:0},flags=new Set(),parameters=new Map();
  const gl={counts};for(const key of ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','FLOAT','CULL_FACE','POLYGON_OFFSET_FILL','POLYGON_OFFSET_FACTOR','POLYGON_OFFSET_UNITS','TRIANGLES','UNSIGNED_SHORT','LINES'])gl[key]=key;
  Object.assign(gl,{
    createProgram(){counts.programs++;return {};},deleteProgram(){counts.programs--;},createShader(){return {};},deleteShader(){},shaderSource(){},compileShader(){},getShaderParameter(){return true;},attachShader(){},linkProgram(){},getProgramParameter(){return true;},
    createBuffer(){counts.buffers++;counts.maxBuffers=Math.max(counts.maxBuffers,counts.buffers);return {};},deleteBuffer(){counts.buffers--;},
    createVertexArray(){counts.vaos++;return {};},deleteVertexArray(){counts.vaos--;},bindVertexArray(){},bindBuffer(){},bufferData(){counts.uploads++;},enableVertexAttribArray(){},vertexAttribPointer(){},
    isEnabled:key=>flags.has(key),enable:key=>flags.add(key),disable:key=>flags.delete(key),getParameter:key=>parameters.get(key)??0,
    polygonOffset(f,u){parameters.set(gl.POLYGON_OFFSET_FACTOR,f);parameters.set(gl.POLYGON_OFFSET_UNITS,u);},getUniformLocation:(_,key)=>key,uniform3f(){},
    drawElements(){counts.draws++;},drawArrays(){counts.draws++;}
  });return gl;
}

test('surface rendering reuses buffers across frames and prunes replacements without exceeding 16 meshes',()=>{
  const gl=fakeGL(),renderer={gl,lines:{},camera(){},cadSurfaces:Array.from({length:16},(_,i)=>({id:String(i),data:surface(),controlNet:true}))};
  gl.enable(gl.CULL_FACE);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(7,3);
  drawCADSurfaces(renderer);assert.equal(gl.counts.buffers,48);assert.equal(gl.counts.vaos,32);assert.equal(gl.counts.uploads,48);
  for(let i=0;i<100;i++)drawCADSurfaces(renderer);
  assert.equal(gl.counts.buffers,48);assert.equal(gl.counts.uploads,48);assert.equal(gl.counts.programs,1);
  renderer.cadSurfaces[0]={id:'changed',data:surface()};drawCADSurfaces(renderer);assert.equal(gl.counts.buffers,48);assert.equal(gl.counts.maxBuffers,48);assert.equal(gl.counts.uploads,51);
  assert.equal(gl.isEnabled(gl.CULL_FACE),true);assert.equal(gl.isEnabled(gl.POLYGON_OFFSET_FILL),true);assert.equal(gl.getParameter(gl.POLYGON_OFFSET_FACTOR),7);assert.equal(gl.getParameter(gl.POLYGON_OFFSET_UNITS),3);
  renderer.cadSurfaces=[];drawCADSurfaces(renderer);assert.equal(gl.counts.buffers,0);assert.equal(gl.counts.vaos,0);
  disposeCADSurfaceRenderer(renderer);assert.equal(gl.counts.programs,0);
});
