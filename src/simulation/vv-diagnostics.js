import {configurationId,actualDevice} from './workspace-context.js';

export const VV_VERSION='0.71.0';
export const VV_THRESHOLDS=Object.freeze({relativeEnergy:.01,absoluteEnergy:1e-8,relativeHeat:.01,absoluteHeat:1e-8,smallStrain:.01,lockingPoisson:.45});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const maxAbs=(...xs)=>Math.max(0,...xs.filter(finite).map(Math.abs));
const array=x=>Array.isArray(x)||ArrayBuffer.isView(x);
const det=(a,b,c)=>a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const metric=(name,value,unit='1')=>({name,value:finite(value)?value:null,unit});

// This is an evidence interpreter, not a physical-correctness classifier.
// Unknown observations remain unknown. A green check covers one measurement.
export function assessSimulation({project,frame,resultProject,history=[],computeError='',thresholds={}}={}){
  const limits={...VV_THRESHOLDS,...thresholds};for(const k of Object.keys(limits))if(!Object.hasOwn(VV_THRESHOLDS,k)||!finite(limits[k])||limits[k]<=0)throw Error('诊断阈值无效：'+k);
  const report={schema:'summer-vv-diagnostics/1',version:VV_VERSION,currentConfigurationId:project?configurationId(project):null,resultConfigurationId:resultProject?configurationId(resultProject):null,time:finite(frame?.time)?frame.time:null,backend:resultProject?actualDevice(frame,resultProject):'unconfirmed',thresholds:limits,checks:[],overall:'insufficient-evidence',physicalValidation:'not-established',limitations:['诊断只能评价已记录的量；没有报警不等于物理正确。','默认阈值是可调整的筛查阈值，不是工程验收标准。','实验确认、离散误差和参数不确定性必须分别提供证据。']};
  report.matchesCurrentConfiguration=!!report.resultConfigurationId&&report.currentConfigurationId===report.resultConfigurationId;
  const add=(id,title,status,explanation,observations=[],possibleCauses=[],nextChecks=[],severity=status==='observed'?'warning':'info')=>report.checks.push({id,title,status,severity,explanation,observations,possibleCauses,nextChecks});
  if(!frame||frame.preview||!resultProject||frame.fem?.analysis==='linear-static'&&!frame.fem.solved){add('availability','结果可用性','not-assessed','当前没有带来源的已求解结果。');return report;}
  if(!report.matchesCurrentConfiguration)add('provenance','结果来源','observed','显示结果来自其他配置，不能用于评价当前模型。',[],[],['重新运行当前配置，或恢复结果对应版本。']);
  if(computeError)add('solver-error','求解中断','observed',String(computeError).slice(0,500),[],['需结合求解器返回的失败位置判断，不能直接归因于时间步。'],['保存失败前的配置，降低时间步并检查材料和接触。']);

  let inspected=0,nonfinite=0,invalidJ=0,minJ=Infinity,computedCells=0,maxStrain=0,strainCoverage=0;
  for(const p of frame.fem?.parts??[]){
    for(const key of ['displacement','velocity','temperature','vonMises'])if(array(p[key]))for(const x of p[key]){inspected++;if(!finite(x))nonfinite++;}
    if(finite(p.summary?.maxStrain)){strainCoverage++;maxStrain=Math.max(maxStrain,p.summary.maxStrain);}
    if(Array.isArray(p.nodes)&&Array.isArray(p.cells)&&array(p.displacement)&&p.displacement.length===p.nodes.length*3){
      for(const ids of p.cells){if(!Array.isArray(ids)||ids.length!==4||ids.some(i=>!p.nodes[i]))continue;const x=ids.map(i=>p.nodes[i]);if(x.some(v=>!array(v)||v.length!==3||!Array.from(v).every(finite)))continue;
        const ref=det(sub(x[1],x[0]),sub(x[2],x[0]),sub(x[3],x[0]));if(Math.abs(ref)<1e-30)continue;
        const y=ids.map((i,j)=>x[j].map((v,k)=>v+p.displacement[3*i+k])),J=det(sub(y[1],y[0]),sub(y[2],y[0]),sub(y[3],y[0]))/ref;computedCells++;
        if(!finite(J)){nonfinite++;continue;}minJ=Math.min(minJ,J);if(J<=0)invalidJ++;
      }
    }
  }
  const health=frame.diagnostics?.particleHealth??frame.mixed?.energy?.particleHealth;
  if(health){inspected+=health.inspectedParticles??0;nonfinite+=health.nonfiniteParticles??0;invalidJ+=health.invalidJCount??0;}
  const stateMetrics=[metric('nonfinite',nonfinite,'count'),metric('nonpositive-J',invalidJ,'count'),metric('minimum-FEM-geometric-J',minJ),metric('minimum-MPM-stored-F-determinant',health?.minJ)];
  if(nonfinite||invalidJ)add('state','数值状态有效性','observed','检测到非有限场量、非正 FEM 几何体积比或非正 MPM 已存 F 行列式。塑性材料的已存 F 行列式不等于总体积比。',stateMetrics,['积分失稳、严重畸变、初始重叠或材料更新失败均可能造成此现象。'],['定位首次异常帧；分别细化时间步、网格并检查边界与接触。'],'error');
  else add('state','数值状态有效性',inspected?'within-threshold':'not-assessed',inspected?'已记录且已检查的场量未发现非有限值或非正行列式；这不覆盖未记录的自由度。':'后端未提供足够的完整场量；渲染采样不能代表全部粒子。',[metric('inspected-values-or-particles',inspected,'count'),metric('FEM-cells',computedCells,'count'),...stateMetrics]);
  if((resultProject.parts??[]).some(p=>['mpm','pbf'].includes(p.method))&&!health)add('particle-coverage','粒子状态覆盖','not-assessed','当前结果没有全量粒子健康统计。FEM 检查通过不能代表 MPM / PBF 粒子有效；GPU 渲染抽样不用于该结论。');
  if((frame.fem?.parts??[]).length)add('small-strain','FEM 模型适用范围',!strainCoverage?'not-assessed':maxStrain>limits.smallStrain?'risk':'within-threshold',!strainCoverage?'没有可用的 FEM 应变摘要，无法检查模型适用范围。':maxStrain>limits.smallStrain?'记录应变超过小应变筛查阈值，线弹性小变形假设需要复核。':'已记录应变筛查未越界；未记录部件、大转动和材料线性仍需独立确认。',[metric('maximum-strain-component',strainCoverage?maxStrain:null),metric('measured-parts',strainCoverage,'count'),metric('screening-limit',limits.smallStrain)],['大转动或大应变可能超出当前线弹性 FEM 模型。'],['检查位移梯度与实验载荷范围；需要时采用有限变形模型。']);

  const locking=(resultProject.parts??[]).filter(p=>p.method==='fem'&&p.discretization?.element==='tet4'&&p.material.poisson>=limits.lockingPoisson);
  add('locking','体积锁定',locking.length?'risk':'not-assessed',locking.length?'近不可压缩的位移型 Tet4 存在锁定风险；仅凭泊松比不能确诊。':'尚无针对当前模型的锁定对照证据；不把低泊松比或小位移当作无锁定证明。',locking.map(p=>metric(p.id+' Poisson ratio',p.material.poisson)),['体积约束过强可能造成虚假刚度；弯曲离散偏硬也有其他原因。'],['保持载荷与几何不变，做网格和泊松比敏感性研究，并与混合 u–p / B-bar 或可靠参考解比较。']);
  add('cell-crossing','Cell-crossing 噪声','not-assessed','单帧位置或珠串外观不足以归因。需要跨格应力时程与网格相位对照；内置平移基准只能检查零应力平移这一子问题。',[],['粒子跨网格、低粒子覆盖、应力更新或位置正则化都可能引入波动。'],['运行 MPM 平移 / 网格相位基准；受载工况另做平移网格原点、细化 h 与每格粒子数对照。']);
  add('numerical-fracture','数值断裂','not-assessed','当前没有完整的材料邻接与连通性历史，不能区分真实损伤、采样空洞与数值分离。显式损伤标记不是数值断裂证据。',[],['粒子覆盖不足、拉伸不稳定、跨格误差或真实损伤均需排查。'],['使用无损伤材料对照，并比较参考邻域连通性、裂缝位置对 h / 粒子数 / 种子的依赖。']);

  const e=frame.mixed?.energy,d=frame.fem?.dynamics,m=frame.diagnostics;
  let residual=null,scale=null,complete=false,scope='',raw=null,reasons=[];
  if(e){complete=e.complete===true&&e.enabled!==false;residual=e.unexplainedResidual;raw=e.rawResidual;scale=maxAbs(e.initial,e.mechanical,e.externalWork,e.thermalWork,e.physical?.total);scope=e.scope??'mixed';reasons=e.reasons??[];}
  else if(d&&!frame.mixed){complete=true;residual=d.energyResidual;scale=maxAbs(d.initialEnergy,d.mechanicalEnergy,d.externalWork,d.dissipated,d.thermalWork);scope='FEM + supported rigid contacts (mechanical)';}
  else if(m){reasons=m.reasons??[];complete=finite(m.residual)&&!reasons.some(r=>/unsupported|unresolved|estimated/.test(r));residual=m.residual;scale=maxAbs(m.mechanicalEnergy,m.energyChange,m.externalWork,m.regionImpulseWork,m.dampingLossEstimate);scope='CPU mechanical observer';}
  const tolerance=finite(scale)?limits.absoluteEnergy+limits.relativeEnergy*scale:null;
  if(!complete||!finite(residual))add('energy','机械能漂移','not-assessed',`完整机械能账本不可用；不能把未分解残差解释为材料耗散。${reasons.length?' 覆盖缺口：'+reasons.join(', '):''}`,[metric('reported-residual',residual,'J')],[],['启用支持的能量诊断；分离外载功、物理耗散、传递和位置修正功。']);
  else add('energy','机械能漂移',Math.abs(residual)>tolerance?'observed':'within-threshold',`账本范围：${scope}。判据为绝对容差 + 相对容差 × 能量/功尺度；只评价已闭合的机械项。`,[metric('unexplained-residual',residual,'J'),metric('raw-residual',raw,'J'),metric('tolerance',tolerance,'J'),metric('scale',scale,'J')],['若越界，时间积分、网格传递、接触修正或未计入的功可能是来源，需用分项账本和细化实验区分。'],['对照 Δt/2 与 h/2 的同一物理时刻，保留全部外功及耗散项。']);
  if(complete&&e?.numerical){const largest=Object.entries(e.numerical).filter(([k,v])=>k!=='total'&&finite(v)).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,4);if(largest.length)add('numerical-work','已记录的数值算子功',largest.some(([,v])=>Math.abs(v)>tolerance)?'observed':'within-threshold','数值修正已计入账本不代表其物理影响可以忽略；各分项保留原符号。',largest.map(([k,v])=>metric(k,v,'J')),[],['用禁用/减弱正则化的独立对照确认敏感性，不在原模型上自动改变参数。']);}
  const t=frame.thermal;if(finite(t?.residual)){const heatScale=maxAbs(t.externalHeat,t.generatedHeat,t.energyChange,finite(t.energy)&&finite(t.initialEnergy)?t.energy-t.initialEnergy:null),tol=limits.absoluteHeat+limits.relativeHeat*heatScale;add('heat','热量收支',Math.abs(t.residual)>tol?'observed':'within-threshold','只检查后端声明的热量残差；热量守恒不证明空间温度场正确。',[metric('heat-residual',t.residual,'J'),metric('heat-scale',heatScale,'J'),metric('tolerance',tol,'J')],[],['另做热扩散解析解与空间/时间细化；不要只检查总热量。']);}else add('heat','热量收支','not-assessed','当前后端未提供热量残差。');

  const clock=frame.mixed?.clock??frame.clock,actual=clock?.maxDt??d?.lastDt??m?.maxSubstep,critical=!clock?d?.criticalDt:null,requested=clock?.requestedDt??d?.requestedDt??resultProject.solver?.dt;
  const unstable=finite(actual)&&finite(critical)&&actual>critical*(1+1e-8),reduced=finite(actual)&&finite(requested)&&actual<requested*.1;
  add('timestep','时间步与稳定性',unstable?'observed':finite(actual)&&finite(critical)?'within-threshold':'not-assessed',unstable?'实际记录步长超过该 FEM 求解器报告的临界步长。':reduced?'实际步长明显小于请求值。稳定性限制、载荷事件和结束时刻切分都可能缩步，缩步本身不是失稳证据。':finite(actual)?'记录了实际步长；只有同范围、同一步的临界步长可用于局部稳定性筛查，不能保证全部耦合稳定。':'没有可核验的实际子步记录。',[metric('requested-dt',requested,'s'),metric('actual-recorded-dt',actual,'s'),metric('comparable-FEM-critical-dt',critical,'s'),metric('contact-retries',frame.mixed?.contactSafety?.retries,'count')],['接触刚度、材料波速、最小单元尺寸及热扩散都可限制步长。'],['保持终止物理时间一致做时间步细化；若实际子步相同，该对照无效。'],unstable?'error':'info');
  const ids=new WeakMap();if(resultProject)ids.set(resultProject,report.resultConfigurationId);
  const matching=history.filter(item=>{const f=item.frame??item,p=item.frame?item.resultProject:resultProject;if(!p||f.preview||f.fem?.analysis==='linear-static'&&!f.fem.solved)return false;if(!ids.has(p))ids.set(p,configurationId(p));return ids.get(p)===report.resultConfigurationId&&finite(f.time)&&f.time<=frame.time+1e-9;});report.historySamples=matching.length;
  report.overall=report.checks.some(c=>c.severity==='error')?'invalid-state':report.checks.some(c=>c.status==='observed'||c.status==='risk')?'review':'insufficient-evidence';
  return report;
}
