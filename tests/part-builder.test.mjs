import test from 'node:test';
import assert from 'node:assert/strict';
import {PART_METHODS,createPart,emptyProject,addProjectPart,updateProjectPart,prepareProjectMethods,proposeNewPart} from '../src/simulation/part-builder.js';
import {normalizeSolverProject,removePart} from '../src/simulation/project.js';
import {validateFEM,dynamicCantileverProject} from '../src/fem/model.js';
import {validateMixed} from '../src/mixed/model.js';

test('each method can start a project using its own discretization',()=>{
  for(const kind of PART_METHODS){
    const p=addProjectPart(emptyProject(),{method:kind.id});
    assert.equal(p.parts.length,1);assert.equal(p.parts[0].method,kind.id);
    if(kind.id==='fem'){
      const checked=validateFEM(p);assert.equal(checked.parts[0].discretization.element,'tet4');
      assert.equal(p.loads.find(l=>l.type==='fem-fixed').target,p.parts[0].id);
    }else assert.equal(normalizeSolverProject(p).parts[0].method,kind.id);
    if(kind.id==='pbf')assert.equal(p.parts[0].material.phaseChange.enabled,false);
  }
});

test('adding all four methods preserves previous geometry, IDs, loads and authoring metadata',()=>{
  let p=dynamicCantileverProject();p.authorNotes={tag:'preserve me'};
  const source=p,before=structuredClone(p);
  for(const method of ['mpm','pbf','rigid'])p=addProjectPart(p,{method,geometry:{center:[0,1.5,0]}});
  assert.deepEqual(source,before);
  assert.deepEqual(p.parts[0],before.parts[0]);assert.deepEqual(p.loads.slice(0,before.loads.length),before.loads);
  assert.deepEqual(p.curves,before.curves);assert.deepEqual(p.loadBindings,before.loadBindings);assert.deepEqual(p.authorNotes,before.authorNotes);
  assert.deepEqual(p.parts.map(b=>b.method),['fem','mpm','pbf','rigid']);assert.equal(p.solver.adapter,'cpu-fem-mpm');
  assert.equal(new Set(p.parts.map(b=>b.id)).size,4);
  assert.equal(p.contactPairs.length,6); // Five prior interfaces plus MPM–PBF.
  assert.ok(p.contactPairs.some(d=>d.a==='pbf-1'&&d.b==='beam'));
  assert.ok(p.contactPairs.some(d=>d.a==='mpm-1'&&d.b==='pbf-1'&&d.friction===0));
});

test('editing one part merges nested parameters without resetting the other methods or references',()=>{
  let p=addProjectPart(emptyProject(),{method:'mpm',material:{thermalMaterial:{hotRatio:.2}}});
  p=addProjectPart(p,{method:'fem'});const before=structuredClone(p);
  p=updateProjectPart(p,'mpm-1',{name:'renamed',geometry:{center:[.7,1,0]},material:{thermalMaterial:{Thot:200}}});
  assert.equal(p.parts[0].material.thermalMaterial.hotRatio,.2);assert.equal(p.parts[0].material.thermalMaterial.Thot,200);
  assert.deepEqual(p.parts[1],before.parts[1]);assert.deepEqual(p.contactPairs,before.contactPairs);
  assert.deepEqual(p.selectionSets,before.selectionSets);assert.deepEqual(p.loads,before.loads);
  assert.deepEqual(before.parts[0].geometry.center,[0,1,0]);
});

test('FEM support changes preserve unrelated face loads and selection sets',()=>{
  let p=addProjectPart(emptyProject(),{method:'fem'});
  p.selectionSets.push({id:'heat-face',part:'fem-1',name:'heat',entity:'face',region:{type:'face',face:'z+'}});
  p.loads.push({id:'heat-load',target:'fem-1',type:'thermal-power',region:{type:'face',face:'z+'},power:10,enabled:true});
  const changed=updateProjectPart(p,'fem-1',{boundary:{fixedFace:'y-'}});
  assert.equal(changed.selectionSets.find(s=>s.id==='support-fem-1').region.face,'y-');
  assert.ok(changed.selectionSets.some(s=>s.id==='heat-face'));assert.ok(changed.loads.some(l=>l.id==='heat-load'));
  assert.equal(changed.loads.filter(l=>l.type==='fem-fixed').length,1);validateFEM(changed);
  const old=dynamicCantileverProject(),edited=updateProjectPart(old,'beam',{boundary:{fixedFace:'y-'}});
  assert.equal(edited.loads.filter(l=>l.type==='fem-fixed').length,1);
  assert.equal(edited.selectionSets.find(s=>s.id==='beam-support').region.face,'y-');
  assert.deepEqual(edited.loads.find(l=>l.id==='beam-traction'),old.loads.find(l=>l.id==='beam-traction'));
});

