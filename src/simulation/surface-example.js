import {prepareAssistantPlan} from './assistant-commands.js';
import {emptyProject} from './part-builder.js';
import {buildMesh} from './cad-client.js';
import {normalizeProject} from './project.js';
import {validateFEM} from '../fem/model.js';

// Native SMLib geometry and TetGen volume mesh; the same public command path
// used by the assistant creates this example. No hand-authored mesh faces.
export async function namedSurfaceExample(options={}){
  const plan=await prepareAssistantPlan(emptyProject(),{reply:'四孔板命名面示例',commands:[{
    command:'cad.parametric.create',args:{id:'plate',name:'孔壁受压与加热 · 四孔板',method:'fem',template:'four-hole-plate',
      center:[0,.6,0],young:2e6,poisson:.3,density:1000,cp:500,conductivity:50,temperature:20,fixedFace:'x-',
      meshOptions:{kind:'volume',targetSize:.12,angleTolerance:20,chordTolerance:.004}}
  }]},{buildMesh,...options});
  const p=plan.project;p.name='命名孔壁 · 压力与热边界';p.environment.gravity=[0,0,0];
  Object.assign(p.solver,{adapter:'cpu-fem-dynamic',analysis:'linear-dynamic',computeBackend:'cpu',thermal:true,dt:.0002,duration:.04,outputInterval:.002,damping:20,initialState:'rest'});
  p.selectionSets=[
    {id:'support',name:'左侧固定面',part:'plate',entity:'face',region:{type:'surface',surface:'four-hole-plate:x-'}},
    {id:'heated-hole',name:'左前孔壁',part:'plate',entity:'face',region:{type:'surface',surface:'four-hole-plate:hole:x-:z-'}}
  ];
  p.loads=[
    {id:'support-fixed',name:'左侧固定',type:'fem-fixed',target:'plate',selection:'support'},
    {id:'hole-pressure',name:'孔壁压力 1000 Pa',type:'fem-pressure',target:'plate',selection:'heated-hole',pressure:1000},
    {id:'hole-heat',name:'孔壁热源 100 kW',type:'thermal-power',target:'plate',selection:'heated-hole',region:{type:'surface',surface:'four-hole-plate:hole:x-:z-'},power:100000,enabled:true}
  ];
  p.curves=[];p.loadBindings=[];return validateFEM(normalizeProject(p));
}
