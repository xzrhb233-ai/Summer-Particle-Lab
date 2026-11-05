import {validateModel,add} from './model.js';
import {bicycle,bicycleWall,bicycleCourse,bicycleRamps} from './bicycle.js';
const body=(id,shape,position,size,mass=1,rotation=[0,0,0],type='dynamic')=>({id,name:id,shape,position,size,mass,rotation,type});
const floor=()=>body('ground','box',[0,-.15,0],[12,.3,8],1,[0,0,0],'fixed');
const joint=(id,type,a,b,anchor,extra={})=>({id,name:id,type,a,b,anchor,axis:[0,0,1],...extra});
export function preset(kind='pendulum'){
  if(kind==='pelican-ramps')return bicycleRamps();
  if(kind==='pelican-course')return bicycleCourse();
  if(kind==='pelican')return bicycle();
  if(kind==='pelican-wall')return bicycleWall();
  if(kind==='pelican-climb')return bicycleWall({climb:true});
  const model={schema:'summer-mbd/1',name:'双摆',dt:1/240,iterations:12,gravity:[0,-9.81,0],bodies:[floor()],joints:[]};
  if(kind==='coupling'){
    model.name='热压头 · MPM · 温度场耦合';model.dt=1/240;model.gravity=[0,-.6,0];
    model.bodies=[body('base','box',[0,-.15,0],[2,.3,1.6],40,[0,0,0],'fixed'),body('guide','box',[.85,.7,0],[.1,.2,.1],1,[0,0,0],'fixed'),{...body('hot-platen','box',[0,.55,0],[1,.2,.8],40),thermal:{temperature:400,cp:500,conductivity:50,power:0}}];
    model.joints=[joint('vertical-guide','prismatic','guide','hot-platen',[0,.55,0],{axis:[0,1,0],limits:[-.35,.4]})];
    model.coupling={enabled:true,thermalScale:1000,parts:[{name:'温度 J2 试样',center:[0,.2,0],size:[.8,.4,.6],model:10,temperature:20,thermalMaterial:{Thot:40}}]};
  }
  else if(kind==='empty'){model.name='自定义机构';}
  else if(kind==='pendulum'){
    const top=[0,5,0],a=30*Math.PI/180,b=-20*Math.PI/180,mid=add(top,[2*Math.sin(a),-2*Math.cos(a),0]);
    model.bodies.push(body('pivot','sphere',top,[.3,.3,.3],1,[0,0,0],'fixed'),body('link-1','box',add(top,[Math.sin(a),-Math.cos(a),0]),[.22,2,.22],1,[0,0,30]),body('link-2','box',add(mid,[Math.sin(b),-Math.cos(b),0]),[.22,2,.22],1,[0,0,-20]));
    model.joints.push(joint('hinge-1','revolute','pivot','link-1',top),joint('hinge-2','revolute','link-1','link-2',mid));
  }else if(kind==='crank'){
    model.name='电机驱动曲柄滑块';const angle=35*Math.PI/180,r=1,L=3,top=[-2,2.5,0],pin=add(top,[r*Math.cos(angle),r*Math.sin(angle),0]),end=add(top,[r*Math.cos(angle)+Math.sqrt(L*L-(r*Math.sin(angle))**2),0,0]),phi=Math.atan2(end[1]-pin[1],end[0]-pin[0])*180/Math.PI;
    // The connecting rod runs in an offset plane, as in a real crank assembly,
    // so its body can pass the fixed shaft without colliding with the support.
    end[2]=.4;
    model.bodies.push(body('base','sphere',top,[.25,.25,.25],1,[0,0,0],'fixed'),body('crank','box',top.map((x,i)=>(x+pin[i])/2),[r,.18,.18],1,[0,0,35]),body('rod','box',pin.map((x,i)=>i===2?.4:(x+end[i])/2),[L,.16,.16],1,[0,0,phi]),body('slider','box',end,[.6,.5,.5],2));
    model.joints.push(joint('motor','revolute','base','crank',top,{motor:{mode:'velocity',target:1,stiffness:100,damping:30}}),joint('crank-rod','revolute','crank','rod',pin),joint('rod-slider','revolute','rod','slider',end),joint('guide','prismatic','base','slider',end,{axis:[1,0,0]}));
  }else if(kind==='suspension'){
    model.name='弹簧阻尼悬架';model.bodies.push(body('support','box',[0,5,0],[1,.3,1],1,[0,0,0],'fixed'),body('carriage','box',[0,2,0],[1.3,.7,.8],5));
    model.joints.push(joint('vertical-guide','prismatic','support','carriage',[0,2,0],{axis:[0,1,0],limits:[-1.2,1.2]}),joint('spring-damper','spring','support','carriage',[0,5,0],{anchorB:[0,2,0],restLength:2.3,stiffness:150,damping:6}));
  }else if(kind==='collision'){
    model.name='刚体接触与碰撞';for(let i=0;i<5;i++)model.bodies.push({...body('block-'+(i+1),'box',[0,.5+i*1.05,0],[.9,.9,.9]),rotation:[0,i*12,0],friction:.6});
    model.bodies.push({...body('ball','sphere',[-4,1,0],[.8,.8,.8],4),velocity:[6,0,0],restitution:.3});
  }else throw Error('未知多体算例');
  return validateModel(model);
}
