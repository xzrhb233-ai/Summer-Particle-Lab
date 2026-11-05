import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {runCAD} from '../cad-server.mjs';

const available=existsSync(new URL(process.platform==='win32'?'../.venv-cad/Scripts/python.exe':'../.venv-cad/bin/python',import.meta.url));
const generate=spec=>runCAD({action:'surface',spec});
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} differs from ${b}`);
const vecNear=(a,b,tol=1e-7)=>a.forEach((x,k)=>near(x,b[k],tol));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const grid=(rows,cols,fn)=>Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>fn(i,j)));
const flat={kind:'bilinear',controlPoints:[[[0,0,0],[0,3,6]],[[2,0,2],[2,3,8]]],segmentsU:4,segmentsV:8};

test('native SMLib bilinear surface preserves U/V corners, exact planar area, orientation and open topology',{skip:!available},async()=>{
  const s=await generate(flat);
  assert.equal(s.schema,'summer-cad-surface/1');assert.equal(s.kernel,'SMLib');assert.equal(s.closed,false);
  assert.equal(s.degreeU,1);assert.equal(s.degreeV,1);assert.equal(s.areaApproximate,true);assert.equal(s.boundsApproximate,true);
  assert.equal(s.nodes.length,5*9);assert.equal(s.elements.length,4*8*2);
  vecNear(s.nodes[0],flat.controlPoints[0][0]);vecNear(s.nodes[8],flat.controlPoints[0][1]);
  vecNear(s.nodes[4*9],flat.controlPoints[1][0]);vecNear(s.nodes.at(-1),flat.controlPoints[1][1]);
  near(s.area,6*Math.sqrt(6));
  for(const n of s.normals)vecNear(n,[-1/Math.sqrt(6),-2/Math.sqrt(6),1/Math.sqrt(6)]);
  const edges=new Map();
  for(const triangle of s.elements){
    const [a,b,c]=triangle.map(i=>s.nodes[i]),normal=cross(b.map((v,k)=>v-a[k]),c.map((v,k)=>v-a[k]));
    assert.ok(normal.reduce((sum,v,k)=>sum+v*s.normals[triangle[0]][k],0)>0);
    for(let k=0;k<3;k++){const a=triangle[k],b=triangle[(k+1)%3],key=[a,b].sort((x,y)=>x-y).join(',');edges.set(key,[...(edges.get(key)??[]),[a,b]]);}
  }
  assert.equal([...edges.values()].filter(e=>e.length===1).length,2*(4+8));
  for(const adjacent of edges.values()){assert.ok(adjacent.length<=2);if(adjacent.length===2)assert.deepEqual(adjacent[0],[adjacent[1][1],adjacent[1][0]]);}
});

test('native bicubic Bezier evaluates analytic saddle coordinates and normals; sampled area converges',{skip:!available},async()=>{
  const controlPoints=grid(4,4,(i,j)=>[i/3,j/3,i*j/9]);
  const coarse=await generate({kind:'bezier',controlPoints,segmentsU:4,segmentsV:4}),fine=await generate({kind:'bezier',controlPoints,segmentsU:32,segmentsV:32});
  assert.equal(fine.degreeU,3);assert.equal(fine.degreeV,3);
  for(let i=0;i<=32;i++)for(let j=0;j<=32;j++){
    const u=i/32,v=j/32,n=Math.sqrt(1+u*u+v*v),k=i*33+j;
    vecNear(fine.nodes[k],[u,v,u*v]);vecNear(fine.normals[k],[-v/n,-u/n,1/n]);
  }
  // Independent tensor-product Simpson quadrature of |du x dv| for z = uv.
  const n=128;let reference=0;
  for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)reference+=(i===0||i===n?1:i%2?4:2)*(j===0||j===n?1:j%2?4:2)*Math.sqrt(1+(i/n)**2+(j/n)**2);
  reference/=9*n*n;assert.ok(Math.abs(fine.area-reference)<Math.abs(coarse.area-reference));near(fine.area,reference,5e-4);
});

function basis(count,t){
  if(t===1)return Array.from({length:count},(_,i)=>Number(i===count-1));
  const inner=count-4,knots=[0,0,0,0,...Array.from({length:inner},(_,i)=>(i+1)/(inner+1)),1,1,1,1];
  const N=(i,p)=>{
    if(!p)return Number(t>=knots[i]&&t<knots[i+1]);
    const a=knots[i+p]-knots[i],b=knots[i+p+1]-knots[i+1];
    return (a?(t-knots[i])/a*N(i,p-1):0)+(b?(knots[i+p+1]-t)/b*N(i+1,p-1):0);
  };return Array.from({length:count},(_,i)=>N(i,3));
}
test('native rectangular bicubic B-spline follows a clamped uniform tensor-product control grid',{skip:!available},async()=>{
  const controlPoints=grid(5,6,(i,j)=>[i/4,j/5,.1*Math.sin(i+.5*j)]),s=await generate({kind:'bspline',controlPoints,segmentsU:8,segmentsV:8});
  for(const i of [0,2,4,6,8])for(const j of [0,2,4,6,8]){
    const bu=basis(5,i/8),bv=basis(6,j/8),expected=[0,0,0];
    for(let u=0;u<5;u++)for(let v=0;v<6;v++)for(let k=0;k<3;k++)expected[k]+=bu[u]*bv[v]*controlPoints[u][v][k];
    vecNear(s.nodes[i*9+j],expected);
  }
  const same=grid(4,4,(i,j)=>[i/3,j/3,.1*Math.cos(i+j)]),b=await generate({kind:'bezier',controlPoints:same,segmentsU:4,segmentsV:4}),n=await generate({kind:'bspline',controlPoints:same,segmentsU:4,segmentsV:4});
  b.nodes.forEach((p,i)=>vecNear(p,n.nodes[i]));near(b.area,n.area);
});

test('surface worker rejects unsupported degrees, invalid grids, unbounded requests and degenerate patches',{skip:!available},async()=>{
  for(const spec of [null,{...flat,degreeU:2},{...flat,script:'print(1)'},{...flat,segmentsU:128},{...flat,segmentsV:4.1},{...flat,segmentsU:true},
    {...flat,controlPoints:[flat.controlPoints[0]]},{...flat,controlPoints:[flat.controlPoints[0],[[1,1,1]]]},{...flat,controlPoints:[[[101,0,0],[0,1,0]],[[1,0,0],[1,1,0]]]},
    {kind:'bezier',controlPoints:grid(3,3,(i,j)=>[i,j,0])},{kind:'bspline',controlPoints:grid(9,4,(i,j)=>[i,j,0])},
    {...flat,controlPoints:grid(2,2,()=>[0,0,0])},{...flat,controlPoints:grid(2,2,(i,j)=>[i+j,0,0])},
    {kind:'bezier',controlPoints:grid(4,4,(i,j)=>[i===0?0:i/3,j===0?0:j===1?0:j/3,0])}
  ])await assert.rejects(generate(spec),/SMLib/);
  await assert.rejects(runCAD({action:'surface',spec:flat,path:'C:/untrusted'}),/SMLib/);
});
