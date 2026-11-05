import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const root='.diagnostics/solid-beading/';
const cases=['drop','press'].flatMap(loading=>[false,true].map(enabled=>{
  const data=JSON.parse(readFileSync(`${root}cuda-${loading}-${enabled}.json`));
  return {...data,label:`${loading==='drop'?'自由下落':'压板压缩'} · ${enabled?'开启固体整理':'关闭固体整理'}`};
}));
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/solid-beading.html',`<!doctype html><meta charset="utf-8"><title>固体采样对照 · CUDA</title><style>
body{margin:24px;background:#e9eff0;color:#20343a;font:15px system-ui}h1{font-size:24px}p{max-width:960px;line-height:1.7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:white;border:1px solid #c8d4d8;padding:16px}h2{font-size:18px;margin:0 0 6px}canvas{width:100%;aspect-ratio:1.55;display:block}small{color:#52676e}strong{color:#177b6e}
</style><h1>MPM 固体珠串化 · CUDA 对照</h1><p>温度相关 J2，20°C；随机种子 42，初始扰动 20%；每组推进 6 秒。每个圆点是一个真实物质点，两列使用相同相机和比例。拖动任意图可同步旋转观察。</p><div class="grid"></div><p>“过近点对”指中心距小于初始间距的一半（2）。整理是有界的数值采样修正，保持速度、质量、焓和本构历史，但会影响局部形变；不是经工程验证的本构或断裂模型。</p><script>
const cases=${JSON.stringify(cases)};let yaw=.65,pitch=.35;const canvases=[];
for(const data of cases){const card=document.createElement('div');card.className='card';card.innerHTML='<h2>'+data.label+'</h2><small>过近点对：<strong>'+data.close+'</strong> · 最近点距：'+data.minimum.toFixed(3)+'</small>';const canvas=document.createElement('canvas');canvas.width=720;canvas.height=460;card.append(canvas);document.querySelector('.grid').append(card);canvases.push(canvas);let last=null;canvas.onpointerdown=e=>{last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};canvas.onpointerup=()=>last=null;canvas.onpointermove=e=>{if(!last)return;yaw+=(e.clientX-last[0])*.01;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-last[1])*.01));last=[e.clientX,e.clientY];draw()}}
function draw(){canvases.forEach((canvas,i)=>{const ctx=canvas.getContext('2d');ctx.clearRect(0,0,720,460);const points=cases[i].points.map(([x,y,z])=>{y+=37;const u=x*Math.cos(yaw)-z*Math.sin(yaw),v=x*Math.sin(yaw)+z*Math.cos(yaw);return [360+u*8,255-(y*Math.cos(pitch)-v*Math.sin(pitch))*8,y*Math.sin(pitch)+v*Math.cos(pitch)]}).sort((a,b)=>a[2]-b[2]);for(const [x,y,z] of points){ctx.fillStyle=cases[i].enabled?'#168e87':'#ba4e4b';ctx.globalAlpha=.82;ctx.beginPath();ctx.arc(x,y,3.1,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1})}draw();</script>`);
