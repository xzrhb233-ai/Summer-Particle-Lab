// Closed simple polygon profiles are defined in local coordinates. The final
// vertex connects to the first implicitly; holes are separate CSG differences.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function profileMetrics(profile){
  const lower=[Infinity,Infinity],upper=[-Infinity,-Infinity];
  for(const p of profile)for(let k=0;k<2;k++){lower[k]=Math.min(lower[k],p[k]);upper[k]=Math.max(upper[k],p[k]);}
  const spans=upper.map((v,k)=>v-lower[k]),scale=Math.max(1,...spans);
  return {lower,upper,spans,pointEps:1e-10*scale,crossEps:1e-10*scale*scale};
}
const onSegment=(p,a,b,pointEps,crossEps)=>Math.abs(cross(a,b,p))<=crossEps&&p[0]>=Math.min(a[0],b[0])-pointEps&&p[0]<=Math.max(a[0],b[0])+pointEps&&p[1]>=Math.min(a[1],b[1])-pointEps&&p[1]<=Math.max(a[1],b[1])+pointEps;
function intersects(a,b,c,d,pointEps,crossEps){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if((abC>crossEps&&abD< -crossEps||abC< -crossEps&&abD>crossEps)&&(cdA>crossEps&&cdB< -crossEps||cdA< -crossEps&&cdB>crossEps))return true;
  return onSegment(c,a,b,pointEps,crossEps)||onSegment(d,a,b,pointEps,crossEps)||onSegment(a,c,d,pointEps,crossEps)||onSegment(b,c,d,pointEps,crossEps);
}

export function validateCADProfile(profile,{radial=false}={}){
  if(!Array.isArray(profile)||profile.length<3||profile.length>32||!profile.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=6)))throw Error('CAD 轮廓须为 3–32 个二维顶点，坐标在 ±6 m 内，首尾自动闭合');
  if(radial&&profile.some(p=>p[0]<0))throw Error('旋转轮廓的半径 r 不得小于 0');
  const {spans,pointEps,crossEps}=profileMetrics(profile),n=profile.length;
  if(spans.some(v=>v<.01-1e-12||v>12+1e-12))throw Error('CAD 轮廓每轴跨度须为 0.01–12 m');
  let area2=0;
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++)if(Math.hypot(profile[i][0]-profile[j][0],profile[i][1]-profile[j][1])<=pointEps)throw Error('CAD 轮廓存在重复顶点；不要再次填写首点');
    const a=profile[(i+n-1)%n],b=profile[i],c=profile[(i+1)%n];
    if(Math.abs(cross(a,b,c))<=crossEps&&(a[0]-b[0])*(c[0]-b[0])+(a[1]-b[1])*(c[1]-b[1])>pointEps*pointEps)throw Error('CAD 轮廓相邻边不能回折重叠');
    area2+=b[0]*c[1]-c[0]*b[1];
  }
  if(Math.abs(area2)<=crossEps)throw Error('CAD 轮廓面积为零或过小');
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    if(j===i+1||i===0&&j===n-1)continue;
    if(intersects(profile[i],profile[(i+1)%n],profile[j],profile[(j+1)%n],pointEps,crossEps))throw Error('CAD 轮廓不能自交、相切或重叠');
  }
  return profile.map(p=>p.slice());
}

// Even-odd polygon membership with explicit inclusive edge/vertex tests. This
// evaluates the analytic profile, not display triangles or a convex hull.
export function compileCADProfile(input){
  const profile=validateCADProfile(input),{lower,upper,pointEps,crossEps}=profileMetrics(profile);
  return (x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<lower[0]-pointEps||x>upper[0]+pointEps||y<lower[1]-pointEps||y>upper[1]+pointEps)return false;
    const p=[x,y];let inside=false;
    for(let i=0,j=profile.length-1;i<profile.length;j=i++){
      const a=profile[j],b=profile[i];
      if(onSegment(p,a,b,pointEps,crossEps))return true;
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  };
}
