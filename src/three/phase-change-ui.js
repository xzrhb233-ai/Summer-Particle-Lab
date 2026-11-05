import {PHASE_DEFAULTS as D,phaseParameters} from './phase-change.js';
export function installPhaseControls(){
  const $=id=>document.getElementById(id),panel=document.createElement('div');panel.id='phase-material-controls';
  panel.innerHTML=`<label class="check"><input id="phase-enabled3" type="checkbox">允许熔化与凝固（MPM ↔ PBF）</label><div id="phase-fields3" hidden><label for="phase-melting3">熔点 °C（独立于热软化温度）</label><input id="phase-melting3" type="number" min="-100" max="2000" step="1" value="${D.meltingPoint}"><label for="phase-latent3">熔化潜热 J/kg</label><input id="phase-latent3" type="number" min="1000" max="2000000" step="1000" value="${D.latentHeat}"><p class="hint">吸收完潜热后进入 PBF，释放完潜热后回到所选 MPM 本构。相变时清除旧应力与塑性历史；质量和总焓保持。两相暂用相同密度与比热，不模拟沸腾。</p></div><p class="hint">用于新建 MPM 部件。关闭时，加热只改变温度与本构响应，不会自动变成流体。</p><p id="phase-error3" class="hint" role="status" hidden>相变参数无效，请检查熔点与潜热范围。</p>`;
  $('thermal-material-controls').after(panel);
  const values=()=>({enabled:$('phase-enabled3').checked,meltingPoint:$('phase-melting3').valueAsNumber,latentHeat:$('phase-latent3').valueAsNumber});
  function update(){const custom=$('material3').value==='11';panel.hidden=!custom;$('phase-fields3').hidden=!$('phase-enabled3').checked;$('phase-error3').hidden=!!phaseParameters(values());}
  for(const id of ['phase-enabled3','phase-melting3','phase-latent3'])$(id).oninput=update;
  return {values,update,preset(enabled){$('phase-enabled3').checked=enabled;$('phase-melting3').value=D.meltingPoint;$('phase-latent3').value=D.latentHeat;update();}};
}
