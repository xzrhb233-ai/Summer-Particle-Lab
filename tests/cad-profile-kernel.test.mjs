import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';
import {addCADFEM} from '../src/simulation/cad-mesh-model.js';
import {emptyProject} from '../src/simulation/part-builder.js';
import {normalizeProject} from '../src/simulation/project.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const placement={operation:'base',center:[0,0,0],rotation:[0,0,0]};
const extrude={...placement,shape:'extrude',profile:[[-.5,-.3],[.5,-.3],[.5,.3],[-.5,.3]],depth:.4};
const revolve={...placement,shape:'revolve',profile:[[0,0],[.5,0],[.5,1],[0,1]],angle:360};
const build=recipe=>runCAD({action:'build',recipe});
const mesh=recipe=>runCAD({action:'mesh',recipe,options:{kind:'volume',targetSize:.2,angleTolerance:12,chordTolerance:.001}});
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const vecNear=(a,b,t=1e-6)=>a.forEach((v,k)=>near(v,b[k],t));
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const centroid=(m,t)=>[0,1,2].map(k=>t.reduce((s,i)=>s+m.nodes[i][k],0)/4);
function positiveMesh(m){
  assert.equal(m.kind,'volume');assert.equal(m.cad.closed,true);assert.ok(m.elements.length>0);assert.ok(m.nodes.length<=5000);assert.ok(m.elements.length<=24000);
  let total=0;for(const t of m.elements){const [a,b,c,d]=t.map(i=>m.nodes[i]),v=dot(sub(b,a),cross(sub(c,a),sub(d,a)))/6;assert.ok(v>0);total+=v;}
  near(total,m.volume,1e-8);assert.equal(m.quality.negativeElements,0);assert.equal(m.quality.degenerateElements,0);assert.ok(m.volumeRelativeError<.02);
}

