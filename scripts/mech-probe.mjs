// Mechanism probe: follows POLLEN through intake -> hopper -> windmill -> launcher with fixed commands.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const f = (v) => (v * 1000).toFixed(0).padStart(5);
const sim = new Simulator(robot);
console.log('interior shapes:', sim.shapes ? `${sim.shapes.boxes.length} boxes, ${sim.shapes.meshes.length} meshes` : 'none', '| mechanisms:', sim.mechanisms.length);
const arg = process.argv[2] ?? 'intake';
const ball = (id) => { const e = sim.elements.get(id); const p = e.body.translation(), v = e.body.linvel(); return `${id.padEnd(9)} x${f(p.x)} y${f(p.y - 0.048)} z${f(p.z)}  v ${Math.hypot(v.x, v.y, v.z).toFixed(2)}`; };
const report = (label) => console.log(label.padEnd(18), [...sim.elements.keys()].map(ball).join(' | '), ' carried', sim.carried().length, ' robot z', f(sim.pose.x), 'arm lift deg', ((sim.joints.get('intake_arm')?.lift ?? 0) * 180 / Math.PI).toFixed(1));
const run = (s, every = 0) => { for (let i = 0; i < s * 1000; i++) { sim.step(0.001); if (every && i % (every * 1000) === 0) report(`t=${sim.time.toFixed(2)}`); } };
if (arg === 'intake') {
  sim.spawnElement('pollen', { x: 0, z: 0.45 });
  sim.setMotorCommand('intake', { power: 1 }); sim.setCRServo('left_intake_servo', 1); sim.setCRServo('right_intake_servo', -1);
  sim.setMotorCommand('left_drive', { power: 0.25 }); sim.setMotorCommand('right_drive', { power: -0.25 });
  report('start'); run(2.5, 0.25); report('end');
} else if (arg === 'launch') {
  sim.spawnInHopper('pollen');
  run(0.5); report('settled');
  sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 1250, pidf: [40, 0, 0, 12.5] });
  run(1.5); report('spun up');
  console.log('launcher tps', (sim.devices.get('launcher').omega * 28 / (2 * Math.PI)).toFixed(0));
  sim.setCRServo('windmill', -1);
  let minTps = 1e9, maxH = 0, exitV = null;
  for (let i = 0; i < 3000; i++) { sim.step(0.001); const d = sim.devices.get('launcher'); minTps = Math.min(minTps, d.omega * 28 / (2 * Math.PI)); const e = sim.elements.get('pollen-1'), p = e.body.translation(), v = e.body.linvel(); maxH = Math.max(maxH, p.y); if (!exitV && p.y > 0.25) exitV = { t: sim.time, v: [v.x, v.y, v.z].map((x) => +x.toFixed(2)), p: [p.x, p.y, p.z].map((x) => +x.toFixed(3)) }; if (i % 250 === 0) report(`t=${sim.time.toFixed(2)}`); }
  console.log('min launcher tps during shot', minTps.toFixed(0), 'max height m', maxH.toFixed(2), 'exit', JSON.stringify(exitV));
}

if (arg === 'cycle') {
  // Same logic as goBILDA's TeleOp: intake while driving into four staged POLLEN, then launch with the windmill gated on flywheel speed.
  sim.stageElements('match');
  for (const id of [...sim.elements.keys()].slice(0, 8)) sim.removeElement(id);
  const tps = () => sim.devices.get('launcher').omega * 28 / (2 * Math.PI);
  sim.setMotorCommand('intake', { power: 1 }); sim.setCRServo('left_intake_servo', 1); sim.setCRServo('right_intake_servo', -1);
  sim.setMotorCommand('left_drive', { power: 0.3 }); sim.setMotorCommand('right_drive', { power: -0.3 });
  sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 0, pidf: [40, 0, 0, 12.5] });
  run(1.2); report('after intake drive');
  sim.setMotorCommand('left_drive', { power: 0 }); sim.setMotorCommand('right_drive', { power: 0 });
  run(1.0); report('stopped');
  sim.setMotorCommand('intake', { power: 0 }); sim.setCRServo('left_intake_servo', 0); sim.setCRServo('right_intake_servo', 0);
  sim.setMotorCommand('launcher', { velTicks: 1250 });
  const out = new Set(); let shots = [];
  for (let i = 0; i < 12000; i++) {
    const fast = tps() > 1200;
    sim.setCRServo('windmill', fast ? -1 : 0); sim.setMotorCommand('intake', { power: fast ? 0.5 : 0 });
    sim.step(0.001);
    for (const e of sim.elements.values()) { const p = e.body.translation(); if (!out.has(e.id) && p.y > 0.6) { out.add(e.id); shots.push(`${e.id}@${sim.time.toFixed(2)}s`); } }
    if (i % 2000 === 1999) report(`launch t=${sim.time.toFixed(1)}`);
  }
  console.log('launched:', shots.join(', ') || 'none', '| still carried:', sim.carried().join(', ') || 'none');
}
