// Bounded, seeded position noise applied once at creation, never during stepping.
export function samplingOptions(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const p={enabled:false,strength:.2,seed:42,...input};
  if(Object.keys(input).some(k=>!['enabled','strength','seed'].includes(k))||typeof p.enabled!=='boolean'||!Number.isFinite(p.strength)||p.strength<0||p.strength>.35||!Number.isInteger(p.seed)||p.seed<0||p.seed>2147483647)return null;
  return p;
}
function random(seed,index,attempt,axis){
  let h=(seed+Math.imul(index+1,0x9e3779b9)+Math.imul(attempt*3+axis+1,0x85ebca6b))>>>0;
  h=Math.imul(h^(h>>>16),0x7feb352d)>>>0;h=Math.imul(h^(h>>>15),0x846ca68b)>>>0;
  return ((h^(h>>>16))>>>0)/4294967296*2-1;
}
export function jitterPoint(p,index,lo,hi,shape,fixed,options,spacing=4){
  if(!options.enabled||options.strength===0)return p;
  const amplitude=spacing*options.strength;
  for(let attempt=0;attempt<8;attempt++){
    const d=[0,1,2].map(a=>fixed&&a===0?0:random(options.seed,index,attempt,a));
    const scale=amplitude/Math.max(1,Math.hypot(...d));
    const candidate=p.map((v,a)=>{
      let x=v+d[a]*scale;
      // Reflect instead of clamping many particles onto the same surface.
      if(x<lo[a])x=2*lo[a]-x;if(x>hi[a])x=2*hi[a]-x;
      return x;
    });
    const q=candidate.map((v,a)=>(v-(lo[a]+hi[a])/2)/((hi[a]-lo[a])/2));
    if(shape==='box'||(shape==='ellipsoid'?q[0]**2+q[1]**2+q[2]**2:q[0]**2+q[2]**2)<=1+1e-12)return candidate;
  }
  return p; // Keep the sample and its mass when no in-domain candidate is found.
}
