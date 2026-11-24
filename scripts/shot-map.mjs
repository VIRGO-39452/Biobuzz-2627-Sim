// Maps where the StarterBot can stand to land a shot in the red HIVE's raised CELL (audience side),
// with the launcher at a given speed. Prints a grid: rows = distance from the HIVE pivot axis, columns = sideways offset.
// Usage: node scripts/shot-map.mjs [ticksPerSecond=1250]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const tps = Number(process.argv[2] ?? 1250);
const probe = new Simulator(robot), red = probe.fieldShapes.hives.find((h) => h.id === 'hive_red'), cell = red.cells.find((c) => c.center[2] < 0);
export const wall = probe.fieldShapes.bounds.innerHalfM - probe.assembly.measured.overallM.maxZ;
probe.dispose();
export function shoot(dist, dx, speed = tps, assembly = undefined) {
  const sim = new Simulator(robot, assembly);
  sim.resetPose({ x: -dist, y: cell.center[0] + dx, heading: Math.PI });
  const id = sim.spawnInHopper('pollen');
  for (let i = 0; i < 400; i++) sim.step(0.001);
  sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: speed, pidf: [40, 0, 0, 12.5] });
  for (let i = 0; i < 1500; i++) sim.step(0.001);
  sim.setCRServo('windmill', -1);
  for (let i = 0; i < 4000; i++) sim.step(0.001);
  const p = sim.elements.get(id).body.translation(), hit = p.y > 0.6 && p.x > 0;
  sim.dispose();
  return hit;
}
if (process.argv[1].endsWith('shot-map.mjs')) {
  const offsets = [-0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09];
  console.log(`launcher ${tps} ticks/s; robot backs toward the red HIVE; wall start is ${wall.toFixed(2)} m from the HIVE axis`);
  console.log('dist m   ' + offsets.map((o) => (o >= 0 ? '+' : '') + o.toFixed(2)).join(' ') + '   (sideways offset from the CELL centre, m)');
  let total = 0, hits = 0; const rows = [];
  for (let d = wall; d > 1.0; d -= 0.04) {
    const row = offsets.map((o) => shoot(d, o));
    rows.push([d, row]); total += row.length; hits += row.filter(Boolean).length;
    console.log(d.toFixed(2).padStart(6) + '   ' + row.map((h) => (h ? '  IN ' : '  .  ')).join(' '));
  }
  console.log(`${hits} of ${total} shots landed in the CELL`);
}
