import {CoupledSimulation} from '../multibody/coupled.js';
import {toLegacy,normalizeSolverProject,editLegacyProject} from './project.js';
import {MechanicalDiagnostics} from './mechanical-diagnostics.js';
import {attachParticleThermalLoads} from './thermal-ports.js';

// Keep the verified force/heat exchange integrator intact behind a project
// adapter. No per-domain independent stepping: all fields share its clock.
export const cpuCoupledAdapter = {
  id: 'cpu-coupled', methods: ['rigid', 'mpm', 'pbf'], fields: ['motion', 'temperature'],
  normalize: normalizeSolverProject,
  create(project) {
    const engine = new CoupledSimulation(toLegacy(project));
    try{attachParticleThermalLoads(project,engine);}catch(e){engine.free();throw e;}
    const diagnostics=project.solver.diagnostics?new MechanicalDiagnostics(engine):null;
    const mpmParts = project.parts.filter(p => ['mpm','pbf'].includes(p.method));
    function frame(raw) {
      diagnostics?.sample(raw);
      const parts = raw.bodies.map(b => ({id: b.id, method: 'rigid',
        values: {position: b.position, displacement: b.displacement, velocity: b.velocity,
          temperature: b.temperature ?? null, contactForce: b.contactForce ?? null, kinetic: b.kinetic}}));
      if (engine.particles) {
        const s = engine.particles;
        for (const [index, definition] of mpmParts.entries()) {
          let mass = 0, temperature = 0, count = 0, plastic = 0, damage=0, failed=0;
          const center = [0, 0, 0], velocity = [0, 0, 0];
          for (let i = 0; i < s.count; i++) if (s.lab.part[i] === index + 1) {
            count++; mass += s.mass[i]; temperature += s.temperature[i] * s.mass[i];
            plastic = Math.max(plastic, s.mpm.plastic[i]);damage=Math.max(damage,s.damage[i]);failed+=s.damage[i]>=1?1:0;
            for (let k = 0; k < 3; k++) {center[k] += raw.particles[i * 8 + k] * s.mass[i];velocity[k] += s[['vx','vy','vz'][k]][i] * .025 * s.mass[i];}
          }
          parts.push({id: definition.id, method: definition.method, values: {count, mass,
            temperature: mass ? temperature / mass : null, position: mass ? center.map(x => x / mass) : null,
            displacement: mass ? center.map((x,k)=>x/mass-definition.geometry.center[k]) : null,
            velocity: mass ? velocity.map(x=>x/mass) : null, plastic,damage,failed}});
        }
      }
      raw.results = {schema: 'summer-results/1', time: raw.time,
        units: {position: 'm', velocity: 'm/s', temperature: 'degC', contactForce: 'N', kinetic: 'J'},
        contactPairs:raw.contactPairs??[], loads: raw.loadResponses, parts, connections: raw.joints, balance: {
          mechanical:raw.diagnostics??null,thermalResidual:raw.coupling?.thermalResidual??null,externalHeat:raw.coupling?.externalHeat??null}};
      return raw;
    }
    return {
      get project() { return editLegacyProject(project,d=>Object.assign(d,engine.model)); }, get time() { return engine.time; },
      snapshot: () => frame(engine.snapshot()), step: dt => frame(engine.step(dt)),
      command(command) {
        if(command.type==='region-heat')engine.setHeater(command.value);
        else if(command.type==='body-heat')engine.setThermalPower(command.id,command.power);
        else throw Error('求解器不支持此在线命令');
      },
      free: () => engine.free(),
    };
  },
};
