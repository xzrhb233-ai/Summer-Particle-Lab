// Solver-independent time functions. Values are dimensionless; bindings supply SI scale/offset.
const finite=(x,lo,hi,label)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)throw Error(label+'超出范围');return x;};
const id=x=>{if(typeof x!=='string'||!/^[-\w]{1,40}$/.test(x))throw Error('曲线或绑定 ID 无效');return x;};
export function normalizeCurves(input=[]){
  if(!Array.isArray(input)||input.length>64)throw Error('最多 64 条时间曲线');
  const seen=new Set();
  return input.map(c=>{
    if(!c||!['linear','smooth','step','sine'].includes(c.type))throw Error('时间曲线类型无效');
    const key=id(c.id);if(seen.has(key))throw Error('时间曲线 ID 重复');seen.add(key);
    const out={id:key,name:String(c.name??key).slice(0,80),type:c.type};
    if(c.type==='sine'){
      out.start=finite(c.start??0,0,60,'曲线起始时间');out.end=finite(c.end??60,out.start+.000001,60,'曲线结束时间');
      out.offset=finite(c.offset??0,-1e7,1e7,'正弦偏置');out.amplitude=finite(c.amplitude??1,0,1e7,'正弦幅值');
      out.frequency=finite(c.frequency??1,.001,100,'正弦频率');out.phase=finite(c.phase??0,-360,360,'正弦相位（度）');
    }else{
      if(!Array.isArray(c.points)||c.points.length<2||c.points.length>128)throw Error('时间表需要 2–128 个点');
      let previous=-Infinity;
      out.points=c.points.map(p=>{
        if(!Array.isArray(p)||p.length!==2)throw Error('时间表每行需要时间和值');
        const t=finite(p[0],0,60,'曲线时间'),v=finite(p[1],-1e7,1e7,'曲线值');
        if(t-previous<1e-6)throw Error('曲线时间须严格递增，间隔至少 0.000001 s');previous=t;return [t,v];
      });
      if(out.points[0][0]!==0)throw Error('时间表须从 0 s 开始');
    }
    return out;
  });
}
export function curveValue(c,t){
  if(c.type==='sine'){
    const u=Math.max(c.start,Math.min(c.end,t))-c.start;
    return c.offset+c.amplitude*Math.sin(2*Math.PI*c.frequency*u+c.phase*Math.PI/180);
  }
  const p=c.points;if(t<=p[0][0])return p[0][1];
  for(let i=1;i<p.length;i++)if(t<p[i][0]){
    const [a,v]=p[i-1],[b,w]=p[i],u=(t-a)/(b-a);
    return c.type==='step'?v:v+(w-v)*(c.type==='smooth'?u*u*(3-2*u):u);
  }
  return p.at(-1)[1];
}
// Exact primitive, including endpoint holding outside the defined interval.
export function curveIntegral(c,a,b){
  if(b<a)return -curveIntegral(c,b,a);
  if(a===b)return 0;
  if(c.type==='sine'){
    const lo=Math.max(a,c.start),hi=Math.min(b,c.end),w=2*Math.PI*c.frequency,phase=c.phase*Math.PI/180;
    let sum=Math.max(0,Math.min(b,c.start)-a)*curveValue(c,c.start)+Math.max(0,b-Math.max(a,c.end))*curveValue(c,c.end);
    if(hi>lo)sum+=c.offset*(hi-lo)+c.amplitude*(Math.cos(w*(lo-c.start)+phase)-Math.cos(w*(hi-c.start)+phase))/w;
    return sum;
  }
  const p=c.points;let sum=Math.max(0,Math.min(b,p[0][0])-a)*p[0][1];
  for(let i=1;i<p.length;i++){
    const [t,v]=p[i-1],[end,w]=p[i],lo=Math.max(a,t),hi=Math.min(b,end);if(hi<=lo)continue;
    const d=end-t,u=(lo-t)/d,z=(hi-t)/d;
    const primitive=x=>c.type==='step'?0:c.type==='smooth'?x*x*x-.5*x*x*x*x:.5*x*x;
    sum+=v*(hi-lo)+(w-v)*d*(primitive(z)-primitive(u));
  }
  return sum+Math.max(0,b-Math.max(a,p.at(-1)[0]))*p.at(-1)[1];
}
export function curveBounds(c){return c.type==='sine'?[c.offset-c.amplitude,c.offset+c.amplitude]:[Math.min(...c.points.map(p=>p[1])),Math.max(...c.points.map(p=>p[1]))];}
export function validateLoadProgram(input,bodies,joints,coupling){
  const curves=normalizeCurves(input.curves),bindings=input.loadBindings??[];
  if(!Array.isArray(bindings)||bindings.length>128)throw Error('最多 128 个曲线绑定');
  const ids=new Set(),channels=new Set(),lookup=new Map(curves.map(c=>[c.id,c]));
  const loadBindings=bindings.map(b=>{
    const key=id(b?.id);if(ids.has(key))throw Error('曲线绑定 ID 重复');ids.add(key);
    if(!lookup.has(b.curve))throw Error('绑定引用了不存在的曲线');
    if(!['body-force','body-torque','body-heat','region-heat','motor-target'].includes(b.kind))throw Error('曲线绑定类型无效');
    const body=bodies.find(x=>x.id===b.target),joint=joints.find(x=>x.id===b.target);
    if(b.kind==='motor-target'){if(!joint?.motor)throw Error('驱动曲线需要已有位置或速度电机');}
    else if(b.kind==='region-heat'){if(b.target!=='mpm'||!coupling?.enabled||!coupling.parts.length)throw Error('区域热源曲线需要耦合粒子');}
    else if(!body)throw Error('曲线绑定刚体不存在');
    if(b.kind==='body-heat'&&(!coupling?.enabled||!coupling.parts.length))throw Error('刚体热源曲线需要启用热耦合项目');
    if(['body-force','body-torque'].includes(b.kind)&&body.type!=='dynamic')throw Error('力或力矩曲线需要自由刚体');
    const component=['body-force','body-torque'].includes(b.kind)?b.component:null;
    if(component!==null&&(!Number.isInteger(component)||component<0||component>2))throw Error('力或力矩曲线需要 X / Y / Z 分量');
    const enabled=b.enabled??true;if(typeof enabled!=='boolean')throw Error('绑定启用开关无效');
    const channel=[b.kind,b.target,component].join(':');
    if(enabled&&channels.has(channel))throw Error('同一载荷分量不能绑定多条启用曲线');if(enabled)channels.add(channel);
    const scale=finite(b.scale??1,-1e7,1e7,'载荷倍率'),offset=finite(b.offset??0,-1e7,1e7,'载荷偏置');
    const limit=b.kind==='motor-target'?100:b.kind.endsWith('heat')?1e7:1e6;
    const range=curveBounds(lookup.get(b.curve)).map(v=>offset+scale*v);
    if(range.some(v=>!Number.isFinite(v)||Math.abs(v)>limit))throw Error('曲线载荷峰值超出目标允许范围');
    return {id:key,name:String(b.name??key).slice(0,80),curve:b.curve,kind:b.kind,target:b.target,component,scale,offset,enabled};
  });
  return {curves,loadBindings};
}
export const bindingValue=(b,c,t)=>b.offset+b.scale*curveValue(c,t);
export const bindingAverage=(b,c,t,dt)=>dt?b.offset+b.scale*curveIntegral(c,t,t+dt)/dt:bindingValue(b,c,t);

export function bindingUnit(b,joints=[]){
  if(b.kind==='fem-force')return 'N';
  if(b.kind==='fem-pressure')return 'Pa';
  if(b.kind==='body-force')return 'N';
  if(b.kind==='body-torque')return 'N·m';
  if(b.kind.endsWith('heat'))return 'W';
  const j=joints.find(j=>j.id===b.target);
  return (j?.type==='revolute'?'rad':'m')+(j?.motor?.mode==='velocity'?'/s':'');
}
