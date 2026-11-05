import {validateModel,sub,add} from './model.js';

const colors={frame:'#328b81',tire:'#273039',rim:'#cbd5cf',metal:'#748b93',bird:'#fff4da',wing:'#e7d8b7',beak:'#f3b24b',leg:'#d88a36',dark:'#24343c'};
const primitive=(shape,position,size,color,rotation=[0,0,0])=>({shape,position,size,color,rotation});
const sphere=(p,s,c)=>primitive('sphere',p,s,c);
// Native assembly tools use the same local-space primitives exposed in the UI.
const bar=(a,b,width,color)=>primitive('box',a.map((v,i)=>(v+b[i])/2),[Math.hypot(b[0]-a[0],b[1]-a[1]),width,width],color,[0,0,Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI]);
const localize=(shapes,center)=>shapes.map(s=>({...s,position:sub(s.position,center)}));
export function bicycle({radius=.62,wheelbase=2.1,rpm=24,ratio=1.6,origin=[0,0,0],mode='guided',frontDrive=false,frontTorque=40,pedalGain=8}={}){
  if(!Number.isFinite(radius)||radius<.45||radius>.85||!Number.isFinite(wheelbase)||wheelbase<1.8||wheelbase>2.6||!Number.isFinite(rpm)||rpm<0||rpm>60||!Number.isFinite(ratio)||ratio<.5||ratio>3||!['guided','planar','stand'].includes(mode)||!Array.isArray(origin)||origin.length!==3||origin.some(x=>!Number.isFinite(x)||Math.abs(x)>100))throw Error('请检查装配参数：半径 0.45–0.85 m，轴距 1.8–2.6 m，踏频 0–60 rpm，传动比 0.5–3');
  if(typeof frontDrive!=='boolean'||!Number.isFinite(frontTorque)||frontTorque<1||frontTorque>500||!Number.isFinite(pedalGain)||pedalGain<1||pedalGain>1000)throw Error('前轮驱动参数：力矩上限 1–500 N·m，踏板驱动增益 1–1000');
  const axleHeight=radius+(mode==='stand'?.15:0),rear=[-wheelbase/2,axleHeight,0],front=[wheelbase/2,axleHeight,0],crank=[-.23,axleHeight+.06,0],seat=[-.5,axleHeight+.95,0],head=[wheelbase/2-.3,axleHeight+.9,0],hip=[-.55,axleHeight+1.1,0],torso=[-.62,axleHeight+1.38,0],frameCenter=[0,axleHeight+.48,0],r=.24;
  const model={schema:'summer-mbd/1',name:'鹈鹕骑自行车 · '+({guided:'直线导向',planar:'平面骑行',stand:'固定支架'}[mode]),dt:1/480,iterations:32,gravity:[0,-9.81,0],bodies:[],joints:[]};
  function body(id,name,shape,p,size,mass,appearance,rotation=[0,0,0],fixed=false){model.bodies.push({id,name,shape,position:add(p,origin),size,mass,appearance,rotation,type:fixed?'fixed':'dynamic',friction:1.2,damping:.015,collisionFamily:id.startsWith('road-')?0:1});}
  function joint(id,name,type,a,b,anchor,extra={}){model.joints.push({id,name,type,a,b,anchor:add(anchor,origin),axis:[0,0,1],...extra});}
  for(let n=0;n<3;n++){
    const p=[40+n*100,-.12,0],s=[primitive('box',[0,0,0],[100,.24,3],'#b4c4c4'),primitive('box',[0,.126,1.2],[100,.01,.045],'#f8f3df'),primitive('box',[0,.126,-1.2],[100,.01,.045],'#f8f3df')];
    for(let i=-48;i<50;i+=3)s.push(primitive('box',[i,.127,.8],[.8,.012,.035],'#f8f3df'));
    body('road-'+n,'路面 '+(n+1),'box',p,[100,.24,3],1,s,[0,0,0],true);
  }
  const tubes=[[rear,seat],[seat,crank],[crank,rear],[seat,head],[head,crank],[head,front]],visual=tubes.map(([a,b])=>bar(a,b,.065,colors.frame));
  const saddle=[seat[0]-.05,seat[1]+.16,0],handle=[head[0]+.17,head[1]+.42,0];
  visual.push(bar(seat,saddle,.065,colors.metal),primitive('box',saddle,[.48,.105,.4],'#634d43'),bar(head,handle,.055,colors.metal),primitive('cylinder',handle,[.045,.66,.045],colors.metal,[90,0,0]));
  for(const z of [-.3,.3])visual.push(primitive('sphere',[handle[0],handle[1],z],[.09,.09,.22],colors.dark));
  // Chain's two spans are display geometry; its reaction is solved by the gear constraint.
  for(const offset of [-.13,.13])visual.push(bar([rear[0],rear[1]+offset,.19],[crank[0],crank[1]+offset,.19],.023,colors.dark));
  body('bike-frame','自行车车架','box',frameCenter,[wheelbase,.9,.18],5,localize(visual,frameCenter),[0,0,0],mode==='stand');
  if(mode==='guided')joint('straight-guide','直线导向（限制侧翻）','prismatic','road-0','bike-frame',frameCenter,{axis:[1,0,0]});
  else if(mode==='planar')joint('plane-guide','平面约束（允许升降与俯仰）','planar','road-0','bike-frame',frameCenter,{axis:[0,0,1]});
  else{
    body('stand','后轴支架','box',[rear[0],axleHeight/2,-.2],[.16,axleHeight,.45],1,[primitive('box',[0,0,0],[.16,axleHeight,.45],colors.metal)],[0,0,0],true);
  }
  for(const [id,name,p] of [['rear-wheel','后轮',rear],['front-wheel','前轮',front]]){
    const shapes=[primitive('torus',[0,0,0],[radius*2,radius*2,.12],colors.tire),primitive('torus',[0,0,0],[radius*1.78,radius*1.78,.035],colors.rim),primitive('cylinder',[0,0,0],[.13,.2,.13],colors.metal,[90,0,0])];
    for(let i=0;i<12;i++){const a=i*Math.PI/6;shapes.push(bar([.06*Math.cos(a),.06*Math.sin(a),0],[radius*.87*Math.cos(a),radius*.87*Math.sin(a),0],.014,colors.metal));}
    shapes.push(primitive('box',[radius*.7,0,.04],[.13,.035,.04],colors.beak));
    if(id==='rear-wheel')shapes.push(primitive('torus',[0,0,.19],[.3,.3,.035],colors.dark));
    body(id,name,'disc',p,[radius*2,radius*2,.12],2,shapes);
    joint(id+'-axle',name+'转动副','revolute','bike-frame',id,p);
  }
  const crankVisual=[primitive('torus',[0,0,.19],[.39,.39,.045],colors.dark),primitive('cylinder',[0,0,0],[.08,.67,.08],colors.metal,[90,0,0])];
  for(const sign of [-1,1])crankVisual.push(bar([0,0,sign*.33],[sign*r,0,sign*.33],.055,colors.metal));
  body('crank','曲柄与链盘','box',crank,[.52,.08,.7],.6,crankVisual);
  joint('cadence','踩踏驱动','revolute','bike-frame','crank',crank,{motor:{mode:'velocity',target:-rpm*2*Math.PI/60,damping:pedalGain,stiffness:0}});
  const carrier=mode==='planar'?{carrier:'bike-frame'}:{};
  joint('chain','理想链传动','gear','crank','rear-wheel',crank,{ratio,maxTorque:80,stiffness:800,damping:8,...carrier});
  if(frontDrive)joint('front-drive','前轮辅助传动','gear','crank','front-wheel',crank,{ratio,maxTorque:frontTorque,stiffness:800,damping:8,...carrier});
  const bird=[sphere(torso,[1.18,.83,.65],colors.bird),primitive('cone',[-1.13,torso[1]+.12,0],[.36,.7,.3],colors.bird,[0,0,65])];
  const top=torso[1]+.82;
  bird.push(sphere([-.24,torso[1]+.36,0],[.32,.8,.32],colors.bird),sphere([-.15,top-.1,0],[.36,.55,.34],colors.bird),sphere([.13,top,0],[.56,.41,.4],colors.bird),primitive('cone',[.79,top-.07,0],[.21,1.12,.25],colors.beak,[0,0,-90]),primitive('sphere',[.66,top-.22,0],[.95,.31,.27],'#e9a245',[0,0,8]),primitive('box',[.75,top-.09,0],[.98,.015,.255],'#bc7c36'));
  for(const sign of [-1,1]){
    const wingStart=[-.43,torso[1]+.24,sign*.29],wingEnd=[handle[0],handle[1],sign*.29],wingCenter=wingStart.map((v,i)=>(v+wingEnd[i])/2),wingLength=Math.hypot(wingEnd[0]-wingStart[0],wingEnd[1]-wingStart[1]);
    bird.push(sphere([-.73,torso[1]+.08,sign*.29],[.87,.48,.12],colors.wing),primitive('sphere',wingCenter,[wingLength+.12,.19,.12],colors.wing,[0,0,Math.atan2(wingEnd[1]-wingStart[1],wingEnd[0]-wingStart[0])*180/Math.PI]),sphere([.25,top+.07,sign*.181],[.11,.11,.065],'#e7c36d'),sphere([.265,top+.075,sign*.213],[.054,.06,.026],colors.dark),sphere([.28,top+.089,sign*.225],[.018,.018,.012],'#ffffff'));
  }
  body('pelican','鹈鹕身体与翅膀','box',torso,[1.12,.75,.6],5,localize(bird,torso));
  joint('saddle','鹈鹕与车座连接','fixed','bike-frame','pelican',saddle);
  for(const [side,sign] of [['left',1],['right',-1]]){
    const H=[hip[0],hip[1],sign*.35],P=[crank[0]+sign*r,crank[1],sign*.35],dx=P[0]-H[0],dy=P[1]-H[1],d=Math.hypot(dx,dy),L1=.72,L2=.74,t=(L1*L1-L2*L2+d*d)/(2*d),height=Math.sqrt(L1*L1-t*t),K=[H[0]+dx*t/d-dy*height/d,H[1]+dy*t/d+dx*height/d,sign*.35];
    for(const [id,name,a,b,L] of [['thigh','大腿',H,K,L1],['shin','小腿',K,P,L2]]){
      const center=a.map((v,i)=>(v+b[i])/2),angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
      body(side+'-'+id,(sign===1?'左':'右')+name,'box',center,[L,.065,.065],.22,[primitive('sphere',[0,0,0],[L+.045,.075,.075],colors.leg)], [0,0,angle]);
    }
    body(side+'-pedal',(sign===1?'左':'右')+'脚与踏板','box',P,[.27,.065,.22],.16,[primitive('box',[0,-.015,0],[.25,.04,.22],colors.dark),sphere([.045,.045,0],[.32,.07,.22],colors.beak)]);
    joint(side+'-hip',side+' 髋关节','revolute','pelican',side+'-thigh',H);
    joint(side+'-knee',side+' 膝关节','revolute',side+'-thigh',side+'-shin',K);
    joint(side+'-ankle',side+' 踝关节','revolute',side+'-shin',side+'-pedal',P);
    joint(side+'-pedal-pin',side+' 踏板轴','revolute','crank',side+'-pedal',P);
  }
  return validateModel(model);
}

