import {MAX_COUPLED_PARTICLES} from '../multibody/coupling-model.js';
import {normalizeSolverProject} from './project.js';

// Recorded frames are read-only observations, never resumable solver state.
export function readRecording(data){
  if(data?.schema!=='summer-replay/1'||!Array.isArray(data.frames)||!data.frames.length||data.frames.length>601)throw Error('回放格式或帧数无效');
  const project=normalizeSolverProject(data.project),bodies=project.parts.filter(p=>p.method==='rigid'),ids=bodies.map(b=>b.id);
  const appearance=new Map(bodies.map(p=>{
    const a=structuredClone(p.geometry.appearance);if(a){for(const s of a){Object.freeze(s.position);Object.freeze(s.size);Object.freeze(s.rotation);Object.freeze(s);}Object.freeze(a);}return[p.id,a];
  }));
  let time=-1,bytes=0,count=null;
  const frames=data.frames.map(f=>{
    if(!Number.isFinite(f.time)||f.time<=time||f.time>60||!Array.isArray(f.bodies)||f.bodies.length!==ids.length||f.bodies.some((b,i)=>b.id!==ids[i]||!['position','rotation','velocity','angularVelocity','displacement','acceleration'].every(k=>Array.isArray(b[k])&&b[k].length===(k==='rotation'?4:3)&&b[k].every(Number.isFinite))))throw Error('回放刚体状态或时间无效');
    if(!Array.isArray(f.particles)||!f.particles.length||f.particles.length%8||f.particles.length>MAX_COUPLED_PARTICLES*8||!f.particles.every(Number.isFinite))throw Error('回放粒子无效');
    count??=f.particles.length;if(f.particles.length!==count)throw Error('回放粒子数不一致');
    bytes+=f.particles.length*4;if(bytes>48*1024*1024)throw Error('回放超过内存预算');time=f.time;
    return {...f,particles:new Float32Array(f.particles),bodies:f.bodies.map(b=>({...b,appearance:appearance.get(b.id)??null}))};
  });
  if(frames[0].time!==0)throw Error('回放缺少初始帧');
  return {project,frames};
}