test('failed edits do not mutate the source document, and method changes are explicit errors',()=>{
  const p=addProjectPart(emptyProject(),{method:'mpm'}),before=structuredClone(p);
  for(const patch of [{geometry:{size:[-1,1,1]}},{geometry:{center:[20,1,0]}},{method:'pbf'},{initial:{temperature:NaN}},{id:'different'}])assert.throws(()=>updateProjectPart(p,'mpm-1',patch));
  assert.throws(()=>addProjectPart(p,{method:'pbf',material:{phaseChange:{enabled:true}}}));
  assert.throws(()=>addProjectPart(p,{method:'mpm',id:'mpm-1'}));
  assert.deepEqual(p,before);
});

test('convex rigid↔FEM shapes compile without particles; torus is explicitly rejected',()=>{
  const p=addProjectPart(emptyProject(),{method:'fem'}),before=structuredClone(p);
  for(const shape of ['sphere','box','cylinder','disc']){
    const next=validateMixed(addProjectPart(p,{method:'rigid',geometry:{shape,center:[0,1.5,0]}}));
    assert.equal(next.parts.length,2);assert.equal(next.contactPairs.length,1);
  }
  assert.throws(()=>addProjectPart(p,{method:'rigid',geometry:{shape:'torus',size:[.3,.3,.05]}}),/轮胎/);
  assert.deepEqual(p,before);
  assert.throws(()=>createPart('rigid',{geometry:{shape:'sphere',size:[1,2,1]}}),/直径/);
});

test('removing the last method reroutes without orphan particle couplings or loads',()=>{
  let p=addProjectPart(emptyProject(),{method:'mpm'});
  p=addProjectPart(p,{method:'fem'});
  p.loads.push({id:'region',type:'region-heat',target:'mpm',center:[0,1,0],radius:.3,power:1});
  const onlyFEM=prepareProjectMethods(removePart(p,'mpm-1'));
  assert.equal(onlyFEM.solver.adapter,'cpu-fem-dynamic');assert.deepEqual(onlyFEM.couplings,[]);assert.ok(!onlyFEM.loads.some(l=>l.type==='region-heat'));
  validateFEM(onlyFEM);
  const onlyMPM=prepareProjectMethods(removePart(p,'fem-1'));
  assert.equal(onlyMPM.solver.adapter,'cpu-coupled');normalizeSolverProject(onlyMPM);
  const empty=prepareProjectMethods(removePart(onlyMPM,'mpm-1'));
  assert.equal(empty.parts.length,0);assert.equal(empty.solver.mpmEnabled,false);normalizeSolverProject(empty);
});

test('GPU-only thermal parameters are preserved when adding new methods',()=>{
  let p=addProjectPart(emptyProject(),{method:'fem'});
  p=addProjectPart(p,{method:'mpm',material:{thermomechanical:{expansion:.0002,hotStiffnessRatio:.4},cp:900,conductivity:205}});
  p.solver.computeBackend='gpu';
  const next=addProjectPart(p,{method:'pbf'});
  assert.equal(next.solver.computeBackend,'gpu');
  assert.deepEqual(next.parts.find(b=>b.method==='mpm').material,p.parts.find(b=>b.method==='mpm').material);
});

test('FEM and particle creation can start in either order and compile the four-method project',()=>{
  for(const order of [['mpm','fem','rigid','pbf'],['fem','pbf','mpm','rigid'],['pbf','rigid','fem','mpm']]){
    let p=emptyProject();
    for(const method of order)p=addProjectPart(p,{method});
    const compiled=validateMixed(p);
    assert.equal(compiled.parts.length,4);assert.equal(compiled.contactPairs.length,6);
    assert.deepEqual(compiled.parts.map(b=>b.method),order);
  }
});

test('new-part suggestions avoid existing shapes, remain within the domain, and are deterministic',()=>{
  let p=emptyProject();p.discretization.mpm={lower:[-1,0,-1],upper:[1,2,1],cellSize:.2,particlesPerAxis:2};
  p=addProjectPart(p,{method:'mpm',geometry:{center:[0,1,0],size:[.6,.6,.6]}});
  const before=structuredClone(p);
  for(const method of ['fem','rigid','pbf']){
    const b=proposeNewPart(p,method),again=proposeNewPart(p,method);
    assert.deepEqual(b,again);assert.equal(b.placementWarning,undefined);
    const half=b.geometry.size.map(v=>v/2),center=b.geometry.center,d=p.discretization.mpm;
    assert.ok(center.every((v,k)=>v-half[k]>=d.lower[k]&&v+half[k]<=d.upper[k]));
    assert.ok(p.parts.every(a=>center.some((v,k)=>v+half[k]<a.geometry.center[k]-a.geometry.size[k]/2||v-half[k]>a.geometry.center[k]+a.geometry.size[k]/2)));
    p=addProjectPart(p,b);
  }
  assert.deepEqual(p.discretization,before.discretization);
  assert.deepEqual(p.parts[0],before.parts[0]);
});

test('a full domain produces a placement explanation without silently changing sizes or grid',()=>{
  const p=emptyProject();p.discretization.mpm={lower:[0,0,0],upper:[.2,.2,.2],cellSize:.1,particlesPerAxis:2};
  const before=structuredClone(p),b=proposeNewPart(p,'pbf');
  assert.match(b.placementWarning,/空位/);assert.deepEqual(b.geometry,createPart('pbf').geometry);assert.deepEqual(p,before);
});
