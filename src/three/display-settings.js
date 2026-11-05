import {installLocale} from './locale.js';

export function installDisplaySettings(renderer){
  const key='summer-workbench-display-v1',defaults={theme:'mist',background:'#0d191f',language:'zh',particleShading:true};
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  const settings={...defaults,...saved};
  if(!['mist','sand','ice','graphite'].includes(settings.theme))settings.theme=defaults.theme;
  if(!/^#[\da-f]{6}$/i.test(settings.background))settings.background=defaults.background;
  if(!['zh','en'].includes(settings.language))settings.language='zh';
  settings.particleShading=settings.particleShading!==false;
  const dialog=document.createElement('dialog');dialog.id='display-settings3';dialog.setAttribute('aria-labelledby','display-title3');
  dialog.innerHTML=`<div class="display-heading"><div><small>DISPLAY / PREFERENCES</small><h2 id="display-title3">外观与语言</h2></div><form method="dialog"><button aria-label="关闭外观设置">×</button></form></div>
    <label for="theme-choice3">面板配色</label><select id="theme-choice3"><option value="mist">雾白玻璃</option><option value="sand">暖砂玻璃</option><option value="ice">冰蓝玻璃</option><option value="graphite">深石墨玻璃</option></select>
    <label for="canvas-color3">画布背景颜色</label><div class="color-setting"><input type="color" id="canvas-color3" aria-label="画布背景颜色"><output id="canvas-color-value3"></output></div>
    <div class="background-presets"><button data-background="#0d191f">深海</button><button data-background="#e9efef">浅雾</button><button data-background="#182d42">夜蓝</button></div>
    <label class="check"><input type="checkbox" id="particle-shading3" checked>粒子立体光照</label><p class="hint">球面阴影与高光；关闭后显示原始色阶，便于对照温度图例。</p>
    <label for="language-choice3">界面语言 / Language</label><select id="language-choice3"><option value="zh">简体中文</option><option value="en">English</option></select>
    <p>立即生效并自动保存；不会重置当前实验。</p><button id="display-default3">恢复默认外观</button>`;
  document.body.append(dialog);
  const button=document.createElement('button');button.id='display-open3';button.textContent='外观 / 语言';button.setAttribute('aria-haspopup','dialog');button.onclick=()=>dialog.showModal();
  document.querySelector('header').insertBefore(button,document.querySelector('#collapse'));
  const $=id=>document.getElementById(id),locale=installLocale(settings.language);
  function apply(){
    document.body.dataset.theme=settings.theme;
    document.body.style.setProperty('--canvas-background',settings.background);
    const rgb=[1,3,5].map(i=>parseInt(settings.background.slice(i,i+2),16)/255);
    renderer.particleShading=settings.particleShading;$('particle-shading3').checked=settings.particleShading;
    renderer.background=rgb;renderer.lightBackground=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.5;
    document.body.dataset.lightCanvas=String(renderer.lightBackground);
    $('theme-choice3').value=settings.theme;$('canvas-color3').value=settings.background;$('canvas-color-value3').textContent=settings.background.toUpperCase();$('language-choice3').value=settings.language;
    locale.setLanguage(settings.language);
    try{localStorage.setItem(key,JSON.stringify(settings));}catch{}
  }
  $('particle-shading3').onchange=e=>{settings.particleShading=e.target.checked;apply();};
  $('theme-choice3').onchange=e=>{settings.theme=e.target.value;apply();};
  $('canvas-color3').oninput=e=>{settings.background=e.target.value;apply();};
  $('language-choice3').onchange=e=>{settings.language=e.target.value;apply();};
  dialog.querySelectorAll('[data-background]').forEach(button=>button.onclick=()=>{settings.background=button.dataset.background;apply();});
  $('display-default3').onclick=()=>{settings.theme=defaults.theme;settings.background=defaults.background;settings.particleShading=defaults.particleShading;apply();};
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>button.focus());
  apply();return locale;
}
