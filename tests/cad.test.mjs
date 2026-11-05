import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD,createCADHandler} from '../cad-server.mjs';
import {geometryParameters,geometryPoints,domainParameters,insideGeometry} from '../src/three/discretization.js';
import {addProjectPart,emptyProject,updateProjectPart} from '../src/simulation/part-builder.js';
import {normalizeSolverProject} from '../src/simulation/project.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {Simulation3} from '../src/three/simulation.js';
import {cadDisplayMesh} from '../src/three/cad-geometry.js';
import {createServer} from 'node:http';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const recipe=[{shape:'box',center:[0,.7,0],size:[.8,.5,.6],rotation:[0,0,0],operation:'base'},{shape:'cylinder',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0],operation:'difference'}];
const definition=cad=>({shape:'cad',cad,center:cad.lower.map((x,k)=>(x+cad.upper[k])/2/.025),size:cad.upper.map((x,k)=>(x-cad.lower[k])/.025),rotation:[0,0,0]});

test('real SMLib booleans, volume, topology, occupancy and project persistence',{skip:!available},async()=>{
  const cad=await runCAD({action:'build',recipe}),expected=.8*.5*.6-Math.PI*.15**2*.5;
  assert.ok(Math.abs(cad.volume-expected)<1e-8);assert.equal(cad.closed,true);
  assert.ok(cadDisplayMesh(cad).every(Number.isFinite));
  const d=domainParameters({lower:[-80,-40,-80],upper:[80,100,80],cellSize:4,particlesPerAxis:2}),g=geometryParameters(definition(cad),d);
  assert.equal(insideGeometry(g,[0,28,0]),false);assert.equal(insideGeometry(g,[12,28,0]),true);
  const points=geometryPoints(g,16384);assert.ok(points.length>1000);
  assert.ok(points.every(p=>Math.hypot(p[0]*.025,p[2]*.025)>.15));
  let p=addProjectPart(emptyProject(),{method:'mpm',geometry:{...definition(cad),center:definition(cad).center.map(x=>x*.025),size:definition(cad).size.map(x=>x*.025)}});
  p=normalizeSolverProject(p);assert.deepEqual(p.parts[0].geometry.cad,cad);assert.equal(p.parts[0].material.cad,undefined);
  const moved=updateProjectPart(p,p.parts[0].id,{geometry:{center:[.5,1,0]}});assert.deepEqual(moved.parts[0].geometry.cad,cad);
  assert.throws(()=>validateGpuProject({...p,solver:{...p.solver,adapter:'taichi-coupled'}}),/CAD/);
  const plain=updateProjectPart(p,p.parts[0].id,{geometry:{shape:'box'}});assert.equal(plain.parts[0].geometry.cad,undefined);
  for(const operation of ['union','intersection']){
    const r=[{...recipe[0],center:[0,0,0],size:[1,1,1]},{...recipe[0],operation,center:[.5,0,0],size:[1,1,1]}];
    const shape=await runCAD({action:'build',recipe:r});assert.ok(Math.abs(shape.volume-(operation==='union'?1.5:.5))<1e-7);
    const shapeG=geometryParameters(definition(shape),d);assert.equal(insideGeometry(shapeG,[.25/.025,0,0]),true);assert.equal(insideGeometry(shapeG,[-.25/.025,0,0]),operation==='union');
  }
  const exportData=await runCAD({action:'export',recipe});assert.match(exportData.usda,/#usda/);assert.match(exportData.usda,/Brep/);
});

test('CAD MPM/PBF initial mass, holes and jitter survive creation; steps stay finite',{skip:!available},async()=>{
  const cad=await runCAD({action:'build',recipe});
  for(const material of [11,2]){
    const s=new Simulation3();s.reset('empty');s.configureDomain({lower:[-80,-40,-80],upper:[80,100,80],cellSize:4,particlesPerAxis:2});
    s.createGeometry({...definition(cad),material,model:0,temperature:20,sampling:{enabled:true,strength:.35,seed:5}});
    const g=geometryParameters(definition(cad),s.domain);let volume=0;
    for(let i=0;i<s.count;i++){assert.ok(insideGeometry(g,[s.x[i],s.y[i],s.z[i]]));volume+=s.volume[i]*64*.025**3;}
    assert.ok(Math.abs(volume-cad.volume)<1e-10);s.step(1e-5);
    assert.ok(s.x.slice(0,s.count).every(Number.isFinite));
  }
});

test('CAD worker rejects scripts, user paths, malformed requests, empty solids',{skip:!available},async()=>{
  for(const request of [{action:'exec',code:'1+1'},{action:'export',recipe,path:'C:/anywhere'}, {action:'build',recipe:[{...recipe[0],size:[0,1,1]}]}, {action:'build',recipe:[recipe[0],{...recipe[0],operation:'difference'}]}])await assert.rejects(runCAD(request),/SMLib/);
});

test('CAD HTTP endpoint checks origin and isolates request failures',async()=>{
  const handler=createCADHandler({origins:['http://127.0.0.1:5173'],runner:async d=>({ready:d.action==='health'})}),server=createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/cad`;
    let r=await fetch(url,{method:'POST',body:'{}'});assert.equal(r.status,403);
    r=await fetch(url,{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:JSON.stringify({action:'health'})});assert.deepEqual(await r.json(),{ready:true});
    r=await fetch(url,{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);
  }finally{await new Promise(r=>server.close(r));}
});
