import {PLASTICITY_DEFAULTS,PLASTICITY_LIMITS,plasticityParameters} from './metal-plasticity.js';
export function installPlasticityControls(){
  const $=id=>document.getElementById(id),panel=document.createElement('div');panel.id='plasticity-controls';panel.hidden=true;
  const fields=[['A','初始屈服 A/E',.001],['B','强化系数 B/E（线性模型为 H/E）',.01],['n','硬化指数 n',.05],['C','应变率系数 C',.005],['rate0','参考应变率（1/s）',.1],['Tref','参考温度（°C）',10],['Tm','软化终点温度（°C）',10],['m','热软化指数 m',.1]];
  panel.innerHTML=`<p class="hint">强度除以当前杨氏模量 E；不是 Pa。参数只用于新建部件，各部件独立保存。</p><div class="plasticity-fields">${fields.map(([k,label,step])=>`<div data-parameter="${k}"><label for="plasticity-${k}3">${label}</label><input id="plasticity-${k}3" type="number" min="${PLASTICITY_LIMITS[k][0]}" max="${PLASTICITY_LIMITS[k][1]}" step="${step}" value="${PLASTICITY_DEFAULTS[k]}"></div>`).join('')}</div><p id="plasticity-formula3" class="hint"></p><p class="hint" id="plasticity-note3"></p><p id="plasticity-error3" role="status" hidden>参数无效：请检查数值范围，软化终点必须高于参考温度。</p><button id="plasticity-reset3" type="button">恢复本构默认参数</button>`;
  $('friction-controls').after(panel);
  function values(){return Object.fromEntries(fields.map(([k])=>[k,$('plasticity-'+k+'3').closest('[data-parameter]').hidden?PLASTICITY_DEFAULTS[k]:$('plasticity-'+k+'3').valueAsNumber]));}
  function validate(){const valid=!!plasticityParameters(values());$('plasticity-error3').hidden=valid;return valid;}
  for(const [k] of fields)$('plasticity-'+k+'3').oninput=validate;
  $('plasticity-reset3').onclick=()=>{for(const [k] of fields)$('plasticity-'+k+'3').value=PLASTICITY_DEFAULTS[k];validate();};
  return {values,update(custom,model){
    panel.hidden=!custom||model<4||model>=8;
    for(const row of panel.querySelectorAll('[data-parameter]')){const k=row.dataset.parameter;row.hidden=k==='B'?model===4:['n','C','rate0'].includes(k)?model<6:['Tref','Tm','m'].includes(k)?model!==6:false;}
    $('plasticity-formula3').textContent=model===4?'σy/E = A/E':model===5?'σy/E = A/E + (H/E) εp':model===6?'σy/E = (A/E + B/E · εpⁿ)(1 + C ln r)(1 − T*ᵐ)':'σy/E = (A/E + B/E · εpⁿ)(1 + C ln r)';
    $('plasticity-note3').textContent=model<6?'J2 等容塑性；累积量为等效塑性应变。':model===6?'r 最低为 1。温度来自粒子热场；软化终点只消除剪切屈服强度，不触发熔化。暂不计算塑性耗散生热。':'r 最低为 1。简化模型忽略温度软化；仍参与接触传热。';
    validate();
  }};
}
