import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCAD} from '../cad-server.mjs';
import {addCADFEM} from '../src/simulation/cad-mesh-model.js';
import {emptyProject} from '../src/simulation/part-builder.js';
import {normalizeProject} from '../src/simulation/project.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';

const python=fileURLToPath(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const available=existsSync(python)&&spawnSync(python,['-c','import usd_brep, meshpy.tet'],{windowsHide:true}).status===0;
const box={shape:'box',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0],operation:'base'};
const hole=[box,{shape:'cylinder',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0],operation:'difference'}];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const volume=(a,b,c,d)=>dot(sub(b,a),cross(sub(c,a),sub(d,a)))/6;
const centroid=(nodes,tet)=>[0,1,2].map(axis=>tet.reduce((s,i)=>s+nodes[i][axis],0)/4);
const mesh=(recipe,targetSize)=>runCAD({action:'mesh',recipe,options:{kind:'volume',targetSize}});

function checkMesh(m){
  assert.equal(m.schema,'summer-cad-mesh/1');assert.equal(m.kind,'volume');
  assert.match(m.generator,/TetGen/);assert.ok(m.nodes.length<=5000);assert.ok(m.elements.length<=24000);
  let total=0;const faces=new Map(),used=new Set();
  for(const tet of m.elements){
    assert.equal(tet.length,4);assert.equal(new Set(tet).size,4);
    tet.forEach(i=>{assert.ok(Number.isInteger(i)&&i>=0&&i<m.nodes.length);used.add(i);});
    const v=volume(...tet.map(i=>m.nodes[i]));assert.ok(v>0);total+=v;
    for(const local of [[1,2,3],[0,3,2],[0,1,3],[0,2,1]]){
      const key=local.map(i=>tet[i]).sort((a,b)=>a-b).join(',');faces.set(key,(faces.get(key)||0)+1);
    }
  }
  assert.equal(used.size,m.nodes.length);assert.ok([...faces.values()].every(n=>n<=2));
  const boundary=new Set([...faces].filter(([,count])=>count===1).map(([key])=>key));
  assert.equal(boundary.size,m.surface.length);
  for(const face of m.surface)assert.ok(boundary.has([...face].sort((a,b)=>a-b).join(',')));
  assert.ok(Math.abs(total-m.volume)<1e-10);assert.ok(Math.abs(total-m.surfaceVolume)<1e-7);
  assert.ok(m.quality.minMeanRatio>1e-4);assert.ok(m.quality.minAltitude>0);
  assert.equal(m.quality.negativeElements,0);assert.equal(m.quality.degenerateElements,0);
}

test('real TetGen meshes preserve a SMLib through-hole, positive Tet4 volumes and refinement',{skip:!available},async()=>{
  const coarse=await mesh(hole,.2),fine=await mesh(hole,.1);
  checkMesh(coarse);checkMesh(fine);
  assert.ok(fine.elements.length>coarse.elements.length);assert.ok(fine.nodes.length>coarse.nodes.length);
  for(const m of [coarse,fine]){
    assert.ok(m.volumeRelativeError<.01);assert.equal(m.cavityCount,0);
    for(const tet of m.elements){const p=centroid(m.nodes,tet);assert.ok(Math.hypot(p[0],p[2])>.145);}
  }
});

test('enclosed voids and disconnected SMLib solids are not filled by their bounding box',{skip:!available},async()=>{
  const cavity=[{...box,center:[0,0,0],size:[1,1,1]},{shape:'sphere',center:[0,0,0],size:[.5,.5,.5],rotation:[0,0,0],operation:'difference'}];
  const m=await mesh(cavity,.2);checkMesh(m);assert.equal(m.cavityCount,1);
  assert.ok(m.volumeRelativeError<.01);assert.ok(m.volume<.95);
  for(const tet of m.elements)assert.ok(Math.hypot(...centroid(m.nodes,tet))>.24);
  const two=[{...box,center:[0,0,0],size:[.2,.2,.2]},{...box,operation:'union',center:[.5,0,0],size:[.2,.2,.2]}];
  const separate=await mesh(two,.12);checkMesh(separate);
  assert.ok(Math.abs(separate.volume-.016)<1e-7);
  for(const tet of separate.elements){const [x]=centroid(separate.nodes,tet);assert.ok(x<.101||x>.399);}
});