test('native capped extrusion preserves concavity, input winding, depth centering and common placement',{skip:!available},async()=>{
  const original=[{...extrude,center:[1,2,3],rotation:[0,90,0]}],before=JSON.stringify(original),solid=await build(original);
  assert.equal(solid.closed,true);near(solid.volume,.24);vecNear(solid.lower,[.8,1.7,2.5]);vecNear(solid.upper,[1.2,2.3,3.5]);assert.equal(JSON.stringify(original),before);assert.deepEqual(solid.recipe,original);
  const clockwise={...extrude,profile:[...extrude.profile].reverse()},cw=await build([clockwise]);near(cw.volume,.24);assert.deepEqual(cw.recipe[0].profile,clockwise.profile);
  const lShape={...extrude,profile:[[-.5,-.5],[.5,-.5],[.5,-.1],[-.1,-.1],[-.1,.5],[-.5,.5]]},l=await build([lShape]);near(l.volume,.64*.4);
  const exported=await runCAD({action:'export',recipe:[lShape]});assert.match(exported.usda,/#usda/);assert.match(exported.usda,/Brep/);
});

test('native revolution supports axis contact, partial caps, clockwise profiles and through-hole sleeves',{skip:!available},async()=>{
  for(const angle of [1,90,360]){
    const solid=await build([{...revolve,angle}]);assert.equal(solid.closed,true);near(solid.volume,Math.PI*.25*angle/360);
    if(angle===90){vecNear(solid.lower,[0,0,-.5]);vecNear(solid.upper,[.5,1,0]);}
    if(angle===360){vecNear(solid.lower,[-.5,0,-.5]);vecNear(solid.upper,[.5,1,.5]);}
  }
  const sleeve={...revolve,profile:[[.2,0],[.5,0],[.5,1],[.2,1]]},solid=await build([sleeve]),cw=await build([{...sleeve,profile:[...sleeve.profile].reverse()}]);
  near(solid.volume,Math.PI*(.25-.04));near(cw.volume,solid.volume);assert.equal(solid.closed,true);
});

test('new profile features combine with existing primitives in native boolean recipes',{skip:!available},async()=>{
  const cut=[{...extrude,profile:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},{shape:'cylinder',operation:'difference',center:[0,0,0],rotation:[0,0,0],size:[.2,1.2,.2]}];
  const cutBody=await build(cut);near(cutBody.volume,.4-Math.PI*.1*.1);
  const intersection=[{...revolve,center:[0,-.5,0]},{shape:'box',operation:'intersection',center:[0,0,0],rotation:[0,0,0],size:[.4,.4,.4]}];
  const inner=await build(intersection);near(inner.volume,.064);vecNear(inner.lower,[-.2,-.2,-.2]);vecNear(inner.upper,[.2,.2,.2]);
});

test('profile validation rejects duplicate, crossing, touching, backtracking and out-of-range input',{skip:!available},async()=>{
  const invalid=[
    {...extrude,script:'print(1)'},{...extrude,size:[1,1,1]},{...extrude,depth:0},{...extrude,depth:13},{...extrude,depth:true},
    {...extrude,profile:[[0,0],[1,0]]},{...extrude,profile:[[0,0],[1,0],[1,1],[0,1],[0,0]]},{...extrude,profile:[[0,0],[1,1],[0,1],[1,0]]},
    {...extrude,profile:[[0,0],[1,0],[1,1],[.5,0],[0,1]]},{...extrude,profile:[[0,0],[1,0],[.5,0],[1,1],[0,1]]},
    {...extrude,profile:[[0,0],[1,0],[1,.005],[0,.005]]},{...extrude,profile:[[0,0],[7,0],[1,1]]},
    {...extrude,profile:Array.from({length:33},(_,i)=>[Math.cos(i/33*2*Math.PI),Math.sin(i/33*2*Math.PI)])},
    {...revolve,angle:0},{...revolve,angle:361},{...revolve,profile:[[-.1,0],[.5,0],[.5,1],[-.1,1]]},
  ];
  for(const feature of invalid)await assert.rejects(build([feature]),/SMLib/);
  await assert.rejects(build(Array.from({length:9},(_,i)=>({...extrude,operation:i?'union':'base'}))),/SMLib/);
  // Decimal cancellation must not turn the nominal minimum 0.01 m span invalid.
  const minimum=await build([{...extrude,profile:[[.34,0],[.35,0],[.35,.02],[.34,.02]],depth:.02}]);near(minimum.volume,.01*.02*.02,1e-10);
});

test('native hollow revolve and enclosed revolved cavity retain their voids through TetGen',{skip:!available},async()=>{
  const tube=await mesh([{...revolve,profile:[[.2,-.2],[.4,-.2],[.4,.2],[.2,.2]]}]);positiveMesh(tube);assert.equal(tube.cavityCount,0);
  near(tube.exactVolume,Math.PI*(.16-.04)*.4);
  for(const t of tube.elements){const p=centroid(tube,t);assert.ok(Math.hypot(p[0],p[2])>.197);}
  const cavity=await mesh([{...revolve,profile:[[0,-.4],[.5,-.4],[.5,.4],[0,.4]]},{...revolve,operation:'difference',profile:[[0,-.2],[.2,-.2],[.2,.2],[0,.2]]}]);
  positiveMesh(cavity);assert.equal(cavity.cavityCount,1);near(cavity.exactVolume,Math.PI*(.25*.8-.04*.4));
  for(const t of cavity.elements){const p=centroid(cavity,t);assert.ok(Math.abs(p[1])>=.199||Math.hypot(p[0],p[2])>.197);}
});

test('native extrude and revolve meshes round-trip into advancing CPU Tet4 FEM parts',{skip:!available},async()=>{
  for(const feature of [{...extrude,profile:[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2]],center:[0,.7,0]},
    {...revolve,profile:[[.12,-.2],[.3,-.2],[.3,.2],[.12,.2]],center:[0,.7,0]}]){
    const m=await mesh([feature]);positiveMesh(m);
    const project=normalizeProject(JSON.parse(JSON.stringify(addCADFEM(emptyProject(),m,{fixedFace:'y-',young:1e5,density:1000}))));
    assert.equal(project.parts[0].geometry.cad.recipe[0].shape,feature.shape);
    const simulation=new FEMDynamicSimulation(project),frame=simulation.step(.00001),summary=frame.fem.parts[0].summary;
    near(simulation.time,.00001,1e-12);assert.ok(summary.maxDisplacement>0);near(summary.mass,m.volume*1000,1e-7);
    assert.ok(Math.hypot(...summary.forceBalance)<1e-6);assert.ok(Number.isFinite(summary.temperature));assert.ok(Number.isFinite(summary.energyResidual));
  }
});
