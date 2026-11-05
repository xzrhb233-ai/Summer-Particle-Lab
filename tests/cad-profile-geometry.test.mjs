import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {validateCADProfile,compileCADProfile} from '../src/three/cad-profiles.js';
import {validateCADRecipe,compileCAD} from '../src/three/cad-geometry.js';
import {createCADTemplate,moveCADStep,deleteCADStep} from '../src/simulation/cad-templates.js';
import {rotationXYZ,transform,geometryParameters,insideGeometry} from '../src/three/discretization.js';
import {Simulation3} from '../src/three/simulation.js';
import {runCAD} from '../cad-server.mjs';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const lProfile=[[-1,-1],[1,-1],[1,-.3],[-.3,-.3],[-.3,1],[-1,1]];
const extrude=(patch={})=>({shape:'extrude',operation:'base',center:[0,0,0],profile:lProfile,depth:.4,rotation:[0,0,0],...patch});
const revolve=(patch={})=>({shape:'revolve',operation:'base',center:[0,0,0],profile:[[.5,-.4],[1,-.4],[1,.4],[.5,.4]],angle:90,rotation:[0,0,0],...patch});
// Synthetic broad envelope isolates occupancy from display tessellation. These
// triangles are deliberately unrelated to the profile and are never simulated.
function contains(recipe){
  const cad={schema:'summer-cad/1',kernel:'SMLib',closed:true,recipe,lower:[-3,-3,-3],upper:[3,3,3],volume:1,vertices:[[-3,-3,-3],[3,-3,-3],[0,3,-3],[0,0,3]],indices:[0,1,2,0,3,1,1,3,2,2,3,0]},sample=compileCAD(cad);
  return p=>sample(p.map(x=>x/3));
}
const polar=(angle,r=.75,y=0)=>[r*Math.cos(angle*Math.PI/180),y,-r*Math.sin(angle*Math.PI/180)];

test('polygon profiles retain concavity, winding and inclusive edge/vertex membership',()=>{
  for(const profile of [lProfile,lProfile.toReversed()]){
    assert.deepEqual(validateCADProfile(profile),profile);
    const hit=compileCADProfile(profile);
    assert.equal(hit(-.7,.7),true);assert.equal(hit(.7,-.7),true);assert.equal(hit(.7,.7),false);
    for(const p of profile)assert.equal(hit(...p),true);
    assert.equal(hit(-.3,.5),true);assert.equal(hit(-.3+1e-6,.5),false);assert.equal(hit(-1-1e-6,0),false);
  }
  assert.doesNotThrow(()=>validateCADProfile([[.34,0],[.35,0],[.35,.01],[.34,.01]]));
});

test('profile validation rejects crossing, touching, backtracking, duplicate and foreign fields',()=>{
  for(const profile of [
    [[0,0],[2,2],[0,2],[1,0]], // nonzero-area crossing
    [[0,0],[2,0],[2,2],[1,0],[0,2]], // nonadjacent touching
    [[0,0],[2,0],[1,0],[2,2],[0,2]], // adjacent overlap
    [[0,0],[1,0],[1,1],[0,0]],
    [[0,0],[1,0],[1,1],[1+1e-12,1]],
    [[0,0],[1,1],[2,2]],
    [[0,0],[.001,0],[.001,1]],
    [[0,0],[7,0],[7,1]],
    [[0,0],[1,0],[1,Infinity]]
  ])assert.throws(()=>validateCADProfile(profile),/轮廓/);
  assert.throws(()=>validateCADRecipe([extrude({size:[1,1,1]})]),/参数/);
  assert.throws(()=>validateCADRecipe([extrude({depth:'1'})]),/深度/);
  assert.throws(()=>validateCADRecipe([extrude({depth:0})]),/深度/);
  assert.throws(()=>validateCADRecipe([revolve({angle:361})]),/角度/);
  assert.throws(()=>validateCADRecipe([revolve({profile:[[-.01,-.4],[1,-.4],[1,.4],[-.01,.4]]})]),/半径/);
  assert.throws(()=>validateCADRecipe([extrude({profile:lProfile,code:'no'})]),/参数/);
  assert.throws(()=>validateCADRecipe([extrude(),...Array.from({length:8},()=>extrude({operation:'union'}))]),/1–8/);
  const source=extrude(),canonical=validateCADRecipe([source])[0];assert.deepEqual(canonical,source);canonical.profile[0][0]=5;assert.equal(source.profile[0][0],-1);
});

