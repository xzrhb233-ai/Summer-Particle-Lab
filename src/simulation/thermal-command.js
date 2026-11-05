import {editLegacyProject} from './project.js';

// Validate on a copy. The session document changes only after solver acknowledgement.
export function thermalCommand(project, command) {
  return editLegacyProject(project, model => {
    if (command.type === 'region-heat') {
      if (!model.coupling?.enabled) throw Error('项目未启用粒子耦合');
      model.coupling.heater = {...model.coupling.heater, ...command.value};
    } else if (command.type === 'body-heat') {
      const body = model.bodies.find(b => b.id === command.id);
      if (!body) throw Error('热源刚体不存在');
      body.thermal.power = command.power;
    } else throw Error('未知在线热源命令');
    for(const b of model.loadBindings)if(b.kind===command.type&&b.target===(command.type==='region-heat'?'mpm':command.id))b.enabled=false;
  });
}
