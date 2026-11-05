import test from 'node:test';
import assert from 'node:assert/strict';
import {gridAxes,gridSlice,projectCoordinate,nearestCoordinate,coordinateNumber} from '../src/three/grid-coordinates.js';
import {domainParameters} from '../src/three/discretization.js';
import {LENGTH} from '../src/multibody/coupling-model.js';

test('displayed SI nodes coincide with solver nodes and omit guard nodes at cut boundaries',()=>{
  const domain={lower:[-2.97,-.91,-1.93],upper:[2.91,2.97,1.89],cellSize:.2,particlesPerAxis:2};
  const solver=domainParameters({...domain,lower:domain.lower.map(x=>x/LENGTH),upper:domain.upper.map(x=>x/LENGTH),cellSize:domain.cellSize/LENGTH});
  for(const axis of [0,1,2])for(const index of [-100,0,100]){
    const slice=gridSlice(domain,axis,index);assert.ok(slice.points.length>0);
    for(const p of slice.points)for(let a=0;a<3;a++){
      assert.ok(p[a]>=domain.lower[a]-1e-9&&p[a]<=domain.upper[a]+1e-9);
      const i=(p[a]/LENGTH-solver.origin[a])/solver.cellSize;
      assert.ok(Math.abs(i-Math.round(i))<1e-10);
    }
    assert.ok(slice.points.every(p=>p[axis]===slice.value));
  }
});
test('all three slice orientations retain actual spacing, signed coordinates and domain changes',()=>{
  const d={lower:[-1,-.4,-.6],upper:[1,.8,.6],cellSize:.2};
  assert.deepEqual(gridAxes(d).map(a=>a.count),[11,7,7]);
  assert.equal(gridSlice(d,1,2).points.length,77);assert.equal(gridSlice(d,2,-2).value,-.4);
  assert.equal(gridSlice({...d,cellSize:.1},1,2).points.length,273);
  assert.equal(coordinateNumber(-1e-12),'0');assert.equal(coordinateNumber(.60000000000001),'0.6');
  assert.equal(gridAxes({...d,cellSize:0}),null);assert.equal(gridSlice(d,4,0),null);
});
test('labels use the same perspective projection and near/far clipping as both renderers',()=>{
  const b={eye:[0,0,10],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
  assert.deepEqual(projectCoordinate([0,0,0],b,800,600),{x:400,y:300,depth:10});
  const p=projectCoordinate([1,1,0],b,800,600);assert.ok(Math.abs(p.x-(400+30/Math.tan(Math.PI/8)))<1e-10);assert.ok(p.y<300);
  assert.equal(projectCoordinate([0,0,11],b,800,600),null);
  assert.equal(projectCoordinate([0,0,9.5],b,800,600,1,2000),null);
  assert.ok(projectCoordinate([0,0,9.5],b,800,600,.01,500));
  assert.equal(projectCoordinate([0,0,-500],b,800,600),null);
});
test('node picking has a finite pixel tolerance and returns the nearest displayed world coordinate',()=>{
  const points=[{x:10,y:20,point:[-.2,.4,.6]},{x:18,y:20,point:[0,.4,.6]}];
  assert.deepEqual(nearestCoordinate(points,17,21).point,[0,.4,.6]);assert.equal(nearestCoordinate(points,70,90),null);
});
