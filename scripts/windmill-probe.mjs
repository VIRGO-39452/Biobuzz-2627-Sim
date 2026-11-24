// Windmill probe: several POLLEN in the hopper, windmill running, launcher on or off. Reports how violently things move.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const n = +(process.argv[2] ?? 3), launcher = process.argv[3] === 'on', dir = +(process.argv[4] ?? -1), secs = +(process.argv[5] ?? 6);
const sim = new Simulator(robot);
for (let i = 0; i < n; i++) { sim.spawnInHopper('pollen'); for (let k = 0; k < 400; k++) sim.step(0.001); }
if (launcher) sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 1250, pidf: [40, 0, 0, 12.5] });
for (let k = 0; k < 1500; k++) sim.step(0.001);
sim.setCRServo('windmill', dir);
const start = { ...sim.pose };
let out = 0;
for (let s = 0; s < secs * 2; s++) {
  let maxBall = 0, maxAcc = 0, maxAng = 0, maxLin = 0; const prev = new Map();
  for (let k = 0; k < 500; k++) {
    sim.step(0.001);
    for (const e of sim.elements.values()) { const v = e.body.linvel(), sp = Math.hypot(v.x, v.y, v.z), p = e.body.translation(); const inside = sim.carried().includes(e.id);
      if (inside) { maxBall = Math.max(maxBall, sp); if (prev.has(e.id)) { const q = prev.get(e.id); maxAcc = Math.max(maxAcc, Math.hypot(v.x - q.x, v.y - q.y, v.z - q.z) / 0.001); } prev.set(e.id, { x: v.x, y: v.y, z: v.z }); } else prev.delete(e.id); }
    const a = sim.body.angvel(), l = sim.body.linvel(); maxAng = Math.max(maxAng, Math.hypot(a.x, a.y, a.z)); maxLin = Math.max(maxLin, Math.hypot(l.x, l.y, l.z));
  }
  const w = sim.devices.get('windmill');
  console.log(`t=${sim.time.toFixed(1)} carried ${sim.carried().length}  ball vmax ${maxBall.toFixed(2)} m/s amax ${maxAcc.toFixed(0)} m/s2 | chassis wmax ${maxAng.toFixed(3)} rad/s vmax ${maxLin.toFixed(3)} m/s | windmill rpm ${(w.omega * 60 / 6.283).toFixed(0)} | drift mm ${((sim.pose.x - start.x) * 1000).toFixed(1)},${((sim.pose.y - start.y) * 1000).toFixed(1)} deg ${((sim.pose.heading - start.heading) * 57.3).toFixed(2)}`);
}
