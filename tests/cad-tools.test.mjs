import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCurveSpec,validateCurve,normalizeCADCurves,validateMeshOptions,validateCADMesh,meshToVTK,meshToOBJ} from '../src/three/cad-tools.js';
import {buildCurve,buildMesh} from '../src/simulation/cad-client.js';
import {normalizeProject,normalizeSolverProject,editLegacyProject,removePart,toLegacy} from '../src/simulation/project.js';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';

const cad=JSON.parse(readFileSync(new URL('../cad/examples/perforated-block.json',import.meta.url),'utf8')).parts[0].geometry.cad;
const line={kind:'line',points:[[0,0,0],[1,0,0]],samples:8};
const curveData=()=>({schema:'summer-cad-curve/1',kernel:'SMLib',version:'test-fixture',spec:structuredClone(line),points:Array.from({length:9},(_,i)=>[i/8,0,0]),length:1,closed:false,bounds:{lower:[0,0,0],upper:[1,0,0]},boundsApproximate:true});
const meshData=(kind='volume',extra={})=>({schema:'summer-cad-mesh/1',kind,cad:structuredClone(cad),nodes:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],elements:kind==='volume'?[[0,1,2,3]]:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],surface:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],options:validateMeshOptions({kind,...extra})});

test('construction curve validation gives bounded editable defaults and rejects unsafe or inconsistent definitions',()=>{
  const source={kind:'circle',center:[1,2,3],radius:.1},canonical=validateCurveSpec(source);
  assert.equal(canonical.samples,64);assert.deepEqual(canonical.rotation,[0,0,0]);assert.equal(source.samples,undefined);
  canonical.center[0]=9;assert.equal(source.center[0],1);
  assert.doesNotThrow(()=>validateCurveSpec({...line,samples:512,points:[[-100,0,0],[100,0,0]]}));
  for(const spec of [{...line,code:'1+1'},{...line,path:'C:/private'},{...line,samples:513},{...line,samples:8.5},{...line,samples:'64'},
    {...line,points:[[0,0,0],[Infinity,0,0]]},{...line,points:[[0,0,0],[100.01,0,0]]},{...line,points:[[0,0,0],[0,0,0]]},{...line,points:[[0,0,0],[1,0,0],[2,0,0]]},
    {...source,radius:0},{...source,radius:12.001},{...source,rotation:[0,361,0]},
    {kind:'arc',center:[0,0,0],radius:1,startAngle:180,endAngle:0},{kind:'arc',center:[0,0,0],radius:1,startAngle:0,endAngle:360},
    {kind:'bspline',controlPoints:line.points,degree:2},{kind:'bspline',controlPoints:[[0,0,0],[0,1,0],[1,0,0]],degree:1.5},
    {kind:'bezier',controlPoints:Array.from({length:10},(_,i)=>[i,0,0])}
  ])assert.throws(()=>validateCurveSpec(spec));
  const invalid=curveData();invalid.points[1][0]=NaN;assert.throws(()=>validateCurve(invalid),/采样/);
  const short=curveData();short.points.pop();assert.throws(()=>validateCurve(short),/采样/);
});

test('CAD curve identity and capacity checks keep construction geometry separate from loads',()=>{
  const curve={id:'guide',name:'参考路径',data:curveData()};
  assert.doesNotThrow(()=>normalizeCADCurves([curve]));
  for(const invalid of [[curve,curve],[{...curve,id:'x'.repeat(41)}],[{...curve,name:''}],[{...curve,script:'x'}],Array.from({length:33},(_,i)=>({...curve,id:'c'+i}))])assert.throws(()=>normalizeCADCurves(invalid));
  const normalized=normalizeCADCurves([curve]);normalized[0].data.points[0][0]=5;assert.equal(curve.data.points[0][0],0);
});

