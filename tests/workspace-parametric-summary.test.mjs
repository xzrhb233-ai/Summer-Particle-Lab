import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkspaceContext,summaryTokens,configurationId} from '../src/simulation/workspace-context.js';
import {createParametricSpec,PARAMETRIC_TEMPLATES} from '../src/simulation/cad-parametric.js';
import {emptyProject} from '../src/simulation/part-builder.js';

const text=tokens=>tokens.map(t=>t.text).join('');
function project(template='four-hole-plate',parameters={}){
  const p=emptyProject();
  p.parts=[{id:'parametric',name:'参数零件',method:'mpm',modeling:createParametricSpec(template,parameters),geometry:{shape:'cad',center:[.2,.7,.1],size:[.9,.16,.7],rotation:[0,25,0]}}];
  return p;
}
const context=(p,extra={})=>buildWorkspaceContext({project:p,selectedPartId:'parametric',...extra});

test('geometry summary describes applied named dimensions with shared metadata and SI length units',()=>{
  for(const template of PARAMETRIC_TEMPLATES){
    const p=project(template.id),tokens=summaryTokens(context(p),'geometry'),summary=text(tokens);
    assert.match(summary,/已应用参数化模板/);assert.match(summary,/原始局部参数/);
    assert.ok(tokens.some(t=>t.text===template.label&&t.tone==='info'));
    for(const f of template.fields){
      assert.ok(summary.includes(f.label+' '+p.parts[0].modeling.parameters[f.key]+' '+(f.unit==='deg'?'°':f.unit)));
      assert.ok(tokens.some(t=>t.text===String(p.parts[0].modeling.parameters[f.key])+' '+(f.unit==='deg'?'°':f.unit)&&t.tone==='info'));
    }
    assert.match(summary,/0.2, 0.7, 0.1 m/);
  }
});

test('unapplied parameter drafts never replace the current settings summary or configuration snapshot',()=>{
  const p=project(),before=JSON.stringify(p),draft={parametricDraft:{modeling:createParametricSpec('four-hole-plate',{width:2.5,holeDiameter:.18}),unsavedChanges:true}};
  const c=context(p,{draft,pending:['参数化尺寸']}),summary=text(summaryTokens(c,'geometry'));
  assert.match(summary,/板宽 X 0.9 m/);assert.match(summary,/孔径 0.14 m/);
  assert.doesNotMatch(summary,/2.5 m|孔径 0.18/);assert.match(summary,/待应用：参数化尺寸/);
  assert.equal(c.configurationId,configurationId(p));assert.equal(JSON.stringify(p),before);
  assert.equal(c.draft.parametricDraft.modeling.parameters.width,2.5);
});

test('summary distinguishes original local parameters from a part size changed by whole-part scaling',()=>{
  const p=project('sleeve');p.parts[0].geometry.size=[1.6,1.2,1.6];
  const summary=text(summaryTokens(context(p),'geometry'));
  assert.match(summary,/尺寸 1.6 × 1.2 × 1.6 m/);assert.match(summary,/原始局部参数/);
  assert.match(summary,/外半径 0.4 m/);assert.match(summary,/旋转角度 360 °/);
});

test('English summary and part selection identify the current applied parametric model only',()=>{
  const p=project('sleeve'),summary=text(summaryTokens(context(p),'geometry',true));
  assert.match(summary,/Applied parametric template Hollow sleeve/);assert.match(summary,/Inner radius 0.2 m/);assert.match(summary,/Revolution angle 360 °/);
  assert.doesNotMatch(summary,/参数化模板|内半径|旋转角度/);
  p.parts.push({id:'ordinary',name:'Box',method:'mpm',geometry:{center:[0,0,0],size:[1,1,1]}});
  assert.doesNotMatch(text(summaryTokens(context(p,{selectedPartId:'ordinary'}),'geometry')),/参数化模板/);
  assert.doesNotMatch(text(summaryTokens(context(p,{selectedPartId:null}),'geometry')),/参数化模板/);
  assert.doesNotMatch(text(summaryTokens(context(p),'solver')),/参数化模板/);
});

test('unknown or incomplete parameter metadata does not break the existing geometry summary',()=>{
  for(const change of [s=>s.schema='other',s=>s.template='unknown',s=>delete s.parameters.width,s=>s.parameters.width='0.9']){
    const p=project();change(p.parts[0].modeling);
    const summary=text(summaryTokens(context(p),'geometry'));
    assert.match(summary,/当前部件 参数零件/);assert.doesNotMatch(summary,/已应用参数化模板/);
  }
});
