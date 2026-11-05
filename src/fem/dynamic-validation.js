import {dynamicCantileverProject} from './model.js';
import {FEMDynamicSimulation} from './dynamic.js';
import {pcg,multiply} from './solver.js';
import {dot} from './mesh.js';

// Independent generalized-eigenmode reference, not fitted to the time history.
export function firstMode(state,iterations=24){
  const {A,m,fixed}=state;
  let phi=state.u.slice();
  if(!phi.some(x=>x!==0))for(let i=0;i<phi.length;i++)phi[i]=fixed[i]?0:(i%3===1?1:0);
  for(let it=0;it<iterations;it++){
    const rhs=Float64Array.from(phi,(x,i)=>m[i]*x),next=pcg(A,rhs,fixed,{tolerance:1e-9,maxIterations:6000}).u;
    const scale=Math.sqrt(next.reduce((s,x,i)=>s+m[i]*x*x,0));phi=next.map(x=>x/scale);
  }
  const k=multiply(A,phi),omega=Math.sqrt(dot(phi,k)/phi.reduce((s,x,i)=>s+m[i]*x*x,0));
  const residual=Math.sqrt(k.reduce((s,x,i)=>s+(fixed[i]?0:(x-omega*omega*m[i]*phi[i])**2),0))/Math.sqrt(k.reduce((s,x,i)=>s+(fixed[i]?0:x*x),0));
  return {phi,omega,frequency:omega/(2*Math.PI),residual};
}
function modalRun(project,mode,dt,damping=0){
  project=structuredClone(project);project.solver.dt=dt;project.solver.damping=damping;
  const sim=new FEMDynamicSimulation(project),s=sim.states[0];
  s.u=mode.phi.map(x=>x*.01);s.v.fill(0);s.internal=multiply(s.A,s.u);
  s.initialEnergy=dot(s.u,s.internal)/2;
  const T=2*Math.PI/mode.omega,end=2*T,samples=[],initial=s.initialEnergy;
  let maxResidual=0;
  for(let i=1;i<=120;i++){
    const frame=sim.step(end*i/120-sim.time),p=frame.fem.parts[0],q=s.u.reduce((a,x,j)=>a+s.m[j]*mode.phi[j]*x,0)/.01;
    const wd=Math.sqrt(mode.omega**2-damping**2/4);
    const exact=Math.exp(-damping*sim.time/2)*(Math.cos(wd*sim.time)+damping/(2*wd)*Math.sin(wd*sim.time));
    samples.push({t:sim.time,q,exact});
    maxResidual=Math.max(maxResidual,Math.abs(p.summary.energyResidual)/initial);
  }
  const crossings=[];
  for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(a.q>0&&b.q<=0)crossings.push(a.t+(b.t-a.t)*a.q/(a.q-b.q));}
  return {dt:sim.dt,frequency:crossings.length>=2?1/(crossings[1]-crossings[0]):null,
    maxDisplacementError:Math.max(...samples.map(p=>Math.abs(p.q-p.exact))),maxEnergyResidual:maxResidual,
    remainingEnergy:sim.snapshot().energy/initial,dissipated:sim.states[0].dissipated/initial,steps:sim.steps};
}
export function runDynamicValidation(){
  const project=dynamicCantileverProject({size:[2,.2,.4],divisions:[8,2,2],damping:0});
  project.curves[0].points=[[0,0],[2,0]];project.solver.dt=.02;
  const base=new FEMDynamicSimulation(project),mode=firstMode(base.states[0]),dt=base.dt;
  const runs=[1,.5,.25].map(scale=>modalRun(project,mode,dt*scale));
  const damped=modalRun(project,mode,dt/2,2);
  return {schema:'summer-fem-dynamic-validation/1',reference:{size:project.parts[0].geometry.size,divisions:project.parts[0].discretization.divisions,frequency:mode.frequency,eigenResidual:mode.residual},
    runs,damped,checks:{eigenmode:mode.residual<1e-5,
      frequency:runs.every(r=>r.frequency&&Math.abs(r.frequency/mode.frequency-1)<.005),
      timestepConvergence:runs[2].maxDisplacementError<runs[1].maxDisplacementError&&runs[1].maxDisplacementError<runs[0].maxDisplacementError,
      undampedEnergy:runs.every(r=>r.maxEnergyResidual<.005),
      damping:damped.remainingEnergy<.3&&damped.dissipated>.6&&damped.maxEnergyResidual<.005&&damped.maxDisplacementError<.005},
    note:'用独立广义特征模态的解析振动解检验时间积分；不将此结果视为 Tet4 空间离散精度验证。阻尼为 C = αM，采用精确阻尼分裂。'};
}
