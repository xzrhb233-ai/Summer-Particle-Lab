import { Simulation } from './simulation.js';
const simulation = new Simulation();
let paused = false, lastMs = 0, started = false, availableBuffer;
let frameInFlight = false, simulationMs = 0, pending = false;
function publish() {
  if (frameInFlight) { pending = true; return; }
  pending = false;
  const state = simulation.snapshot(availableBuffer);
  availableBuffer = undefined; frameInFlight = true;
  self.postMessage({ type: 'frame', ...state, ms: simulationMs, gravity: simulation.settings.gravity, paused }, [state.buffer]);
}
function tick() {
  const now = performance.now();
  // No catch-up spiral when a slow device or a background tab misses its budget.
  if (!paused && now - lastMs >= 15) {
    const begin = performance.now();
    simulation.step((1 / 60) * simulation.settings.speed);
    simulationMs = performance.now() - begin;
    lastMs = now;
    publish();
  }
  if (paused && simulation.pointer.active && ['emit', 'erase', 'heat', 'cool','anchor','release','cut'].includes(simulation.pointer.tool)) {
    simulation.buildGrid(); simulation.interact(1 / 30);
    for (let i = 0; i < simulation.count; i++) simulation.phaseTransition(i);
    simulation.buildGrid();simulation.flushBonds();
    publish();
  }
  setTimeout(tick, paused ? 35 : Math.max(0, 16 - simulationMs));
}
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    simulation.reset(data.scene || 'planet');
    publish();
    if (!started) { started = true; tick(); }
  } else if (data.type === 'recycle') {
    availableBuffer = data.buffer; frameInFlight = false;
    if (pending) publish();
  } else if (data.type === 'pointer') {
    const starting = data.pointer.active && !simulation.pointer.active;
    simulation.setPointer(data.pointer);
    // A short click always stamps material, even between two physics ticks.
    if ((starting || paused) && data.pointer.active && ['emit', 'erase', 'heat', 'cool','anchor','release','cut'].includes(simulation.pointer.tool)) {
      simulation.buildGrid(); simulation.interact(1 / 30);
      for (let i = 0; i < simulation.count; i++) simulation.phaseTransition(i);
      simulation.buildGrid();simulation.flushBonds();
      publish();
    }
  } else if (data.type === 'structure') {
    const ok=simulation.structures.create(data.structure);
    simulation.buildGrid();simulation.flushBonds();
    self.postMessage({type:'structure-result',ok,mpm:data.structure.material===11});publish();
  } else if (data.type === 'settings') {
    Object.assign(simulation.settings, data.settings);
    simulation.gravityMs = 0;
    publish();
  }
  else if (data.type === 'pause') { paused = data.paused; simulation.pointer.active = false; publish(); }
  else if (data.type === 'reset' || data.type === 'clear') {
    simulation.reset(data.type === 'clear' ? 'empty' : data.scene);
    simulationMs = 0; publish();
  }
};
