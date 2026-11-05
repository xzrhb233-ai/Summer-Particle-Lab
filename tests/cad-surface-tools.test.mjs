import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {validateSurfaceSpec,validateSurface,normalizeCADSurfaces,surfaceToOBJ,surfaceToVTK,createSurfaceTemplate} from '../src/three/cad-surfaces.js';
import {buildSurface} from '../src/simulation/cad-client.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {normalizeProject,normalizeSolverProject,editLegacyProject,removePart,toLegacy} from '../src/simulation/project.js';
import {parseProjectText} from '../src/simulation/project-io.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const spec={kind:'bilinear',controlPoints:[[[0,0,0],[0,0,1]],[[1,0,0],[1,0,1]]],segmentsU:4,segmentsV:4};
function fixture(){
  const nodes=[],elements=[];
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++)nodes.push([i/4,0,j/4]);
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){const a=i*5+j;elements.push([a,a+5,a+6],[a,a+6,a+1]);}
  return {schema:'summer-cad-surface/1',kernel:'SMLib',version:'test-fixture',spec:structuredClone(spec),degreeU:1,degreeV:1,nodes,elements,normals:nodes.map(()=>[0,-1,0]),area:1,areaApproximate:true,bounds:{lower:[0,0,0],upper:[1,0,1]},boundsApproximate:true,closed:false};
}

test('surface spec bounds and fixed native degrees reject invalid input without mutating drafts',()=>{
  const source={kind:'bilinear',controlPoints:structuredClone(spec.controlPoints)},canonical=validateSurfaceSpec(source);
  assert.equal(canonical.segmentsU,16);assert.equal(canonical.segmentsV,16);canonical.controlPoints[0][0][0]=7;assert.equal(source.controlPoints[0][0][0],0);
  for(const kind of ['bilinear','bezier','bspline'])for(const style of ['saddle','dome','wave'])assert.doesNotThrow(()=>validateSurfaceSpec(createSurfaceTemplate(kind,5,6,style)));
  assert.equal(createSurfaceTemplate('bspline',5,6).controlPoints[0].length,6);
  const max=createSurfaceTemplate('bspline',8,8);max.segmentsU=max.segmentsV=64;assert.doesNotThrow(()=>validateSurfaceSpec(max));
  for(const invalid of [null,{...spec,code:'x'},{...spec,path:'C:/private'},{...spec,degreeU:3},{...spec,weights:[]},{...spec,segmentsU:3},{...spec,segmentsV:65},{...spec,segmentsU:4.5},{...spec,segmentsV:'4'},
    {...spec,controlPoints:[spec.controlPoints[0]]},{...spec,controlPoints:[spec.controlPoints[0],[[0,0,0]]]},{...spec,controlPoints:[[[NaN,0,0],[0,0,1]],spec.controlPoints[1]]},
    {...spec,controlPoints:[[[100.01,0,0],[0,0,1]],spec.controlPoints[1]]},{...spec,kind:'bezier'},{...spec,kind:'sphere'}
  ])assert.throws(()=>validateSurfaceSpec(invalid));
});

test('actual native bilinear, Bezier and B-spline surfaces pass browser validation and export with unit normals',{skip:!available},async()=>{
  for(const kind of ['bilinear','bezier','bspline']){
    const requested={...createSurfaceTemplate(kind,5,6),segmentsU:4,segmentsV:8},data=await runCAD({action:'surface',spec:requested});
    assert.equal(validateSurface(data),data);assert.deepEqual(validateSurfaceSpec(data.spec),requested);
    assert.equal(data.nodes.length,5*9);assert.equal(data.elements.length,4*8*2);assert.equal(data.closed,false);
    assert.ok(data.normals.every(n=>Math.abs(Math.hypot(...n)-1)<1e-8));
    assert.equal(surfaceToOBJ(data).split('\n').filter(l=>l.startsWith('f ')).length,64);
    assert.match(surfaceToVTK(data),/POLYGONS 64 256/);
  }
});

test('surface validation rejects corrupt mesh data and reference identities',()=>{
  for(const mutate of [s=>s.closed=true,s=>s.degreeU=2,s=>s.elements[0][0]=-1,s=>s.elements[0][1]=25,s=>s.elements[0][1]=s.elements[0][0],s=>s.nodes.pop(),s=>s.normals[0]=[0,2,0],s=>s.nodes[0][0]=Infinity,s=>s.area=0,s=>s.areaApproximate=false,s=>s.boundsApproximate=false,s=>s.bounds.upper[0]=-1]){
    const data=fixture();mutate(data);assert.throws(()=>validateSurface(data));assert.throws(()=>surfaceToOBJ(data));assert.throws(()=>surfaceToVTK(data));
  }
  const entry={id:'surface-1',name:'参考面',data:fixture()};
  for(const entries of [[entry,entry],[{...entry,id:'bad id'}],[{...entry,name:''}],[{...entry,name:'a'.repeat(81)}],[{...entry,script:'x'}],Array.from({length:17},(_,i)=>({...entry,id:'s'+i}))])assert.throws(()=>normalizeCADSurfaces(entries));
  const copy=normalizeCADSurfaces([entry]);copy[0].data.nodes[0][0]=8;assert.equal(entry.data.nodes[0][0],0);
});

