// Display-only temperature mapping. Frames are immutable, including replay.
const extents=new WeakMap();
export function temperatureExtent(frame,scope='global'){
  let cached=extents.get(frame);if(!cached){cached={};extents.set(frame,cached);}if(cached[scope])return cached[scope];
  let min=Infinity,max=-Infinity;const take=T=>{if(Number.isFinite(T)){min=Math.min(min,T);max=Math.max(max,T);}};
  for(const p of frame.fem?.parts??[])for(const T of p.temperature??[])take(T);
  if(scope==='global'){
    for(let i=4;i<(frame.particles?.length??0);i+=8)take(frame.particles[i]);
    for(const b of frame.bodies??[])take(b.temperature);
  }
  return cached[scope]=Number.isFinite(min)?{min,max,span:max-min}:{min:0,max:0,span:0};
}
export function temperatureScale(frame,settings={}){
  const mode=['global','fem','manual'].includes(settings.temperatureMode)?settings.temperatureMode:'global';
  const actual=temperatureExtent(frame,mode==='fem'?'fem':'global');
  const valid=mode!=='manual'||(Number.isFinite(settings.temperatureMin)&&Number.isFinite(settings.temperatureMax)&&settings.temperatureMax>settings.temperatureMin);
  let {min,max}=mode==='manual'&&valid?{min:settings.temperatureMin,max:settings.temperatureMax}:actual;
  // Equal/near-equal temperatures must not turn roundoff into a rainbow.
  if(mode!=='manual'||!valid){const span=mode==='fem'?1e-6:1;if(max-min<span){const mid=(min+max)/2;min=mid-span/2;max=mid+span/2;}}
  return {mode,min,max,actual,valid};
}
export const temperatureFraction=(T,range)=>Math.max(0,Math.min(1,(T-range.min)/(range.max-range.min)));
export function temperatureColor(T,range){const v=temperatureFraction(T,range);return v<.5?[.12+.26*v,.30+1.12*v,.85-.5*v]:[.25+1.5*(v-.5),.86-1.26*(v-.5),.60-1.04*(v-.5)];}
export const temperaturePaletteGLSL=`vec3 temperaturePalette(float v){v=clamp(v,0.,1.);return v<.5?vec3(.12+.26*v,.30+1.12*v,.85-.5*v):vec3(.25+1.5*(v-.5),.86-1.26*(v-.5),.60-1.04*(v-.5));}`;
