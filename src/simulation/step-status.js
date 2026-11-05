// Report backend limits separately from the editable user request.
export function stepStatus({requested,draft=requested,clock,dynamics,en=false}){
  const t=(zh,english)=>en?english:zh,fmt=v=>Number.isFinite(v)&&v>0?v.toExponential(3)+' s':'—';
  const base=clock?.baseDt??dynamics?.dt,accepted=clock?.requestedDt??dynamics?.requestedDt;
  const labels={requested:['用户上限','User maximum'],fem:['FEM 积分上限（含稳定性与载荷限制）','FEM integration limit (stability and loads)'],thermal:['热扩散上限','Thermal diffusion limit'],mpm:['MPM 网格上限','MPM grid limit'],fourMethodPolicy:['四方法 GPU 当前策略上限','Current four-method GPU policy limit']};
  const limits=clock?.stepLimits??{};
  const reasons=Object.entries(limits).filter(([key,value])=>key!=='requested'&&Number.isFinite(value)&&value>0&&Number.isFinite(base)&&value<=base*(1+1e-8)).map(([key])=>labels[key]?t(...labels[key]):key);
  let status=t('已提交上限：','Submitted maximum: ')+fmt(requested)+t('；求解器基础步长：','; solver base step: ')+fmt(base);
  if(Math.abs(draft-requested)>1e-12||!Number.isFinite(draft))status=t('输入值尚未应用，请点击“应用时间步并重置”。','Edited value is not applied. Click “Apply step & reset”.')+'\n'+status;
  if(Number.isFinite(accepted)&&Math.abs(accepted-requested)>1e-12)status+='\n'+t('后端回传的请求值与项目不一致，请重新应用并检查连接。','Backend request differs from the project; reapply and check the connection.');
  if(Number.isFinite(base)&&base<requested*(1-1e-8))status+='\n'+t('当前受限于：','Currently limited by: ')+(reasons.join(' / ')||t('后端限制（旧服务未提供具体原因）','Backend limit (legacy service did not report a reason)'))+t('。继续增大输入值不会增大实际步长。','. Increasing the input further will not increase the actual step.');
  const detail=Object.entries(limits).map(([key,value])=>(labels[key]?t(...labels[key]):key)+': '+fmt(value)).join('\n');
  return {status,detail};
}
