import {mixedEnergyCSV,mixedEnergyAlerts} from './energy.js';
import {plot} from '../simulation/curve-ui.js';
const $=id=>document.getElementById(id),fmt=x=>Number.isFinite(x)?x.toPrecision(6):'—';
const t=(zh,en)=>document.documentElement.lang==='en'?en:zh;
export function mountMixedEnergy(folder){
  const panel=folder('results','fem-mixed-energy','耦合收支与时间步');panel.dataset.femOnly='true';
  panel.innerHTML+=`<p id="mixed-clock-readout" class="hint" style="white-space:pre-line"></p>
    <p id="mixed-contact-safety" class="hint" style="white-space:pre-line" role="status" hidden></p>
    <p id="mixed-energy-readout" class="hint" style="white-space:pre-line" role="status"></p>
    <canvas id="mixed-energy-chart" aria-label="耦合能量时程" style="height:150px"></canvas>
    <p id="mixed-energy-legend" class="hint"></p><p id="mixed-energy-note" class="hint"></p>
    <div id="mixed-timing-results" hidden><canvas id="mixed-timing-chart" aria-label="GPU 求解耗时" style="display:block;position:relative;inset:0;width:100%;height:150px;touch-action:auto"></canvas><p id="mixed-timing-legend" class="hint"></p></div>
    <div class="buttons"><button id="mixed-energy-csv">导出耦合收支 CSV</button><button id="mixed-energy-json">导出界面交换 JSON</button></div>`;
}
export function wireMixedEnergy(getFrame,getHistory,download,guard){
  $('mixed-energy-csv').onclick=guard(()=>download(mixedEnergyCSV(getHistory()),'coupled-energy-history.csv','text/csv'));
  $('mixed-energy-json').onclick=guard(()=>download(JSON.stringify({time:getFrame().time,...getFrame().mixed,thermal:getFrame().thermal,contactPairs:getFrame().contactPairs},null,2),'coupling-exchanges.json','application/json'));
}
export function displayMixedEnergy(f,history){
  const safety=f.mixed?.contactSafety;
  const safetyNode=$('mixed-contact-safety');
  safetyNode.hidden=!safety;
  if(safety)safetyNode.textContent=t('接触位移保护：已启用','Contact travel protection: enabled')+'\n'+t('本输出区间重算次数','Retries in this output interval')+': '+safety.retries+' · '+t('最大位移 / 允许值','Maximum travel / budget')+': '+fmt(safety.maxTravelRatio)+'\n'+t('按粒子半径、FEM 最小网格尺寸与刚体运动限制步长。位移保护与扫掠检测分开统计。','Steps are bounded by particle radius, FEM cell size and rigid motion. Travel protection and swept detection are reported separately.');
  if(safety?.scheme==='swept-sphere-fem/1')safetyNode.textContent+='\n'+t('跨步扫掠检测：球 / MPM / PBF ↔ FEM 面、边、顶点','Swept detection: sphere / MPM / PBF vs FEM faces, edges and vertices')+'\n'+t('本区间扫掠查询 / 扫掠触发重算','Sweep queries / sweep-triggered retries')+': '+safety.sweptTests+' / '+safety.ccdRetries+'\n'+t('轨迹采用子步内线性插值；非球形刚体和 FEM–FEM 边–边连续检测未覆盖。','Paths use linear interpolation within a substep; nonspherical rigid and FEM–FEM edge–edge CCD are not covered.');
  $('mixed-timing-results').hidden=!f.mixed?.backend;
  if(f.mixed?.backend){
    const p=f.mixed.performance,c=f.mixed.clock,e=f.mixed.energy,active=e?.enabled===true,complete=active&&e.complete===true;
    $('mixed-clock-readout').textContent=`Taichi ${f.mixed.backend.arch.toUpperCase()} · ${f.mixed.backend.device}\nt = ${fmt(f.time)} s · ${c.steps} ${t('共享子步','shared steps')}\nΔt ${fmt(c.minDt)} – ${fmt(c.maxDt)} s\n${t('域间时间偏差','Domain time drift')}: ${fmt(c.maxDrift)} s`;
    const grid=p.neighborGrid;
    const allocation=grid?`\n${t('邻域网格','Neighbor grid')}: ${grid.shape.join(' × ')} · ${grid.cells.toLocaleString()} ${t('格','cells')}\n${t('相比固定分配减少格子数','Fewer cells vs fixed allocation')}: ${(100*(1-grid.cells/grid.referenceCells)).toFixed(1)}%`:'';
    const timing=`${t('本帧求解 / 回传准备','Frame solve / output preparation')}: ${fmt(p.solverMs)} / ${fmt(p.snapshotMs)} ms\n${t('子步内主机传输','Host transfers inside substeps')}: ${p.substepHostTransfers}\n${t('本帧结果数据','Result frame data')}: ${(p.frameBytes/1024).toFixed(1)} KiB\n${t('热量残差','Heat residual')}: ${fmt(f.thermal.residual)} J${allocation}`;
    $('mixed-energy-chart').hidden=!active;$('mixed-energy-chart').style.display=active?'':'none';$('mixed-energy-legend').hidden=!active;
    if(active){
      const s=e.storage??{},loss=e.physical??{},n=e.numerical??{};
      const names={
        'diagnostics-disabled':['诊断未开启','Diagnostics disabled'],
        'weak-thermoelastic-feedback':['可逆热弹性反馈未闭合','Reversible thermoelastic feedback is not closed'],
        'untracked-cold-work':['未单独追踪冷作储能','Cold-work storage is not tracked separately'],
        'unsupported-material-energy':['材料储能公式未覆盖','Material stored energy is unsupported'],
        'unsupported-recoverable-material-energy':['材料可恢复储能公式未覆盖','Recoverable material stored energy is unsupported'],
        'normal-contact-injected-energy':['法向接触产生能量增加','Normal contact injected energy'],
        'constitutive-energy-clamp-active':['本构能量限幅已触发','Constitutive energy clamp activated'],
        'non-finite-energy-observation':['能量记录含非有限值','Energy observation contains nonfinite values']
      };
      const reasons=[...new Set([...(e.reasons??[]),...(e.coverage?.reasons??[])])].map(reason=>names[reason]?t(...names[reason]):reason);
      const alertNames={...names,
        'incomplete-mechanical-coverage':['机械账本存在未覆盖项，仅能检查已知差额','Mechanical coverage is incomplete; only the known imbalance can be checked'],
        'substantial-mechanical-residual':['剩余残差同时超过 5% 和 1 μJ，请检查积分与接触离散；这不是收敛判定','Remaining residual exceeds both 5% and 1 μJ; inspect integration and contact discretization. This is not a convergence verdict']
      },alerts=mixedEnergyAlerts(e).map(code=>t(...alertNames[code]));
      $('mixed-energy-readout').textContent=[
        complete?t('可恢复机械能账本：分项已覆盖','Recoverable mechanical ledger: terms covered'):t('可恢复机械能账本：仅报告已知项','Recoverable mechanical ledger: known terms only'),
        `${t('初始 / 当前机械能','Initial / current mechanical energy')}: ${fmt(e.initial)} / ${fmt(e.mechanical)} J`,
        `${t('已知机械能合计','Known mechanical energy')}: ${fmt(e.knownMechanical)} J`,
        `${t('MPM 平动 / APIC 仿射动能','MPM translational / APIC affine kinetic energy')}: ${fmt(s.mpmKinetic)} / ${fmt(s.mpmAffine)} J`,
        `${t('MPM 重力势能 / 弹性储能','MPM gravitational potential / elastic storage')}: ${fmt(s.mpmPotential)} / ${fmt(s.mpmElastic)} J`,
        `${t('FEM 动能 / 弹性储能','FEM kinetic / elastic storage')}: ${fmt(s.femKinetic)} / ${fmt(s.femElastic)} J`,
        `${t('外载功 / 温度参数功','External work / temperature-parameter work')}: ${fmt(e.externalWork)} / ${fmt(e.thermalWork)} J`,
        `${t('法向接触 / 摩擦损失','Normal contact / friction loss')}: ${fmt(loss.normal)} / ${fmt(loss.friction)} J`,
        `${t('塑性功 / FEM 阻尼损失','Plastic work / FEM damping loss')}: ${fmt(loss.plastic)} / ${fmt(loss.femDamping)} J`,
        `${t('P2G / G2P 数值做功','P2G / G2P numerical work')}: ${fmt(n.p2g)} / ${fmt(n.g2p)} J`,
        `${t('网格边界 / 位置修正做功','Grid boundary / position-correction work')}: ${fmt(n.gridBoundary)} / ${fmt(n.positionCorrection)} J`,
        `${t('塑性返回数值做功','Numerical plastic-return work')}: ${fmt(n.plasticReturn)} J`,
        `${complete?t('原始 / 扣除数值功后残差','Raw / remaining residual'):t('已知项原始 / 剩余差额','Known-term raw / remaining imbalance')}: ${fmt(complete?e.rawResidual:e.knownTermsResidual)} / ${fmt(complete?e.unexplainedResidual:e.knownUnexplainedResidual)} J`,
        `${t('相对剩余残差','Relative remaining residual')}: ${fmt(complete&&Number.isFinite(e.relativeResidual)?100*e.relativeResidual:null)} %`,
        `${t('应力储能 / 重力 / FEM 积分误差','Stress-storage / gravity / FEM integration errors')}: ${fmt(e.mpmStressStrainError)} / ${fmt(e.gravityIntegrationResidual)} / ${fmt(e.femIntegrationResidual)} J`,
        reasons.length?`${t('覆盖说明','Coverage notes')}: ${reasons.join('；')}`:'',
        alerts.length?`${t('异常提示','Diagnostic alerts')}: ${alerts.join('；')}`:'',timing
      ].filter(Boolean).join('\n');
      $('mixed-energy-note').textContent=t('这里只核对可恢复机械能。温度参数功是在固定机械状态下，温度改变材料参数和热应变造成的储能变化，不是热量 Q；它不从热焓中扣除。机械损失与其转成的热量分开核对，不重复相加。数值做功带符号，积分误差仍留在剩余残差中；相对残差同时配合绝对值查看，不作为收敛判据。完整热力学总能量未闭合，FEM 单域残差也未由此推算。','This ledger covers recoverable mechanical energy. Temperature-parameter work is the stored-energy change caused by temperature-dependent properties and thermal strain at fixed mechanical state; it is not heat Q and is not subtracted from enthalpy. Mechanical losses and converted heat are checked separately, never added twice. Numerical work is signed; integration errors remain in the residual. Read relative and absolute residuals together; neither is a convergence test. Full thermodynamic energy is not closed, and a FEM-only residual is not inferred.');
      $('mixed-energy-legend').textContent=t('青：机械能（缺项时为已知合计）· 紫：物理损失 · 橙：数值做功 · 灰：剩余差额','Cyan: mechanical energy (known sum if incomplete) · purple: physical losses · orange: numerical work · gray: remaining imbalance');
      if($('fem-mixed-energy').open)plot($('mixed-energy-chart'),[
        [e=>e.mechanical??e.knownMechanical,'#22a9b6'],[e=>e.physical?.total,'#b08de2'],[e=>e.numerical?.total,'#e3a048'],[e=>e.unexplainedResidual??e.knownUnexplainedResidual,'#718087']
      ].map(([value,color])=>({color,points:history.filter(x=>x.time<=f.time+1e-9&&x.mixed?.energy?.enabled).map(x=>[x.time,value(x.mixed.energy)??NaN])})),'J');
    }else{
      $('mixed-energy-readout').textContent=(e?t('GPU 机械能记录已关闭。','GPU mechanical-energy recording is disabled.'):t('此结果帧没有机械能账本。','This result frame contains no mechanical ledger.'))+'\n'+timing;
      $('mixed-energy-note').textContent=t('在求解设置中启用“记录 GPU 机械能收支”并应用，会从重置后的初始状态建立账本。旧帧不能追补子步做功，机械残差留空。塑性功、摩擦损失与生热记录不受此开关影响。','Enable “Record GPU mechanical energy balance” in solver settings and apply to start a ledger from the reset initial state. Substep work cannot be reconstructed from old frames, so mechanical residuals remain blank. Plastic work, friction loss and generated heat are independent of this switch.');
      if(f.mixed.scheme==='resident-four-method/1'){
        $('mixed-energy-readout').textContent=t('MPM / FEM / 刚体 / PBF 驻留 CUDA 联算。','MPM / FEM / rigid / PBF resident CUDA solving.')+'\n'+timing;
        $('mixed-energy-note').textContent=t('四方法共用时钟，子步内不回传物理状态。已记录接触冲量、塑性转热和热量收支；完整机械能账本及摩擦转热尚未覆盖，相应结果留空。','The four methods share one clock with no physical-state readback inside substeps. Contact impulses, plastic heat and thermal balance are recorded. The full mechanical ledger and friction-to-heat conversion are not yet covered; their results remain blank.');
      }
    }
    $('mixed-timing-legend').textContent=t('青：每个输出帧内的求解耗时，包含已启用的能量记录','Cyan: solve time within each output frame, including enabled energy recording');
    if($('fem-mixed-energy').open)plot($('mixed-timing-chart'),[{color:'#22a9b6',points:history.filter(x=>x.time<=f.time+1e-9).map(x=>[x.time,x.mixed?.performance?.solverMs??NaN])}],'ms');return;
  }
  $('mixed-energy-chart').hidden=false;$('mixed-energy-chart').style.display='';$('mixed-energy-legend').hidden=false;
  if(!f.mixed?.energy)return;
  const {energy:e,clock:c,exchanges:x}=f.mixed,n=e.numerical,p=e.physical,s=e.storage;
  $('mixed-clock-readout').textContent=[
    f.mixed.thermalMode==='fixed-geometry'?t('共享传热时钟 · 固定几何 · SI 单位','Shared thermal clock · fixed geometry · SI units'):t('共享力学时钟 · SI 单位','Shared mechanical clock · SI units'),
    `t = ${fmt(f.time)} s · ${c.steps} ${t('共享子步','shared steps')}`,
    `Δt ${fmt(c.minDt)} – ${fmt(c.maxDt)} s`,
    c.domains.map(d=>`${d.id.toUpperCase()} ${d.steps} · t=${fmt(d.time)}`).join(' / '),
    `${t('域间时间偏差','Domain time drift')} ${fmt(c.maxDrift)} s · ${t('事件截断','Event cuts')} ${c.eventCuts}`,
    `${t('热接触子步累计','Accumulated thermal contact substeps')} ${x.heatSubsteps}`].join('\n');
  $('mixed-energy-readout').textContent=[
    e.complete?t('储能覆盖：完整（当前支持的弹性本构）','Stored-energy coverage: complete for supported elastic laws'):t('账本不完整：部分本构 / PBF 储能或刚体连接与约束功未完整核对；总残差不提供。','Incomplete: some material / PBF storage or rigid constraint work is not fully audited; no total residual.'),
    `${t('MPM 动能 / APIC 仿射动能','MPM kinetic / APIC affine kinetic')} ${fmt(s.mpmKinetic)} / ${fmt(s.mpmAffine)} J`,
    `${t('MPM / FEM 弹性储能','MPM / FEM elastic storage')} ${fmt(s.mpmElastic)} / ${fmt(s.femElastic)} J`,
    `${t('FEM–FEM 接触储能 / 耗散','FEM–FEM contact storage / loss')} ${fmt(s.femContact??0)} / ${fmt(p.femContact??0)} J`,
    `${t('FEM 动能 / 初始系统能量','FEM kinetic / initial system energy')} ${fmt(s.femKinetic)} / ${fmt(e.initial)} J`,
    `${t('外力 / 热应变做功','External / thermal strain work')} ${fmt(e.externalWork)} / ${fmt(e.thermalWork)} J`,
    `${t('物理损失：FEM 阻尼 / 法向接触 / 摩擦','Physical loss: FEM damping / normal contact / friction')}\n${fmt(p.femDamping)} / ${fmt(p.normal)} / ${fmt(p.friction)} J`,
    `${t('数值传递做功 P2G / G2P','Numerical transfer work P2G / G2P')} ${fmt(n.p2g)} / ${fmt(n.g2p)} J`,
    `${t('网格边界 / 粒子后处理','Grid boundary / particle postprocess')} ${fmt(n.gridBoundary)} / ${fmt(n.postprocess)} J`,
    `${t('采样正则化 / 位置修正','Sampling regularization / position correction')} ${fmt(n.regularization)} / ${fmt(n.positionCorrection)} J`,
    `${t('温度与相态更新的已知机械能变化','Known mechanical change during temperature / phase update')} ${fmt(n.phase)} J`,
    `${t('原始机械残差','Raw mechanical residual')} ${fmt(e.rawResidual)} J`,
    `${t('扣除已记录数值做功后的残差','Residual after recorded numerical work')} ${fmt(e.unexplainedResidual)} J (${fmt(e.relativeResidual===null?null:e.relativeResidual*100)}%)`,
    `${t('其中 MPM 应力做功与储能差','MPM stress-work / storage mismatch')} ${fmt(e.mpmStressStrainError)} J`,
    `${t('界面两侧做功核对残差','Two-sided interface work residual')} ${fmt(e.interfaceWorkResidual)} J`,
    `${t('热量账本残差','Heat balance residual')} ${fmt(e.thermalResidual)} J`].join('\n');
  $('mixed-energy-note').textContent=t('数值做功为带符号变化：负值损失能量，正值增加能量。残差 = Δ机械能 + 物理损失 − 外力功 − 热应变功 − 已记录数值做功。积分误差仍留在残差中；不会强行归零。机械与热账本分开核对：摩擦、阻尼和数值损失尚不回填为热，热膨胀采用弱耦合。','Numerical work is signed: negative removes energy, positive adds it. Residual = Δmechanical energy + physical loss − external work − thermal strain work − recorded numerical work. Integration error remains visible. Mechanical and thermal balances are separate: friction, damping and numerical loss are not converted to heat; thermal expansion is weakly coupled.');
  $('mixed-energy-legend').textContent=t('青：机械能 · 紫：物理损失 · 橙：数值做功 · 灰：剩余残差','Cyan: mechanical energy · purple: physical loss · orange: numerical work · gray: remaining residual');
  if($('fem-mixed-energy').open)plot($('mixed-energy-chart'),[
    [e=>e.mechanical,'#22a9b6'],[e=>e.physical.total,'#b08de2'],[e=>e.numerical.total,'#e3a048'],[e=>e.unexplainedResidual,'#718087']
  ].map(([value,color])=>({color,points:history.filter(x=>x.time<=f.time+1e-9&&x.mixed?.energy).map(x=>[x.time,value(x.mixed.energy)??NaN])})),'J');
}