// Both assemblies use the public rigid and MPM geometry schemas. The wall is
// sampled by Simulation3.createGeometry, with no hidden mesh or animated pose.
export function bicycleWall({gap=1.8,thickness=.4,height=2.4,width=1.2,wallModel=0,stiffness=24,climb=false,frontDrive=climb,traction=climb?1.2:.45,...options}={}){
  if(!Number.isFinite(gap)||gap<.5||gap>2.5||!Number.isFinite(thickness)||thickness<.3||thickness>.6||!Number.isFinite(height)||height<1||height>3||!Number.isFinite(width)||width<.8||width>1.8||![0,4,9,10].includes(wallModel))throw Error('撞墙参数：净距 0.5–2.5 m，厚度 0.3–0.6 m，高度 1–3 m，宽度 0.8–1.8 m');
  if(typeof climb!=='boolean'||options.mode&&options.mode!==(climb?'planar':'guided'))throw Error('撞墙试验需要直线导向或平面攀爬骑行');
  const model=bicycle({pedalGain:climb?64:8,...options,frontDrive,mode:climb?'planar':'guided'}),origin=options.origin??[0,0,0],front=model.bodies.find(b=>b.id==='front-wheel'),face=front.position[0]+front.size[0]/2+gap;
  model.name=climb?'鹈鹕自行车 · 前轮牵引攀墙':'鹈鹕自行车 · MPM 撞墙试验';
  model.coupling={enabled:true,mechanical:true,thermal:false,stiffness,friction:traction,
    domain:{lower:add([-3,-.4,-1.6],origin),upper:add([6,4,1.6],origin),cellSize:.2,particlesPerAxis:2},
    parts:[{id:'impact-wall',name:'MPM 墙 · 底面固定',shape:'box',center:[face+thickness/2,origin[1]+height/2,origin[2]],size:[thickness,height,width],model:wallModel,fixedFace:'minY',temperature:20,sampling:{enabled:true,strength:.12,seed:42}}]};
  return validateModel(model);
}