test('native surface refinement and actual CAD mesh become a running CPU FEM part',{skip:!available},async()=>{
  const coarseOptions={kind:'surface',targetSize:.3,angleTolerance:45,chordTolerance:.01};
  const fineOptions={kind:'surface',targetSize:.1,angleTolerance:5,chordTolerance:.001};
  const coarse=await runCAD({action:'mesh',recipe:hole,options:coarseOptions});
  const fine=await runCAD({action:'mesh',recipe:hole,options:fineOptions});
  assert.ok(fine.elements.length>coarse.elements.length*2);assert.deepEqual(fine.options,fineOptions);
  assert.ok(fine.elements.every(t=>t.length===3));assert.deepEqual(fine.elements,fine.surface);
  const m=await runCAD({action:'mesh',recipe:hole,options:{kind:'volume',targetSize:.2,angleTolerance:12,chordTolerance:.002}});
  assert.deepEqual(m.source,{recipe:hole,lower:m.cad.lower,upper:m.cad.upper});
  const project=normalizeProject(JSON.parse(JSON.stringify(addCADFEM(emptyProject(),m,{fixedFace:'y-',young:1e5,density:1000}))));
  assert.equal(project.solver.adapter,'cpu-fem-dynamic');assert.equal(project.parts[0].method,'fem');
  assert.equal(project.parts[0].discretization.mesh.elements.length,m.elements.length);
  const sim=new FEMDynamicSimulation(project),frame=sim.step(.00001),summary=frame.fem.parts[0].summary;
  assert.equal(sim.time,.00001);assert.ok(summary.maxDisplacement>0);
  assert.ok(Math.abs(summary.mass-m.volume*1000)<1e-8);assert.ok(Math.hypot(...summary.forceBalance)<1e-6);
  assert.ok(Number.isFinite(summary.temperature));assert.ok(Number.isFinite(summary.energyResidual));
});

test('volume mesher rejects unreasonable capacities, unsafe options and open or degenerate surfaces',{skip:!available},async()=>{
  await assert.rejects(mesh(hole,.005),/capacity|5000|24000|capacity|exceeds/i);
  for(const options of [{kind:'volume',targetSize:0},{kind:'volume',targetSize:Infinity},{kind:'volume',code:'arbitrary()'}]){
    await assert.rejects(runCAD({action:'mesh',recipe:hole,options}),/Invalid|bounds|options/);
  }
  const program=`import sys\nsys.path.insert(0, 'cad')\nfrom meshing import mesh_volume\nfor points,faces in [([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],[0,1,2]*4), ([[0,0,0],[1,0,0],[0,1,0],[1,1,0]],[0,1,2,0,3,1,0,2,3,1,3,2])]:\n try:\n  mesh_volume(points,faces,{'targetSize':.2})\n except ValueError:\n  pass\n else:\n  raise AssertionError('invalid surface was accepted')\nprint('invalid surfaces rejected')`;
  const checked=spawnSync(python,['-c',program],{cwd:fileURLToPath(new URL('..',import.meta.url)),windowsHide:true,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/invalid surfaces rejected/);
});

test('capacity preflight rejects oversized native surface allocations before tessellation starts',{skip:!available},async()=>{
  const huge=[{...box,center:[0,0,0],size:[12,12,12]}];
  for(const kind of ['surface','volume']){
    await assert.rejects(runCAD({action:'mesh',recipe:huge,options:{kind,targetSize:.005}}),/preflight exceeds/);
  }
  // A thin body may fit the volume estimate but still require far too many
  // boundary nodes. Prove all three paths stop before native tessellation.
  const program=`import sys\nsys.path.insert(0, 'cad')\nimport worker\ndef forbidden(*args):\n raise AssertionError('native tessellation must not start')\nworker.triangles=forbidden\nfor kind,size,target in [('surface',[12,12,12],.005),('volume',[12,12,12],.005),('volume',[12,.01,12],.15)]:\n recipe=[{'shape':'box','operation':'base','center':[0,0,0],'size':size,'rotation':[0,0,0]}]\n try:\n  worker.handle({'action':'mesh','recipe':recipe,'options':{'kind':kind,'targetSize':target}})\n except ValueError as error:\n  assert 'preflight exceeds' in str(error), str(error)\n else:\n  raise AssertionError('oversized mesh accepted')\nprint('native allocation prevented')`;
  const checked=spawnSync(python,['-c',program],{cwd:fileURLToPath(new URL('..',import.meta.url)),windowsHide:true,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/native allocation prevented/);
});
