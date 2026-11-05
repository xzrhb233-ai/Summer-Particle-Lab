const step=(operation,shape,center,size)=>({operation,shape,center,size,rotation:[0,0,0]});

export const CAD_TEMPLATES=Object.freeze([
  {id:'through-hole',label:'贯通孔块',name:'SMLib 打孔块',description:'中心 (0, 0.7, 0) m；块体 0.8 × 0.5 × 0.6 m；Y 向孔径 0.3 m。'},
  {id:'pipe',label:'空心管',name:'SMLib 空心管',description:'中心 (0, 0.7, 0) m；Y 向高度 0.7 m；外径 0.6 m，内径 0.32 m。'},
  {id:'l-bracket',label:'L 形支架',name:'SMLib L 形支架',description:'底板中心 (0, 0.45, 0) m、尺寸 0.8 × 0.16 × 0.5 m；立板中心 (−0.3, 0.7, 0) m、尺寸 0.2 × 0.6 × 0.5 m。'},
  {id:'four-hole-plate',label:'四孔板',name:'SMLib 四孔板',description:'中心 (0, 0.7, 0) m；板体 0.9 × 0.16 × 0.7 m；4 个 Y 向孔径 0.14 m，孔中心 X = ±0.25、Z = ±0.2 m。'},
  {id:'extruded-l-bracket',label:'轮廓拉伸 · L 形支架',name:'SMLib 拉伸 L 形支架',description:'偏移 (0, 0.7, 0) m；XY 六点 L 形轮廓，外宽 0.8 m、外高 0.6 m、腿厚 0.2 m；沿局部 Z 对称拉伸 0.5 m。'},
  {id:'revolved-sleeve',label:'轮廓旋转 · 空心套筒',name:'SMLib 旋转套筒',description:'偏移 (0, 0.7, 0) m；轮廓半径 r = 0.2–0.4 m、高度 y = −0.3–0.3 m；绕局部 +Y 旋转 360°，内径 0.4 m、外径 0.8 m、高 0.6 m。'}
]);

export function createCADTemplate(id){
  const template=CAD_TEMPLATES.find(t=>t.id===id);if(!template)throw Error('未知 CAD 模板');
  let recipe;
  if(id==='through-hole')recipe=[step('base','box',[0,.7,0],[.8,.5,.6]),step('difference','cylinder',[0,.7,0],[.3,.8,.3])];
  else if(id==='pipe')recipe=[step('base','cylinder',[0,.7,0],[.6,.7,.6]),step('difference','cylinder',[0,.7,0],[.32,.9,.32])];
  else if(id==='l-bracket')recipe=[step('base','box',[0,.45,0],[.8,.16,.5]),step('union','box',[-.3,.7,0],[.2,.6,.5])];
  else if(id==='extruded-l-bracket')recipe=[{shape:'extrude',operation:'base',center:[0,.7,0],profile:[[-.4,-.3],[.4,-.3],[.4,-.1],[-.2,-.1],[-.2,.3],[-.4,.3]],depth:.5,rotation:[0,0,0]}];
  else if(id==='revolved-sleeve')recipe=[{shape:'revolve',operation:'base',center:[0,.7,0],profile:[[.2,-.3],[.4,-.3],[.4,.3],[.2,.3]],angle:360,rotation:[0,0,0]}];
  else recipe=[step('base','box',[0,.7,0],[.9,.16,.7]),...[-.25,.25].flatMap(x=>[-.2,.2].map(z=>step('difference','cylinder',[x,.7,z],[.14,.4,.14])))];
  return {...template,recipe};
}

export function moveCADStep(recipe,index,direction){
  const target=index+direction;
  if(!Number.isInteger(index)||![-1,1].includes(direction)||index<=0||index>=recipe.length||target<=0||target>=recipe.length)throw Error('初始实体固定在第一步，仅后续步骤可以上下移动');
  const next=structuredClone(recipe);[next[index],next[target]]=[next[target],next[index]];return next;
}

export function deleteCADStep(recipe,index){
  if(!Number.isInteger(index)||index<=0||index>=recipe.length)throw Error('初始实体不能删除；请修改其参数或载入其他模板');
  return recipe.filter((_,i)=>i!==index).map(r=>structuredClone(r));
}
