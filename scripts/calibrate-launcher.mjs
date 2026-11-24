// Launcher calibration. The one launcher parameter nobody publishes is how well the flywheel grips the
// ball; it sets how much the ball slips and therefore how far it flies. This script sweeps that grip
// (the flywheel's friction coefficient in robots/biobuzz-assembly.json -> mechanisms) and reports,
// for each value, the exit speed and how many shots from given positions land in the red HIVE's raised CELL.
// Usage: node scripts/calibrate-launcher.mjs [friction values...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator, loadAssembly } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
import { shoot, wall } from './shot-map.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const base = loadAssembly(robot);
const values = process.argv.slice(2).map(Number).filter((v) => v > 0);
const offsets = [-0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09], dists = [wall, wall - 0.04, wall - 0.08, wall - 0.12, wall - 0.16];
function exitSpeed(assembly) { // open floor, so nothing is in the way
  const sim = new Simulator({ ...robot, field: { sizeM: 1000 } }, assembly);
  const id = sim.spawnInHopper('pollen');
  for (let i = 0; i < 400; i++) sim.step(0.001);
  sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 1250, pidf: [40, 0, 0, 12.5] });
  for (let i = 0; i < 1500; i++) sim.step(0.001);
  sim.setCRServo('windmill', -1);
  let v = null, land = null, prevY = 0;
  for (let i = 0; i < 4000 && !land; i++) { sim.step(0.001); const b = sim.elements.get(id).body, p = b.translation(); if (!v && p.y > 0.3) v = { ...b.linvel() }; if (v && prevY > 0.2 && p.y < 0.04) land = -p.z; prevY = p.y; }
  sim.dispose();
  return { speed: v ? Math.hypot(v.x, v.y, v.z) : 0, angle: v ? (Math.atan2(v.y, -v.z) * 180) / Math.PI : 0, range: land };
}
console.log(`wall start is ${wall.toFixed(2)} m from the HIVE axis; rows show hits out of ${offsets.length} sideways offsets at each distance`);
console.log('grip   exit m/s  angle  floor range m   ' + dists.map((d) => d.toFixed(2)).join('  ') + '   total');
for (const mu of values.length ? values : [0.9, 0.8, 0.7, 0.6, 0.5]) {
  const assembly = structuredClone(base);
  assembly.mechanisms.find((m) => m.id === 'launcher_flywheel').friction = mu;
  const e = exitSpeed(assembly), hits = dists.map((d) => offsets.filter((o) => shoot(d, o, 1250, assembly)).length);
  console.log(`${mu.toFixed(2)}   ${e.speed.toFixed(2).padStart(6)}   ${e.angle.toFixed(0).padStart(4)}   ${(e.range ?? 0).toFixed(2).padStart(8)}        ` + hits.map((h) => String(h).padStart(4)).join('  ') + `   ${hits.reduce((a, b) => a + b, 0)}/${dists.length * offsets.length}`);
}