test('concave extrusion preserves CSG holes, caps, transforms and mixed primitive booleans',()=>{
  const hole={shape:'cylinder',operation:'difference',center:[-.65,.5,0],size:[.25,1,.25],rotation:[90,0,0]},recipe=[extrude(),hole],hit=contains(recipe);
  assert.equal(hit([-.65,.5,0]),false);assert.equal(hit([-.65,.5,.2]),false);
  assert.equal(hit([-.9,.5,0]),true);assert.equal(hit([.7,.7,0]),false);
  assert.equal(hit([.7,-.7,.2]),true);assert.equal(hit([.7,-.7,.200001]),false);
  const withUnion=contains([...recipe,{shape:'box',operation:'union',center:[.7,.7,0],size:[.2,.2,.4],rotation:[0,0,0]}]);assert.equal(withUnion([.7,.7,0]),true);
  const clipped=contains([...recipe,{shape:'box',operation:'intersection',center:[-.5,0,0],size:[1,2,1],rotation:[0,0,0]}]);assert.equal(clipped([-.9,.5,0]),true);assert.equal(clipped([.7,-.7,0]),false);
  const r=extrude({center:[.7,.8,-.3],rotation:[25,40,70]}),rotated=contains([r]),R=rotationXYZ(r.rotation),world=p=>transform(R,p).map((x,k)=>x+r.center[k]);
  for(const [point,expected] of [[[-.7,.7,0],true],[[.7,.7,0],false],[[.7,-.7,.2],true]])assert.equal(rotated(world(point)),expected);
  assert.deepEqual(deleteCADStep(moveCADStep([extrude(),hole,revolve({operation:'union'})],2,-1),1),recipe);
});

test('partial revolutions use +Y right-hand angle and include cut faces and the axis',()=>{
  for(const angle of [1,90,270,360]){
    const hit=contains([revolve({angle})]);
    for(const sample of [0,angle/2,angle])assert.equal(hit(polar(sample)),true,`${angle} at ${sample}`);
    if(angle<360)assert.equal(hit(polar((angle+360)/2)),false);
    assert.equal(hit(polar(angle/2,.25)),false);assert.equal(hit(polar(angle/2,1.00001)),false);assert.equal(hit(polar(angle/2,.75,.40001)),false);
  }
  const quarter=contains([revolve()]);assert.equal(quarter([0,0,-.75]),true);assert.equal(quarter([0,0,.75]),false);assert.equal(quarter(polar(-.001)),false);assert.equal(quarter(polar(90.001)),false);
  const axis=contains([revolve({angle:60,profile:[[0,-.4],[1,-.4],[1,.4],[0,.4]]})]);assert.equal(axis([0,0,0]),true);assert.equal(axis([0,.4,0]),true);assert.equal(axis([0,.40001,0]),false);
  const stepped=contains([revolve({angle:360,profile:[[.2,-.4],[1,-.4],[1,-.1],[.6,-.1],[.6,.4],[.2,.4]]})]);assert.equal(stepped(polar(45,.8,.2)),false);assert.equal(stepped(polar(45,.4,.2)),true);
  const r=revolve({center:[.3,.7,-.5],rotation:[20,35,-15]}),rotated=contains([r]),R=rotationXYZ(r.rotation),world=p=>transform(R,p).map((x,k)=>x+r.center[k]);
  assert.equal(rotated(world(polar(45))),true);assert.equal(rotated(world(polar(180))),false);
});

test('real profile CAD samples preserve holes, volume and deterministic jitter for MPM and PBF',{skip:!available},async()=>{
  const solid=createCADTemplate('extruded-l-bracket').recipe,throughHole={shape:'cylinder',operation:'difference',center:[-.3,.8,0],size:[.1,.8,.1],rotation:[90,0,0]};
  const recipes=[[...solid,throughHole],[{...createCADTemplate('revolved-sleeve').recipe[0],angle:90}]];
  for(const recipe of recipes){
    const cad=await runCAD({action:'build',recipe});
    for(const material of [11,2]){
      const sim=new Simulation3();sim.reset('empty');sim.configureDomain({lower:[-80,-40,-80],upper:[80,100,80],cellSize:4,particlesPerAxis:2});
      const geometry={shape:'cad',cad,center:cad.lower.map((x,k)=>(x+cad.upper[k])/2/.025),size:cad.upper.map((x,k)=>(x-cad.lower[k])/.025),rotation:[0,0,0]};
      sim.createGeometry({...geometry,material,model:0,temperature:20,sampling:{enabled:true,strength:.35,seed:19}});
      const g=geometryParameters(geometry,sim.domain);let volume=0;assert.ok(sim.count>10);
      for(let i=0;i<sim.count;i++){const p=[sim.x[i],sim.y[i],sim.z[i]];assert.ok(insideGeometry(g,p));volume+=sim.volume[i]*64*.025**3;
        if(recipe[0].shape==='extrude')assert.ok(Math.hypot(p[0]*.025+.3,p[1]*.025-.8)>.05);
        else assert.ok(p[0]>=-1e-8&&p[2]<=1e-8);
      }
      assert.ok(Math.abs(volume-cad.volume)<1e-10);sim.step(1e-5);assert.ok(sim.x.slice(0,sim.count).every(Number.isFinite));
    }
  }
});