test('project JSON, solver normalization and legacy property edits retain CAD curves and independent load curves',()=>{
  const p=addProjectPart(emptyProject(),{method:'rigid',id:'body'});
  p.cadCurves=[{id:'guide',name:'空间参考线',data:curveData()}];
  p.curves=[{id:'force-ramp',type:'linear',points:[[0,0],[1,5]]}];
  p.loadBindings=[{id:'force-x',name:'force-x',kind:'body-force',target:'body',component:0,curve:'force-ramp',scale:1,offset:0,enabled:true}];
  const before=JSON.stringify(p),normalized=normalizeProject(p),edited=editLegacyProject(p,legacy=>{legacy.bodies[0].mass=3;});
  for(const q of [normalized,normalizeProject(JSON.parse(before)),normalizeSolverProject(p),edited]){
    assert.deepEqual(q.cadCurves,p.cadCurves);assert.deepEqual(q.curves,normalized.curves);assert.deepEqual(q.loadBindings,normalized.loadBindings);
  }
  assert.equal(edited.parts[0].material.mass,3);assert.equal(JSON.stringify(p),before);
  normalized.cadCurves[0].data.points[0][0]=7;assert.equal(p.cadCurves[0].data.points[0][0],0);
  assert.equal(toLegacy(p).cadCurves,undefined,'construction curves must not become solver load curves');
  assert.deepEqual(removePart(p,'body').cadCurves,p.cadCurves);
});

test('VTK keeps zero-based tetrahedron connectivity; OBJ exports one-based boundary triangles',()=>{
  const volume=meshData(),vtk=meshToVTK(volume).trimEnd().split('\n');
  assert.equal(vtk[vtk.indexOf('POINTS 4 double')+1],'0 0 0');
  assert.equal(vtk[vtk.indexOf('CELLS 1 5')+1],'4 0 1 2 3');
  assert.equal(vtk[vtk.indexOf('CELL_TYPES 1')+1],'10');
  const obj=meshToOBJ(volume).trimEnd().split('\n');
  assert.deepEqual(obj.filter(l=>l.startsWith('v ')),['v 0 0 0','v 1 0 0','v 0 1 0','v 0 0 1']);
  assert.deepEqual(obj.filter(l=>l.startsWith('f ')),['f 1 3 2','f 1 2 4','f 1 4 3','f 2 3 4']);
  const surface=meshData('surface'),surfaceVTK=meshToVTK(surface).trimEnd().split('\n');
  assert.equal(surfaceVTK[surfaceVTK.indexOf('CELLS 4 16')+1],'3 0 2 1');
  assert.deepEqual(surfaceVTK.slice(surfaceVTK.indexOf('CELL_TYPES 4')+1),['5','5','5','5']);
  assert.equal(meshToOBJ(surface),meshToOBJ(volume));
});

test('mesh guards reject invalid resolution, topology and mismatched requested element type',()=>{
  for(const options of [{kind:'surface',targetSize:0},{kind:'volume',angleTolerance:2},{kind:'volume',chordTolerance:Infinity},{kind:'surface',path:'C:/private'},{kind:'surface',targetSize:'0.1'}])assert.throws(()=>validateMeshOptions(options));
  for(const mutate of [m=>m.elements[0][3]=4,m=>m.elements[0][3]=2,m=>m.surface[0][0]=-1,m=>m.nodes[0][0]=NaN,m=>m.elements=[],m=>m.options.kind='surface']){
    const mesh=meshData();mutate(mesh);assert.throws(()=>validateCADMesh(mesh));assert.throws(()=>meshToVTK(mesh));assert.throws(()=>meshToOBJ(mesh));
  }
});

test('CAD client fails closed when the service returns different curve parameters or mesh resolution',async t=>{
  let response=curveData(),calls=0,lastRequest;
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(url,'/api/cad');lastRequest=JSON.parse(init.body);return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});});
  await buildCurve(line);assert.deepEqual(lastRequest,{action:'curve',spec:validateCurveSpec(line)});
  response.spec.points[1][0]=2;await assert.rejects(buildCurve(line),/不一致/);
  const options={kind:'surface',targetSize:.12,angleTolerance:12,chordTolerance:.001};
  response=meshData('surface',options);await buildMesh(cad.recipe,options);assert.deepEqual(lastRequest.options,options);
  response.options.targetSize=.3;await assert.rejects(buildMesh(cad.recipe,options),/不一致/);
  response=meshData('surface',options);response.options.chordTolerance=.005;await assert.rejects(buildMesh(cad.recipe,options),/不一致/);
  response=meshData('surface',options);response.cad.recipe[0].center[0]+=.5;await assert.rejects(buildMesh(cad.recipe,options),/不一致/);
  const previous=calls;await assert.rejects(buildMesh(cad.recipe,{kind:'surface',targetSize:0}));await assert.rejects(buildCurve({...line,path:'x'}));assert.equal(calls,previous,'invalid input must not reach the kernel');
});
