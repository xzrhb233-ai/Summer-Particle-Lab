// Editable local-space display primitives. Mass/contact still use the body's
// explicitly selected collision primitive; decorative geometry adds no mass.
export function appearance(input){
  if(input==null)return null;
  if(!Array.isArray(input)||input.length>160)throw Error('组合外形最多 160 个基础体');
  const vector=(v,positive=false,limit=100)=>{
    if(!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>limit||(positive&&x<.001)))throw Error('组合外形坐标或尺寸无效');return v.slice();
  };
  return input.map(p=>{
    if(!p||!['box','sphere','cylinder','cone','torus'].includes(p.shape)||!/^#[\da-f]{6}$/i.test(p.color??''))throw Error('组合外形基础体或颜色无效');
    return {shape:p.shape,position:vector(p.position??[0,0,0]),size:vector(p.size,true),rotation:vector(p.rotation??[0,0,0],false,360),color:p.color};
  });
}
