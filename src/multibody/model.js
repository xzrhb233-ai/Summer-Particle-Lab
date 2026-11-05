import {normalizeContactPairs} from '../simulation/contact-pairs.js';
// SI units. All model coordinates, loads and joint axes are in world space.
import {bodyThermal,couplingParameters} from './coupling-model.js';
import {appearance} from './appearance.js';
import {validateLoadProgram} from '../simulation/curves.js';
export const v3=(x=0,y=0,z=0)=>[x,y,z];
export const add=(a,b)=>a.map((x,i)=>x+b[i]);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const mul=(a,k)=>a.map(x=>x*k);
export const norm=a=>Math.hypot(...a);
export const qmul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-dot(a.slice(0,3),b.slice(0,3))];
export const inverse=q=>[-q[0],-q[1],-q[2],q[3]];
export const rotate=(q,v)=>qmul(qmul(q,[...v,0]),inverse(q)).slice(0,3);
export function quaternion(degrees){const [x,y,z]=degrees.map(v=>v*Math.PI/360);return qmul(qmul([0,0,Math.sin(z),Math.cos(z)],[0,Math.sin(y),0,Math.cos(y)]),[Math.sin(x),0,0,Math.cos(x)]);}
function number(x,min,max,label){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error(label+'超出范围');return x;}
function vector(v,label,limit=1000){if(!Array.isArray(v)||v.length!==3)throw Error(label+'需要三个数值');return v.map(x=>number(x,-limit,limit,label));}
function id(x){if(typeof x!=='string'||!/^[-\w]{1,40}$/.test(x))throw Error('对象 ID 无效');return x;}
function name(x,fallback){return typeof x==='string'?x.slice(0,80):fallback;}
export function validateModel(input){
  if(!input||input.schema!=='summer-mbd/1'||!Array.isArray(input.bodies)||!Array.isArray(input.joints)||input.bodies.length>64||input.joints.length>128)throw Error('模型格式无效：最多 64 个刚体、128 个连接');
  const dt=number(input.dt??1/240,1/7680,1/60,'时间步'),iterations=number(input.iterations??12,4,64,'迭代次数');
  if(!Number.isInteger(iterations))throw Error('迭代次数须为整数');
  const bodies=input.bodies.map(b=>{
    if(!b||!['box','sphere','cylinder','disc','torus'].includes(b.shape)||!['dynamic','fixed'].includes(b.type))throw Error('刚体类型或形状无效');
    const size=vector(b.size,'尺寸',100);if(size.some(x=>x<.02))throw Error('各方向尺寸须在 0.02–100 m 内');
    if(b.shape==='sphere'&&(size[0]!==size[1]||size[1]!==size[2])||b.shape==='cylinder'&&size[0]!==size[2])throw Error('球的三轴直径须相等；圆柱的 X、Z 直径须相等');
    if(['disc','torus'].includes(b.shape)&&size[0]!==size[1])throw Error('Z 轴车轮的 X、Y 直径须相等');
    if(b.shape==='torus'&&size[2]>=size[0]/2)throw Error('轮胎管径须小于外径的一半');
    const collisionFamily=number(b.collisionFamily??0,0,15,'碰撞组');if(!Number.isInteger(collisionFamily))throw Error('碰撞组须为整数');
    return {id:id(b.id),name:name(b.name,b.id),shape:b.shape,type:b.type,size,mass:number(b.mass??1,.001,1e6,'质量'),position:vector(b.position,'位置'),rotation:vector(b.rotation??v3(),'旋转角',360),velocity:vector(b.velocity??v3(),'初速度',100),angularVelocity:vector(b.angularVelocity??v3(),'初始角速度',100),force:vector(b.force??v3(),'外力',1e6),torque:vector(b.torque??v3(),'外力矩',1e6),friction:number(b.friction??.5,0,2,'摩擦系数'),restitution:number(b.restitution??0,0,1,'恢复系数'),damping:number(b.damping??0,0,10,'阻尼'),thermal:bodyThermal(b.thermal),appearance:appearance(b.appearance),collisionFamily};
  });
  const ids=new Set(bodies.map(b=>b.id));if(ids.size!==bodies.length)throw Error('刚体 ID 不可重复');
  const joints=input.joints.map(j=>{
    if(!j||!['revolute','prismatic','planar','spherical','fixed','spring','gear'].includes(j.type)||!ids.has(j.a)||!ids.has(j.b)||j.a===j.b)throw Error('连接必须选择两个不同的已有刚体');
    const axis=vector(j.axis??[0,0,1],'连接轴',1);if(norm(axis)<1e-6)throw Error('连接轴不可为零');
    const result={id:id(j.id),name:name(j.name,j.id),type:j.type,a:j.a,b:j.b,anchor:vector(j.anchor,'连接点'),anchorB:vector(j.anchorB??j.anchor,'弹簧 B 端'),axis:mul(axis,1/norm(axis)),restLength:number(j.restLength??1,.001,100,'弹簧原长'),stiffness:number(j.stiffness??100,0,1e6,'弹簧刚度'),damping:number(j.damping??1,0,1e5,'弹簧阻尼'),limits:null,motor:null};
    if(j.separateAnchors!==undefined){if(j.separateAnchors!==true)throw Error('连接端点格式无效');result.separateAnchors=true;}
    if(j.angleOffset!==undefined){if(j.type!=='revolute')throw Error('角度偏置仅用于转动副');result.angleOffset=number(j.angleOffset,-Math.PI,Math.PI,'参考点初始角');}
    if(j.type==='gear'){result.ratio=number(j.ratio??2,-10,10,'传动比');if(Math.abs(result.ratio)<.1)throw Error('传动比绝对值须至少 0.1');result.maxTorque=number(j.maxTorque??100,.01,1e5,'传动力矩上限');}
    if(j.carrier!=null){if(j.type!=='gear'||!ids.has(j.carrier)||j.carrier===j.a||j.carrier===j.b)throw Error('传动参考机架须为第三个已有刚体');result.carrier=j.carrier;}
    if(j.limits!=null){if(!['revolute','prismatic'].includes(j.type)||!Array.isArray(j.limits)||j.limits.length!==2)throw Error('仅转动副/移动副支持限位');result.limits=j.limits.map(x=>number(x,-100,100,'限位'));if(result.limits[0]>=result.limits[1])throw Error('下限必须小于上限');}
    if(j.motor!=null){if(!['revolute','prismatic'].includes(j.type)||!['velocity','position'].includes(j.motor.mode))throw Error('仅转动副/移动副支持速度或位置驱动');result.motor={mode:j.motor.mode,target:number(j.motor.target,-100,100,'驱动目标'),stiffness:number(j.motor.stiffness??100,0,1e5,'驱动刚度'),damping:number(j.motor.damping??10,.001,1e4,'驱动阻尼')};}
    return result;
  });
  if(new Set(joints.map(j=>j.id)).size!==joints.length)throw Error('连接 ID 不可重复');
  const coupling=couplingParameters(input.coupling);
  return {schema:'summer-mbd/1',name:name(input.name,'自定义多体模型'),dt,iterations,gravity:vector(input.gravity??[0,-9.81,0],'重力',100),bodies,joints,coupling,contactPairs:normalizeContactPairs(input.contactPairs,bodies,coupling),...validateLoadProgram(input,bodies,joints,coupling)};
}
export function inertia(b){const [x,y,z]=b.size,m=b.mass;if(b.shape==='torus'){const R=(x-z)/2,r=z/2;return [m*(R*R/2+5*r*r/8),m*(R*R/2+5*r*r/8),m*(R*R+3*r*r/4)];}if(b.shape==='sphere')return [1,1,1].map(()=>m*x*x/10);if(b.shape==='disc')return [m*(3*x*x/4+z*z)/12,m*(3*x*x/4+z*z)/12,m*x*x/8];if(b.shape==='cylinder')return [m*(3*x*x/4+y*y)/12,m*x*x/8,m*(3*x*x/4+y*y)/12];return [m*(y*y+z*z)/12,m*(x*x+z*z)/12,m*(x*x+y*y)/12];}
