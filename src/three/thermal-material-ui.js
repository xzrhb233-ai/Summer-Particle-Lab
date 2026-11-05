import {THERMAL_DEFAULTS as D,THERMAL_LIMITS as L,thermalParameters} from './thermal-plasticity.js';
export function installThermalMaterialControls(){
  const $=id=>document.getElementById(id),panel=document.createElement('div');panel.id='thermal-material-controls';panel.hidden=true;
  const fields=[['Tref','参考温度 Tref °C',1,0],['Thot','热软化终点 Thot °C',1,10],['hotRatio','高温残余强度比',.01,10],['A','冷态屈服 A/E',.005,10],['H','冷态硬化 H/E',.01,10],['rate','参考蠕变率 1/s',.0001,11],['Q','活化能 Q（J/mol）',1000,11],['n','蠕变应力指数 n',.1,11],['stress','参考应力 σref/E',.005,11]];
  panel.innerHTML=`<p class="hint">读取粒子实时温度：加热、降温和接触传热均有效。冷却不会消除永久形变。</p><div class="plasticity-fields">${fields.map(([k,label,step,model])=>`<div data-thermal-model="${model}"><label for="tm-${k}3">${label}</label><input id="tm-${k}3" type="number" min="${L[k][0]}" max="${L[k][1]}" step="${step}" value="${D[k]}"></div>`).join('')}</div><p id="thermal-formula3" class="hint"></p><p class="hint">参数仅用于新建部件。热软化与蠕变不等于熔化；需要流体时，请另行开启“允许熔化与凝固”。</p><p id="thermal-material-error3" role="status" hidden>参数无效：Thot 必须高于 Tref，所有参数须在范围内。</p><button id="thermal-material-reset3">恢复温度本构参数</button><div class="button-row"><button id="thermal-heat3">选择加热笔</button><button id="thermal-cool3">选择降温笔</button></div><p class="hint">在试样上按住鼠标施加热量；暂停时也可改温度，继续模拟后力学响应生效。</p>`;
  $('pressure-material-controls').after(panel);
  function values(){const m=Number($('model3').value),p={...D};for(const [k,,,model] of fields)if(model===0||model===m)p[k]=$('tm-'+k+'3').valueAsNumber;
    // The unused softening interval must not constrain the creep reference temperature.
    if(m===11)p.Thot=Math.max(D.Thot,p.Tref+1);return p;}
  function validate(){$('thermal-material-error3').hidden=!!thermalParameters(values());}
  for(const [k] of fields)$('tm-'+k+'3').oninput=validate;
  $('thermal-material-reset3').onclick=()=>{for(const [k] of fields)$('tm-'+k+'3').value=D[k];validate();};
  for(const tool of ['heat','cool'])$('thermal-'+tool+'3').onclick=()=>document.querySelector(`[data-tool="${tool}"]`).click();
  return {values,update(custom,model){panel.hidden=!custom||model<10;for(const row of panel.querySelectorAll('[data-thermal-model]'))row.hidden=Number(row.dataset.thermalModel)!==0&&Number(row.dataset.thermalModel)!==model;
    $('thermal-formula3').textContent=model===10?'σy/E = (A/E + H/E · εp) · f(T)；f(Tref)=1，f(Thot)=残余强度比':'ε̇c = ε̇ref · (σeq/σref)ⁿ · exp[Q/R · (1/Tref,K − 1/TK)]';validate();}};
}
