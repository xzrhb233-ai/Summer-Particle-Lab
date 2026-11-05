import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PARAMETRIC_TEMPLATES,createParametricSpec,validateParametricSpec,patchParametricSpec,compileParametricRecipe,diffParametricSpec,validateParametricPart} from '../src/simulation/cad-parametric.js';
import {runCAD} from '../cad-server.mjs';
import {addProjectPart,emptyProject,updateProjectPart} from '../src/simulation/part-builder.js';
import {normalizeProject,normalizeSolverProject,editLegacyProject,toLegacy} from '../src/simulation/project.js';
import {parseProjectText} from '../src/simulation/project-io.js';
import {cadFEMOptions} from '../src/simulation/cad-mesh-model.js';
import {validateFEM} from '../src/fem/model.js';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const geometry=cad=>({shape:'cad',cad,center:[.15,.8,.1],rotation:[0,20,0],size:cad.upper.map((v,k)=>v-cad.lower[k])});
const problem=(fn,field)=>assert.throws(fn,error=>error.issues?.some(i=>i.field===field&&i.severity==='error'&&typeof i.code==='string'));

test('parameter templates have closed, canonical SI schemas and immutable metadata',()=>{
  assert.deepEqual(PARAMETRIC_TEMPLATES.map(t=>t.id),['l-bracket','sleeve','four-hole-plate']);
  for(const template of PARAMETRIC_TEMPLATES){
    const spec=createParametricSpec(template.id),recipe=compileParametricRecipe(spec);
    assert.equal(spec.schema,'summer-parametric/1');assert.ok(recipe.length<=8);
    assert.ok(Object.isFrozen(template)&&Object.isFrozen(template.fields));
    assert.deepEqual(Object.keys(spec.parameters),template.fields.map(f=>f.key));
    assert.deepEqual(validateParametricSpec(JSON.parse(JSON.stringify(spec))),spec);
    problem(()=>createParametricSpec(template.id,{script:1}),'script');
    for(const f of template.fields){
      for(const invalid of [undefined,null,true,'1',NaN,Infinity,-Infinity])problem(()=>patchParametricSpec(spec,{[f.key]:invalid}),f.key);
      problem(()=>patchParametricSpec(spec,{[f.key]:f.min-.001}),f.key);
      problem(()=>patchParametricSpec(spec,{[f.key]:f.max+.001}),f.key);
      const missing=structuredClone(spec);delete missing.parameters[f.key];problem(()=>validateParametricSpec(missing),f.key);
    }
  }
  problem(()=>createParametricSpec('unknown'),'template');
  problem(()=>validateParametricSpec({...createParametricSpec('sleeve'),script:'x'}),'script');
  problem(()=>validateParametricSpec({...createParametricSpec('sleeve'),schema:'old'}),'schema');
  problem(()=>createParametricSpec('sleeve',[]),'parameters');
});

test('parameter fit and clearance boundaries reject intersecting or degenerate native features',()=>{
  for(const patch of [{legThickness:.8},{legThickness:.6}])problem(()=>createParametricSpec('l-bracket',patch),'legThickness');
  for(const patch of [{innerRadius:.4},{innerRadius:.5},{outerRadius:.205}])problem(()=>createParametricSpec('sleeve',patch),'outerRadius');
  for(const patch of [{pitchX:.14},{pitchX:.13},{pitchX:.76}])problem(()=>createParametricSpec('four-hole-plate',patch),'pitchX');
  for(const patch of [{pitchZ:.14},{pitchZ:.13},{pitchZ:.56}])problem(()=>createParametricSpec('four-hole-plate',patch),'pitchZ');
  for(const spec of [createParametricSpec('l-bracket',{width:12,height:12,legThickness:.01,depth:12}),createParametricSpec('sleeve',{innerRadius:5.99,outerRadius:6,height:12,angle:1}),createParametricSpec('four-hole-plate',{width:12,height:12,thickness:12,holeDiameter:.01})])assert.ok(compileParametricRecipe(spec).length<=8);
  const before=createParametricSpec('four-hole-plate'),snapshot=structuredClone(before),after=patchParametricSpec(before,{holeDiameter:.18,pitchX:.55});
  assert.deepEqual(before,snapshot);
  assert.deepEqual(diffParametricSpec(before,after),[{field:'holeDiameter',label:'孔径',before:.14,after:.18,unit:'m'},{field:'pitchX',label:'孔距 X',before:.5,after:.55,unit:'m'}]);
  assert.deepEqual(diffParametricSpec(after,after),[]);
});

