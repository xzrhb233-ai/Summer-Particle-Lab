export const GRAVITY_DEFAULTS={gravityMode:'scene',gravityStrength:1,gravityDirection:'down',gravityCenter:[0,0,0],gravitySoftening:8};
export const DIRECTIONS={down:[0,-1,0],up:[0,1,0],left:[-1,0,0],right:[1,0,0],front:[0,0,1],back:[0,0,-1]};
export function gravityMode(settings,scene){
  if(!settings.gravity||settings.gravityStrength===0)return 'none';
  return settings.gravityMode==='scene'?(scene==='planet'?'self':scene==='million'?'none':'uniform'):settings.gravityMode;
}
export function gravityAcceleration(settings,mode,x,y,z,steam=false){
  const strength=settings.gravityStrength;
  if(mode==='uniform')return DIRECTIONS[settings.gravityDirection].map(v=>v*strength*(steam?-8:24));
  if(mode==='attract'||mode==='repel'){
    const d=[settings.gravityCenter[0]-x,settings.gravityCenter[1]-y,settings.gravityCenter[2]-z];
    const scale=(mode==='repel'?-1:1)*24000*strength/(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]+settings.gravitySoftening**2)**1.5;
    return d.map(v=>v*scale);
  }
  return [0,0,0];
}
export function updateGravity(settings,value,allowSelf=false){
  const modes=['scene','none','uniform','attract','repel',...(allowSelf?['self']:[])];
  if(modes.includes(value.gravityMode))settings.gravityMode=value.gravityMode;
  if(Object.hasOwn(DIRECTIONS,value.gravityDirection))settings.gravityDirection=value.gravityDirection;
  for(const [key,lo,hi] of [['gravityStrength',0,4],['gravitySoftening',4,32]])if(Number.isFinite(value[key]))settings[key]=Math.min(hi,Math.max(lo,value[key]));
  if(Array.isArray(value.gravityCenter)&&value.gravityCenter.length===3&&value.gravityCenter.every(Number.isFinite))settings.gravityCenter=value.gravityCenter.map(v=>Math.min(240,Math.max(-240,v)));
}
