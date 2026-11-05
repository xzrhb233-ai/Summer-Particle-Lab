import {mpmPartThermalExample} from '../src/simulation/part-thermal-example.js';
import {normalizeSolverProject,toLegacy} from '../src/simulation/project.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {attachParticleThermalLoads} from '../src/simulation/thermal-ports.js';
const base=mpmPartThermalExample();base.couplings[0].thermal=false;
const projects={};
for(const [name,loads] of Object.entries({
  power:[{type:'thermal-power',power:5000}],
  face:[{type:'thermal-temperature',temperature:75,region:{type:'face',face:'x+'}}],
  convection:[{type:'thermal-convection',temperature:150,coefficient:300}],
  cooling:[{type:'thermal-power',power:-1e7}],
})){
  const p=structuredClone(base);p.loads=loads.map((l,i)=>({id:'heat-'+i,target:'heated',region:{type:'whole'},enabled:true,...l}));projects[name]=normalizeSolverProject(p);
}
const water=structuredClone(projects.face);water.parts[0].method='pbf';water.parts[0].material.phaseChange.enabled=false;water.parts[0].material.density=1000;water.loads.find(l=>l.type==='thermal-temperature').temperature=-20;projects.water=normalizeSolverProject(water);
const rigid=structuredClone(projects.power);rigid.parts.push({id:'receiver',name:'Rigid heat receiver',method:'rigid',geometry:{shape:'sphere',size:[.1,.1,.1],center:[0,.7,0],rotation:[0,0,0]},material:{mass:1,cp:500,conductivity:50},initial:{velocity:[0,0,0],angularVelocity:[0,0,0],temperature:20},boundary:{motion:'fixed',friction:0,restitution:0,damping:0}});rigid.loads.find(l=>l.type==='thermal-power').target='receiver';projects.rigid=normalizeSolverProject(rigid);
if(process.argv.includes('--projects'))console.log(JSON.stringify(projects));
if(process.argv.includes('--cpu')){
  await initialize();const results={};
  for(const [name,p] of Object.entries(projects)){const s=new CoupledSimulation(toLegacy(p));try{const l=attachParticleThermalLoads(p,s);s.externalHeat+=l.step(.2);results[name]={bodies:[...s.bodyHeat.values()].map(b=>b.temperature),temperature:[...s.particles.temperature.slice(0,s.particles.count)],enthalpy:[...s.particles.enthalpy.slice(0,s.particles.count)],loads:l.results(.2)};}finally{s.free();}}
  console.log(JSON.stringify(results));
}
