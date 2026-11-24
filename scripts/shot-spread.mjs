// How repeatable is the launcher? Fires N shots on open floor, each with the ball starting a few
// millimetres differently in the hopper, and reports the spread of exit speed, angle and landing distance.
// Usage: node scripts/shot-spread.mjs [ticksPerSecond=1250] [shots=16]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
export function spread(tps = 1250, shots = 16, assembly = undefined) {
  const out = [];
  for (let k = 0; k < shots; k++) {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } }, assembly);
    const id = sim.spawnInHopper('pollen');
    const b = sim.elements.get(id).body, p0 = b.translation();
    b.setTranslation({ x: p0.x + ((k % 4) - 1.5) * 0.004, y: p0.y, z: p0.z + (Math.floor(k / 4) - 1.5) * 0.004 }, true);
    for (let i = 0; i < 400; i++) sim.step(0.001);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: tps, pidf: [40, 0, 0, 12.5] });
    for (let i = 0; i < 1500; i++) sim.step(0.001);
    sim.setCRServo('windmill', -1);
    let v = null, land = null, prevY = 0, apex = 0;
    for (let i = 0; i < 5000 && land == null; i++) { sim.step(0.001); const p = b.translation(); apex = Math.max(apex, p.y); if (!v && p.y > 0.3) v = { ...b.linvel() }; if (v && prevY >= 0.045 && p.y < 0.045) land = { z: -p.z, x: p.x }; prevY = p.y; }
    if (v && land) out.push({ speed: Math.hypot(v.x, v.y, v.z), angle: (Math.atan2(v.y, -v.z) * 180) / Math.PI, range: land.z, side: land.x, apex });
    sim.dispose();
  }
  const stat = (key) => { const a = out.map((o) => o[key]), m = a.reduce((x, y) => x + y, 0) / a.length; return { mean: m, sd: Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length), min: Math.min(...a), max: Math.max(...a) }; };
  return { launched: out.length, shots, speed: stat('speed'), angle: stat('angle'), range: stat('range'), side: stat('side'), apex: stat('apex') };
}
if (process.argv[1].endsWith('shot-spread.mjs')) {
  const r = spread(Number(process.argv[2] ?? 1250), Number(process.argv[3] ?? 16));
  const line = (name, s, unit) => console.log(`${name.padEnd(18)} mean ${s.mean.toFixed(2)} ${unit}, spread +/-${s.sd.toFixed(2)} (min ${s.min.toFixed(2)}, max ${s.max.toFixed(2)})`);
  console.log(`${r.launched} of ${r.shots} balls launched`);
  line('exit speed', r.speed, 'm/s'); line('exit angle', r.angle, 'deg'); line('apex height', r.apex, 'm'); line('landing distance', r.range, 'm'); line('sideways drift', r.side, 'm');
}