test('project JSON, normalized solver document and legacy edits preserve reference surfaces without creating physical parts',()=>{
  const project=addProjectPart(emptyProject(),{method:'rigid',id:'body'});project.cadSurfaces=[{id:'guide',name:'参考曲面',data:fixture()}];
  const before=JSON.stringify(project),round=normalizeProject(parseProjectText(JSON.stringify(project,null,2))),edited=editLegacyProject(project,m=>{m.bodies[0].mass=3;});
  for(const p of [round,normalizeSolverProject(project),edited]){assert.deepEqual(p.cadSurfaces,project.cadSurfaces);assert.equal(p.parts.length,1);assert.equal(p.parts[0].id,'body');}
  assert.equal(edited.parts[0].material.mass,3);assert.equal(JSON.stringify(project),before);
  assert.equal(toLegacy(project).cadSurfaces,undefined,'reference geometry is excluded from the physics-only projection');
  assert.deepEqual(removePart(project,'body').cadSurfaces,project.cadSurfaces);
  round.cadSurfaces[0].data.nodes[0][0]=4;assert.equal(project.cadSurfaces[0].data.nodes[0][0],0);
});

test('surface OBJ uses one-based vertex/normal indices and VTK exports zero-based polygons with point normals',()=>{
  const data=fixture(),obj=surfaceToOBJ(data).trimEnd().split('\n'),vertices=obj.filter(l=>l.startsWith('v ')),normals=obj.filter(l=>l.startsWith('vn ')),faces=obj.filter(l=>l.startsWith('f '));
  assert.equal(vertices.length,25);assert.equal(normals.length,25);assert.equal(faces.length,32);
  assert.equal(vertices[5],'v 0.25 0 0');assert.equal(normals[5],'vn 0 -1 0');assert.equal(faces[0],'f 1//1 6//6 7//7');assert.equal(faces[1],'f 1//1 7//7 2//2');
  for(let i=0;i<faces.length;i++)assert.deepEqual(faces[i].slice(2).split(' ').map(t=>t.split('//').map(Number)),data.elements[i].map(index=>[index+1,index+1]));
  const vtk=surfaceToVTK(data).trimEnd().split('\n'),start=vtk.indexOf('POLYGONS 32 128'),normalStart=vtk.indexOf('NORMALS surface_normals double');
  assert.ok(vtk.includes('DATASET POLYDATA'));assert.equal(vtk[start+1],'3 0 5 6');assert.equal(vtk[start+2],'3 0 6 1');assert.equal(vtk[normalStart-1],'POINT_DATA 25');
  assert.deepEqual(vtk.slice(normalStart+1),data.normals.map(n=>n.join(' ')));
});

test('surface client uses the fixed endpoint, checks returned settings and propagates cancellation during fetch or body read',async t=>{
  let response=fixture(),calls=0,receivedSignal,abortPhase=null;
  const cancellation=new DOMException('Canceled by user','AbortError'),controller=new AbortController();
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    calls++;assert.equal(url,'/api/cad');assert.equal(request.method,'POST');assert.deepEqual(JSON.parse(request.body),{action:'surface',spec:validateSurfaceSpec(spec)});receivedSignal=request.signal;
    if(abortPhase==='fetch')throw cancellation;
    if(abortPhase==='body')return {status:200,ok:true,json:async()=>{throw cancellation;}};
    return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
  });
  await buildSurface(spec,{signal:controller.signal});assert.equal(receivedSignal,controller.signal);
  response.spec.controlPoints[0][0][0]=.25;await assert.rejects(buildSurface(spec),/不一致/);
  response=fixture();response.spec.segmentsU=8;await assert.rejects(buildSurface(spec),/网格无效/);
  const previous=calls;await assert.rejects(buildSurface({...spec,path:'C:/private'}));assert.equal(calls,previous);
  for(const phase of ['fetch','body']){abortPhase=phase;await assert.rejects(buildSurface(spec,{signal:controller.signal}),e=>e===cancellation&&e.name==='AbortError');}
});