// All three stages are ordinary editable geometry, with no timed fracture or
// prescribed bicycle trajectory. In filled mode the two deformable walls are
// the pool ends: no hidden fixed barrier may prevent their later destruction.
export function bicycleCourse({waterDepth=1,fillGap=true,waterLength=1.2,wallX=9.2,fractureOnset=null,fractureFailure=null}={}){
  if(typeof fillGap!=='boolean'||![waterDepth,waterLength,wallX].every(Number.isFinite)||waterDepth<.1||waterDepth>1||waterLength<.8||waterLength>6||wallX<8.8||wallX>9.4)throw Error('水深 0.1–1.0 m，水池长 0.8–6 m，末端墙 X 为 8.8–9.4 m');
  fractureOnset??=fillGap?.08:.012;fractureFailure??=fillGap?.16:.035;
  const model=bicycleWall({climb:true});model.name='鹈鹕自行车 · 攀墙 / 涉水 / 破墙';
  model.coupling.domain={lower:[0,-.4,-1.6],upper:[12,4,1.6],cellSize:.2,particlesPerAxis:2};
  const first=model.coupling.parts[0],back=first.center[0]+first.size[0]/2;
  const start=fillGap?back:6.5,end=fillGap?wallX:start+waterLength,width=1.2,length=end-start,wallThickness=fillGap?.6:.3;
  if(!fillGap&&end+.2>wallX)throw Error('水池和挡水槛不能与末端墙重叠');
  const barrier=(id,name,position,size,color)=>model.bodies.push({id,name,shape:'box',position,size,type:'fixed',mass:1,friction:.6,appearance:[primitive('box',[0,0,0],size,color)]});
  for(const sign of [-1,1]){
    barrier('pool-side-'+(sign>0?'a':'b'),'水池透明侧壁',[start+length/2,waterDepth/2,sign*(width/2+.08)],[length+.4,waterDepth,.16],'#739caa');
    // Show the perimeter of a clear retaining pane; keep the full box collider.
    model.bodies.at(-1).appearance=[
      ...[-1,1].map(y=>primitive('box',[0,y*(waterDepth/2-.015),0],[length+.4,.03,.16],'#739caa')),
      ...[-1,1].map(x=>primitive('box',[x*(length/2+.185),0,0],[.03,waterDepth,.16],'#739caa')),
    ];
  }
  const curb=Math.min(.08,waterDepth*.4);
  if(!fillGap)for(const [id,x] of [['entry',start-.1],['exit',end+.1]])barrier('pool-'+id,'水池低矮挡水槛',[x,curb/2,0],[.2,curb,width+.32],'#739caa');
  model.coupling.parts.push(
    {id:'water-pool',method:'pbf',name:'第二组 · PBF 水池',shape:'box',center:[start+length/2,waterDepth/2,0],size:[length,waterDepth,width],model:0,temperature:20,sampling:{enabled:true,strength:.03,seed:74}},
    {id:'breakable-wall',method:'mpm',name:'末端 · 脆性 MPM 墙',density:fillGap?1100:250,shape:'box',center:[wallX+wallThickness/2,.6,0],size:[wallThickness,1.2,1.2],model:0,fixedFace:'minY',temperature:20,fracture:{enabled:true,onset:fractureOnset,failure:fractureFailure},sampling:{enabled:true,strength:.12,seed:112}}
  );
  return validateModel(model);
}