test('native templates keep true holes, exact volume and origin-centered local bounds',{skip:!available},async()=>{
  for(const id of PARAMETRIC_TEMPLATES.map(t=>t.id)){
    const spec=createParametricSpec(id),p=spec.parameters,recipe=compileParametricRecipe(spec),cad=await runCAD({action:'build',recipe});
    const volume=id==='l-bracket'?(p.legThickness*(p.width+p.height)-p.legThickness**2)*p.depth:id==='sleeve'?Math.PI*(p.outerRadius**2-p.innerRadius**2)*p.height:p.thickness*(p.width*p.height-Math.PI*p.holeDiameter**2);
    near(cad.volume,volume);assert.equal(cad.closed,true);assert.deepEqual(cad.recipe,recipe);
    cad.lower.forEach((v,k)=>near(v+cad.upper[k],0));
    assert.deepEqual(validateParametricPart({id:'native',modeling:spec,geometry:geometry(cad)}),spec);
  }
  for(const angle of [1,90,230]){
    const spec=createParametricSpec('sleeve',{angle}),cad=await runCAD({action:'build',recipe:compileParametricRecipe(spec)});
    near(cad.volume,Math.PI*(.4**2-.2**2)*.6*angle/360);
    cad.lower.forEach((v,k)=>near(v+cad.upper[k],0));
  }
});

test('parameter provenance survives JSON, part edits and legacy projections without entering physics',{skip:!available},async()=>{
  const modeling=createParametricSpec('l-bracket'),cad=await runCAD({action:'build',recipe:compileParametricRecipe(modeling)});
  const p=addProjectPart(emptyProject(),{id:'bracket',name:'支架',method:'mpm',modeling,geometry:geometry(cad)}),original=structuredClone(p);
  const moved=updateProjectPart(p,'bracket',{geometry:{center:[.4,1.1,.2],rotation:[20,30,15]},material:{density:1200}});
  for(const q of [normalizeProject(parseProjectText(JSON.stringify(moved))),normalizeSolverProject(moved),editLegacyProject(moved,legacy=>{legacy.coupling.parts[0].temperature=35;})]){
    assert.deepEqual(q.parts[0].modeling,modeling);assert.deepEqual(q.parts[0].geometry,moved.parts[0].geometry);assert.equal(q.parts[0].material.modeling,undefined);
  }
  const legacy=toLegacy(moved);assert.equal(legacy.coupling.parts[0].modeling,undefined);
  const scaled=updateProjectPart(moved,'bracket',{geometry:{size:moved.parts[0].geometry.size.map(x=>x*1.1)}});
  assert.deepEqual(normalizeSolverProject(scaled).parts[0].modeling,modeling);
  assert.deepEqual(editLegacyProject(scaled,m=>{m.coupling.parts[0].center=[.5,1.2,.3];}).parts[0].modeling,modeling);
  const stale=structuredClone(moved);stale.parts[0].modeling.parameters.width=.9;
  assert.throws(()=>normalizeProject(stale),error=>error.issues?.some(i=>i.code==='parametric.stale'&&i.target==='bracket'));
  problem(()=>updateProjectPart(moved,'bracket',{modeling:patchParametricSpec(modeling,{width:.9})}),'modeling');
  assert.equal(updateProjectPart(moved,'bracket',{modeling:null}).parts[0].modeling,undefined);
  const plain=updateProjectPart(moved,'bracket',{geometry:{shape:'box'}});assert.equal(plain.parts[0].modeling,undefined);
  const raw=structuredClone(cad);raw.recipe[0].center=[.01,0,0];
  assert.equal(updateProjectPart(moved,'bracket',{geometry:{cad:raw}}).parts[0].modeling,undefined);
  assert.equal(editLegacyProject(moved,m=>{m.coupling.parts[0].cad.recipe[0].center=[.01,0,0];}).parts[0].modeling,undefined);
  assert.deepEqual(p,original);
});

test('parametric CAD Tet4 part keeps its authoring model and native source through project JSON',{skip:!available},async()=>{
  const modeling=createParametricSpec('l-bracket'),mesh=await runCAD({action:'mesh',recipe:compileParametricRecipe(modeling),options:{kind:'volume',targetSize:.2}});
  const p=addProjectPart(emptyProject(),{...cadFEMOptions(mesh,{id:'bracket-fem'}),modeling}),round=validateFEM(normalizeProject(parseProjectText(JSON.stringify(p))));
  assert.deepEqual(round.parts[0].modeling,modeling);assert.deepEqual(round.parts[0].discretization.mesh.source.recipe,compileParametricRecipe(modeling));
  const moved=updateProjectPart(round,'bracket-fem',{geometry:{center:[.1,.8,.2],rotation:[0,0,20]},material:{young:2e5}});
  assert.deepEqual(moved.parts[0].modeling,modeling);assert.deepEqual(moved.parts[0].discretization.mesh,round.parts[0].discretization.mesh);
});
