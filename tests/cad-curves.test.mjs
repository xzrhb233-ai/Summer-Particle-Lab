import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const generate=spec=>runCAD({action:'curve',spec});
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);
const pointNear=(actual,expected)=>actual.forEach((x,k)=>near(x,expected[k]));

test('native SMLib line, circle and rotated arc preserve endpoints and analytic length',{skip:!available},async()=>{
  const line=await generate({kind:'line',points:[[.2,.1,.3],[.2,.4,.7]],samples:8});
  assert.equal(line.schema,'summer-cad-curve/1');assert.equal(line.kernel,'SMLib');
  assert.equal(line.points.length,9);assert.equal(line.closed,false);near(line.length,.5);
  pointNear(line.points[0],[.2,.1,.3]);pointNear(line.points.at(-1),[.2,.4,.7]);
  const circle=await generate({kind:'circle',center:[.3,.5,.2],radius:.2});
  assert.equal(circle.closed,true);assert.equal(circle.points.length,65);near(circle.length,2*Math.PI*.2);
  assert.equal(circle.boundsApproximate,true);assert.deepEqual(circle.spec.rotation,[0,0,0]);
  circle.points.forEach(p=>{near(Math.hypot(p[0]-.3,p[1]-.5),.2);near(p[2],.2);});
  const arc=await generate({kind:'arc',center:[0,1,0],radius:.5,startAngle:0,endAngle:180,rotation:[90,0,0],samples:64});
  assert.equal(arc.closed,false);near(arc.length,Math.PI*.5);
  pointNear(arc.points[0],[.5,1,0]);pointNear(arc.points[32],[0,1,.5]);pointNear(arc.points.at(-1),[-.5,1,0]);
});

test('native SMLib Bezier and clamped B-spline evaluate control-point definitions',{skip:!available},async()=>{
  const controlPoints=[[0,0,0],[0,1,0],[1,1,0],[1,0,0]];
  const bezier=await generate({kind:'bezier',controlPoints,samples:64});
  pointNear(bezier.points[0],controlPoints[0]);pointNear(bezier.points[32],[.5,.75,0]);
  pointNear(bezier.points.at(-1),controlPoints.at(-1));near(bezier.length,2);
  const bspline=await generate({kind:'bspline',controlPoints,degree:3,samples:64});
  bezier.points.forEach((p,i)=>pointNear(p,bspline.points[i]));near(bspline.length,bezier.length);
  const polyline=await generate({kind:'bspline',controlPoints:[[0,0,0],[1,0,0],[1,1,0]],degree:1,samples:64});
  pointNear(polyline.points[32],[1,0,0]);near(polyline.length,2);
});

test('curve definitions reject malformed, degenerate and unbounded requests before native evaluation',{skip:!available},async()=>{
  const good={kind:'line',points:[[0,0,0],[1,0,0]],samples:64};
  for(const spec of [null,{...good,path:'C:/untrusted'}, {...good,samples:10000}, {...good,samples:64.5},
    {...good,points:[[0,0,0],[0,0,0]]}, {...good,points:[[0,0,0],[101,0,0]]},
    {kind:'bezier',controlPoints:Array.from({length:10},(_,i)=>[i,0,0])},
    {kind:'bspline',controlPoints:[[0,0,0],[1,0,0]],degree:3},
    {kind:'circle',center:[0,0,0],radius:0},
    {kind:'arc',center:[0,0,0],radius:1,startAngle:0,endAngle:360},
    {kind:'arc',center:[0,0,0],radius:1,startAngle:180,endAngle:0}
  ]) await assert.rejects(generate(spec),/SMLib/);
  await assert.rejects(runCAD({action:'curve',spec:good,path:'C:/untrusted'}),/SMLib/);
});