// A recessed basin joins the approach and departure roads without vertical
// obstacles. Buried, rotated native boxes form continuous rigid banks; their
// upper faces meet the road/floor exactly, and remain editable in the workbench.
export function bicycleRamps({angle=34,waterDepth=.9,waterFriction=.15,driveGain=400,wheelTorque=250,pitchSupport=true}={}){
  if(!Number.isFinite(angle)||angle<30||angle>40||!Number.isFinite(waterDepth)||waterDepth<.7||waterDepth>1.1)throw Error('坡度 30–40°，初始注水高度 0.7–1.1 m');
  if(!Number.isFinite(waterFriction)||waterFriction<0||waterFriction>2)throw Error('水与刚体的切向接触系数须为 0–2');
  if(typeof pitchSupport!=='boolean')throw Error('俯仰助稳开关无效');
  const model=bicycle({mode:'planar',frontDrive:true,pedalGain:driveGain,frontTorque:wheelTorque});
  model.joints.find(j=>j.id==='chain').maxTorque=wheelTorque;
  for(const b of model.bodies){
    if(b.id.endsWith('-wheel'))b.shape='torus';
    // The frame/crank are open mechanisms, not sealed buoyant box hulls.
    if(b.id==='bike-frame'){b.size=[2.1,.12,.12];b.mass=12;}
    if(b.id==='crank')b.size=[.52,.08,.08];
  }
  model.name='鹈鹕自行车 · 双坡深水池';
  const depth=1.2,width=1.2,start=3.2,run=depth/Math.tan(angle*Math.PI/180),toe=start+run,length=3.5,far=toe+length,end=far+run;
  model.bodies=model.bodies.filter(b=>!b.id.startsWith('road-'));
  const solid=(id,name,position,size,rotation=[0,0,0],color='#879f9e')=>{
    const b={id,name,shape:'box',type:'fixed',position,size,rotation,mass:1,friction:1.2,appearance:[primitive('box',[0,0,0],size,color)]};model.bodies.push(b);return b;
  };
  solid('road-0','入口路面',[(start-10)/2,-.12,0],[start+10,.24,3]);
  solid('road-1','出口路面',[(end+60)/2,-.12,0],[60-end,.24,3]);
  solid('pool-floor','下沉水池底面',[toe+length/2,-depth-.12,0],[length+.4,.24,width+.32]);
  for(const [id,name,a,b] of [
    ['pool-ramp-entry','固定入口下坡',[start,0],[toe,-depth]],
    ['pool-ramp-exit','固定出口上坡',[far,-depth],[end,0]],
  ]){
    const theta=Math.atan2(b[1]-a[1],b[0]-a[0]),thickness=1.6,size=[Math.hypot(run,depth),thickness,width+.32];
    const ramp=solid(id,name,[(a[0]+b[0])/2+Math.sin(theta)*thickness/2,(a[1]+b[1])/2-Math.cos(theta)*thickness/2,0],size,[0,0,theta*180/Math.PI],'#b6b6a3');
    // Edge stripes identify the actual drive surface, not a separate collider.
    for(const z of [-.61,.61])ramp.appearance.push(primitive('box',[0,thickness/2+.004,z],[size[0],.008,.045],'#f2d271'));
  }
  for(const sign of [-1,1]){
    const pane=solid('pool-side-'+(sign>0?'a':'b'),'水池透明侧壁',[(start+end)/2,-depth/2+.05,sign*(width/2+.08)],[end-start,depth+.1,.16]);
    pane.appearance=[...[-1,1].map(y=>primitive('box',[0,y*(depth/2+.035),0],[end-start,.03,.16],'#739caa')),...[-1,1].map(x=>primitive('box',[x*(end-start-.03)/2,0,0],[.03,depth+.1,.16],'#739caa'))];
  }
  model.coupling={enabled:true,mechanical:true,thermal:false,friction:waterFriction,
    domain:{lower:[0,-1.6,-1.6],upper:[12,3.2,1.6],cellSize:.2,particlesPerAxis:2},
    parts:[]};
  // Native box layers approximate a trapezoidal fill at sampling resolution.
  // Starting with a tall rectangular column would be a dam-break experiment:
  // its release wave can overturn the bicycle before it reaches the water.
  const layers=Math.ceil(waterDepth/.1-1e-10),step=waterDepth/layers;
  for(let k=0;k<layers;k++)model.coupling.parts.push({id:k?'water-fill-'+k:'water-pool',name:'PBF 水池 · 注水层 '+(k+1),method:'pbf',shape:'box',center:[toe+length/2,-depth+(k+.5)*step,0],size:[length+2*k*step/Math.tan(angle*Math.PI/180),step,width],model:0,temperature:20,sampling:{enabled:true,strength:.03,seed:74+k}});
  // A compliant transmission against a fixed reference is a torsion spring.
  // It supplies a bounded restoring torque, not a prescribed angle or path.
  if(pitchSupport)model.joints.push({id:'pitch-support',name:'可关闭 · 俯仰助稳弹簧',type:'gear',a:'road-0',b:'bike-frame',anchor:model.bodies.find(b=>b.id==='bike-frame').position,axis:[0,0,1],ratio:1,stiffness:600,damping:70,maxTorque:500});
  return validateModel(model);
}
