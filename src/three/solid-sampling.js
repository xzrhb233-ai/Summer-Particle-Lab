import { det,clamp } from './math.js';

// Quadrature-quality regularization, not a constitutive force or a PBF solve.
// The radius follows volumetric compaction; plastic shear can still change shape.
export function solidSpacing(s,i){
  const model=s.model[i],jp=model===2||model===8||model===9?s.mpm.Jp[i]:1;
  return 2.8*Math.cbrt(clamp(s.volume[i]*det(s.mpm.F.subarray(i*9,i*9+9))*jp,.015625,8));
}

export function regularizeSolids(s,dt,gridSize=67){
  if(!s.settings.solidAntiClump)return;
  s.buildGrid();
  s.dx.fill(0,0,s.count);s.dy.fill(0,0,s.count);s.dz.fill(0,0,s.count);
  for(let i=0;i<s.count;i++)s.gx[i]=s.isSolid(i)?solidSpacing(s,i):0;
  const gain=1-Math.exp(-40*dt);
  for(let i=0;i<s.count;i++)if(s.isSolid(i)){
    const cell=s.cell[i],ri=s.gx[i];
    for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(let j=s.head[cell+z*gridSize*gridSize+y*gridSize+x];j>=0;j=s.next[j]){
      if(j<=i||!s.isSolid(j)||s.lab.part[i]!==s.lab.part[j])continue;
      const total=s.invMass[i]+s.invMass[j];if(!total)continue;
      let dx=s.x[i]-s.x[j],dy=s.y[i]-s.y[j],dz=s.z[i]-s.z[j],r=Math.hypot(dx,dy,dz);
      const target=(ri+s.gx[j])*.5;if(r>=target)continue;
      if(r<1e-8){
        // Deterministic, non-axis-aligned direction for an exactly coincident pair.
        const hash=((Math.imul(i+1,73856093)^Math.imul(j+1,19349663))>>>0);
        dx=(hash&1023)/511.5-1;dy=((hash>>>10)&1023)/511.5-1;dz=((hash>>>20)&1023)/511.5-1;r=Math.hypot(dx,dy,dz);
        const q=target*gain/(r*total);dx*=q;dy*=q;dz*=q;
      }else{const q=(target-r)*gain/(r*total);dx*=q;dy*=q;dz*=q;}
      s.dx[i]+=dx*s.invMass[i];s.dy[i]+=dy*s.invMass[i];s.dz[i]+=dz*s.invMass[i];
      s.dx[j]-=dx*s.invMass[j];s.dy[j]-=dy*s.invMass[j];s.dz[j]-=dz*s.invMass[j];
    }
  }
  let scale=1;const budget=8*dt;
  for(let i=0;i<s.count;i++)scale=Math.max(scale,Math.hypot(s.dx[i],s.dy[i],s.dz[i])/budget);
  for(let i=0;i<s.count;i++)if(s.isSolid(i)&&!s.pinned[i]){
    // Applied AFTER velocity/contact reconstruction: redistribution must never
    // turn into a correction/dt impulse, especially immediately before melting.
    s.x[i]=clamp(s.x[i]+s.dx[i]/scale,s.boundsLo[0],s.boundsHi[0]);
    s.y[i]=clamp(s.y[i]+s.dy[i]/scale,s.boundsLo[1],s.press.enabled?Math.min(s.boundsHi[1],s.press.y-1.8):s.boundsHi[1]);
    s.z[i]=clamp(s.z[i]+s.dz[i]/scale,s.boundsLo[2],s.boundsHi[2]);
  }
}
