import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {initialize} from '../src/multibody/engine.js';
import {materialContactExample} from '../src/simulation/material-contact-example.js';
import {gripExample} from '../src/simulation/grip-example.js';
export function attachedMulti(){
  const p=gripExample(true),specimen=p.parts.find(p=>p.method==='mpm');
  specimen.discretization.sampling.enabled=false;p.couplings[0].mechanical=false;
  const other=structuredClone(specimen);other.id='neighbor';other.geometry.center=[0,1.2,0];
  other.material.fixedRegions=[{type:'whole'}];p.parts.push(other);
  p.contactPairs=[{id:'separate',a:'specimen',b:'neighbor',mechanical:false,thermal:false,friction:0,contactConductance:0}];
  return p;
}
export function blocks({gap=.02,mechanical=true,thermal=false,friction=0,fixed=false}={}){
  return fromLegacy({schema:'summer-mbd/1',name:'双 MPM 接触验证',gravity:[0,0,0],dt:1/480,bodies:[],joints:[],
    coupling:{enabled:true,mechanical:false,thermal:false,thermalScale:100,stiffness:1,
      domain:{lower:[-.8,0,-.5],upper:[.8,1,.5],cellSize:.1,particlesPerAxis:2},
      parts:[{id:'a',name:'热块',method:'mpm',center:[-.1-gap/2,.5,0],size:[.2,.2,.2],model:0,density:1100,temperature:100,velocity:[.2,0,.1],sampling:{enabled:false}},
        {id:'b',name:'冷块',method:'mpm',center:[.1+gap/2,.5,0],size:[.2,.2,.2],model:0,density:2200,temperature:20,velocity:fixed?[0,0,0]:[-.1,0,-.1],sampling:{enabled:false},...(fixed?{fixedRegions:[{type:'whole'}]}:{})}]},
    contactPairs:[{id:'ab',name:'热块 ↔ 冷块',a:'a',b:'b',mechanical,thermal,friction,contactConductance:20000}]});
}
export function measures(s){
  const p=s.particles,momentum=[0,0,0],angular=[0,0,0],velocities=[],energy=[0,0],mass=[0,0];
  for(let i=0;i<p.count;i++){
    const part=p.lab.part[i]-1,v=[p.vx[i],p.vy[i],p.vz[i]].map(x=>x*.025);velocities.push(...v);
    for(let k=0;k<3;k++)momentum[k]+=p.mass[i]*v[k];
    const x=[p.x[i],p.y[i],p.z[i]].map(x=>x*.025),C=p.mpm.C.subarray(i*9,i*9+9),D=(p.mpm.H*.025)**2/4;
    const spin=[C[7]-C[5],C[2]-C[6],C[3]-C[1]],orbital=[x[1]*v[2]-x[2]*v[1],x[2]*v[0]-x[0]*v[2],x[0]*v[1]-x[1]*v[0]];
    for(let k=0;k<3;k++)angular[k]+=p.mass[i]*(orbital[k]+D*spin[k]);
    energy[part]+=p.mass[i]*p.enthalpy[i];mass[part]+=p.mass[i];
  }
  return {momentum,angular,velocities,energy,mass};
}
if(process.argv.includes('--projects'))console.log(JSON.stringify({disabled:blocks({mechanical:false}),collision:blocks(),friction:blocks({friction:.6}),thermal:blocks({gap:0,mechanical:false,thermal:true}),fixed:blocks({gap:0,fixed:true}),demo:materialContactExample(),attached:attachedMulti()}));
if(process.argv.includes('--cpu')){
  await initialize();const result={};
  for(const [name,p] of Object.entries({collision:blocks(),friction:blocks({friction:.6}),thermal:blocks({gap:0,mechanical:false,thermal:true})})){
    const s=new CoupledSimulation(toLegacy(p));try{
      const initial=measures(s);let peak=0;
      for(let k=0;k<24;k++){if(name==='thermal')s.heatStep(1/480);else{s.step(1/480);peak=Math.max(peak,s.snapshot().contactPairs[0].normalForce);}}
      s.lastDt=name==='thermal'?.05:1/480;
      result[name]={initial,final:measures(s),pair:s.snapshot().contactPairs[0],peak};
    }finally{s.free();}
  }
  console.log(JSON.stringify(result));
}
