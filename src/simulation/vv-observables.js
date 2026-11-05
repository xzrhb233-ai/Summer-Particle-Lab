import {configurationId} from './workspace-context.js';
export const VV_OBSERVABLES=Object.freeze([
  {id:'tipY',label:'首个受载面平均 Y 位移',quantity:'loaded-surface-mean-displacement-y',unit:'m'},
  {id:'maxDisplacement',label:'部件最大位移幅值',quantity:'maximum-displacement-magnitude',unit:'m'},
  {id:'temperature',label:'部件热容加权平均温度',quantity:'capacity-weighted-mean-temperature',unit:'degC'},
  {id:'maxTemperature',label:'部件最高温度',quantity:'maximum-temperature',unit:'degC'},
]);
export function simulationSeries({project,resultProject,frame,history},partId,field){
  const definition=VV_OBSERVABLES.find(f=>f.id===field);if(!definition)throw Error('未知验证观测量');
  if(!project||!resultProject||!frame||frame.preview||frame.fem?.analysis==='linear-static'&&!frame.fem.solved)throw Error('请先求解，再对照已有结果');
  const id=configurationId(resultProject);if(configurationId(project)!==id)throw Error('结果来自旧配置，请恢复其模型或重新求解');
  const p=resultProject.parts.find(p=>p.id===partId);if(!p)throw Error('观测部件不存在');
  // Definitions differ across solvers. Do not silently equate a particle mass
  // mean with the FEM capacity mean or a body pose with a nodal maximum.
  if(p.method!=='fem')throw Error('当前实验时程入口限定 FEM 已记录量，其他方法尚未统一测量定义');
  const ids=new WeakMap(),points=[],seen=new Set();let omitted=0;
  for(const item of history??[]){const f=item.frame??item,origin=item.frame?item.resultProject:resultProject;
    if(origin&&!ids.has(origin))ids.set(origin,configurationId(origin));
    if(!origin||ids.get(origin)!==id||f.preview||f.fem?.analysis==='linear-static'&&!f.fem.solved||!Number.isFinite(f.time)||f.time>frame.time+1e-9){omitted++;continue;}
    const s=f.fem?.parts?.find(p=>p.id===partId)?.summary??f.results?.parts?.find(p=>p.id===partId)?.values;
    const value=field==='tipY'?s?.tip?.[1]:s?.[field];if(!Number.isFinite(value)||seen.has(f.time)){omitted++;continue;}
    seen.add(f.time);points.push({time:f.time,value});
  }
  points.sort((a,b)=>a.time-b.time);if(points.length<2)throw Error('该观测量不足两个有效时刻，不能做实验时程对标');
  return {kind:'simulation',quantity:definition.quantity,unit:definition.unit,timeUnit:'s',partId,field,configurationId:id,points,omittedSamples:omitted,definition:definition.label,reference:'undeformed geometry / SI / recorded solver states',uncertaintyKind:null};
}
