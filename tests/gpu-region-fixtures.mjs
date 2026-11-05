// Shared, deterministic CPU/CUDA fixtures. Executed by the native test harness.
import {gripExample} from '../src/simulation/grip-example.js';
import {validationProject} from '../src/simulation/validation.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {toLegacy} from '../src/simulation/project.js';

export function grip(twist=false,large=false){
  const p=large?validationProject(twist?'twist':'stretch',{dt:1/480}):gripExample(twist);
  p.solver.dt=1/480;p.solver.diagnostics=false;
  p.parts.find(b=>b.method==='mpm').discretization.sampling.enabled=false;
  return p;
}
export function free(mode='bind'){
  const p=grip();p.parts=p.parts.filter(b=>b.method==='mpm'||b.id==='right-clamp');
  const b=p.parts.find(b=>b.method==='rigid');
  b.geometry.center=[0,1.6,0];b.geometry.rotation=mode==='slide'?[0,0,0]:[23,17,31];
  p.frames=p.frames.filter(f=>f.part===b.id);p.frames[0].position=[0,0,0];p.frames[0].rotation=[0,90,0];
  p.selectionSets=[{id:'all',name:'all',part:'specimen',region:{type:'whole'}}];
  p.connections=[{id:'test',name:'test',type:'region',a:b.id,b:'specimen',mode,stiffness:1e7,damping:80,
    endpoints:{a:{frame:p.frames[0].id},b:{selection:'all'}}}];
  p.loads=p.loads.filter(l=>l.target===b.id||l.target==='mpm');p.couplings[0].mechanical=false;
  p.parts.find(b=>b.method==='mpm').initial.velocity=mode==='slide'?[.2,0,0]:[.2,.1,-.04];
  return p;
}
const projects={stretch:grip(),twist:grip(true),large:grip(true,true),bind:free(),slide:free('slide'),elastic:free('elastic')};
if(process.argv.includes('--projects'))console.log(JSON.stringify(projects));
if(process.argv.includes('--cpu')){
  await initialize();
  const result={};
  // Warm JIT independently of measurement. Same dt, frames and snapshot cadence
  // as CUDA; neither side includes construction or first-run compilation.
  const warm=new CoupledSimulation(toLegacy(projects.large));for(let n=0;n<16;n++)warm.step(1/480);warm.free();
  for(const name of ['stretch','twist','large']){
    const s=new CoupledSimulation(toLegacy(projects[name])),start=performance.now(),trace=[];
    try{
      for(let k=0;k<12;k++){
        const force=[0,0,0],torque=[0,0,0];let power=0,bodyPower=0,positiveWork=0;
        for(let n=0;n<8;n++){
          const f=s.step(1/480),r=f.joints.find(j=>j.id==='right-grip');
          for(let a=0;a<3;a++){force[a]+=r.force[a]/8;torque[a]+=r.torque[a]/8;}
          power+=r.power/8;bodyPower+=r.bodyPower/8;positiveWork+=r.positiveWork;
        }
        const f=s.snapshot();trace.push({time:f.time,coordinate:f.joints[0].coordinate,
          region:{...f.joints.find(j=>j.id==='right-grip'),force,torque,power,bodyPower,positiveWork}});
      }
      const ms=performance.now()-start,f=s.snapshot();
      result[name]={ms,trace,particles:[...f.particles],count:s.particles.count};
    }finally{s.free();}
  }
  console.log(JSON.stringify(result));
}
