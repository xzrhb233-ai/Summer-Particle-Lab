import {PRESSURE_DEFAULTS,PRESSURE_LIMITS,pressureParameters} from './pressure-plasticity.js';
export function installPressureControls(){
  const $=id=>document.getElementById(id),panel=document.createElement('div');panel.id='pressure-material-controls';panel.hidden=true;
  const fields=[['cohesion','黏聚截距 k/E',.005,8],['slope','压力系数 qφ',.05,8],['dilatancy','剪胀系数 qψ',.05,8],['tension','拉伸上限 σt/E',.005,8],['alpha','泡沫屈服形状 α',.05,9],['plateau','初始平台强度 σp/E',.005,9],['gamma','线性压密系数 γ/E',.005,9],['densify','非线性压密系数 α₂/E',.005,9],['beta','压密指数 β',.1,9],['epsD','压密应变 εD',.05,9]];
  panel.innerHTML=`<p class="hint">以下强度为 Cauchy 应力除以 E。参数用于新建部件；塑性体积变化会保留。</p><div class="plasticity-fields">${fields.map(([k,label,step,model])=>`<div data-pressure-model="${model}"><label for="pressure-${k}3">${label}</label><input id="pressure-${k}3" type="number" min="${PRESSURE_LIMITS[k][0]}" max="${PRESSURE_LIMITS[k][1]}" step="${step}" value="${PRESSURE_DEFAULTS[k]}"></div>`).join('')}</div><p id="pressure-formula3" class="hint"></p><p id="pressure-note3" class="hint"></p><p id="pressure-error3" role="status" hidden>参数无效：qψ ≤ qφ，且 qφ × σt/E ≤ k/E；其余参数须在范围内。</p><button id="pressure-reset3">恢复岩土与泡沫参数</button>`;
  $('plasticity-controls').after(panel);
  function values(){return Object.fromEntries(fields.map(([k,,,model])=>[k,Number($('model3').value)===model?$('pressure-'+k+'3').valueAsNumber:PRESSURE_DEFAULTS[k]]));}
  function validate(){$('pressure-error3').hidden=!!pressureParameters(values());}
  for(const [k] of fields)$('pressure-'+k+'3').oninput=validate;
  $('pressure-reset3').onclick=()=>{for(const [k] of fields)$('pressure-'+k+'3').value=PRESSURE_DEFAULTS[k];validate();};
  return {values,update(custom,model){panel.hidden=!custom||model<8||model>=10;for(const row of panel.querySelectorAll('[data-pressure-model]'))row.hidden=Number(row.dataset.pressureModel)!==model;
    $('pressure-formula3').textContent=model===8?'√J₂ + qφ σm ≤ k；σm ≤ σt':'σ̂² = (σeq² + α²σm²) / (1 + α²/9)';
    $('pressure-note3').textContent=model===8?'拉应力为正；qψ 控制非关联剪胀。拉伸截断是塑性限制，不会删除粒子或生成裂纹。':'关联塑性流动与压密强化；累积量为功共轭等效塑性应变。保留永久压缩，不包含体积失效、孔隙成核或断裂。';validate();
  }};
}
