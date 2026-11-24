// Field probe: HIVE tipping, FLOWER retrieval and shots at the HIVE.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const run = (sim, s, each) => { for (let i = 0; i < s * 1000; i++) { sim.step(0.001); each?.(i); } };
const deg = (r) => (r * 180 / Math.PI).toFixed(1);
const arg = process.argv[2];
if (arg === 'tip') {
  const sim = new Simulator(robot); sim.stageElements(); run(sim, 1);
  const red = sim.hives.find((h) => h.id === 'hive_red'), cell = sim.fieldShapes.elements.filter((e) => e.type === 'nectar_red' && e.where === 'hive cell');
  const cx = cell.reduce((a, e) => a + e.p[0], 0) / 3, cz = cell[0].p[2];
  console.log('red HIVE swing', deg(red.cfg.swingRad), 'cell nectar at', cx.toFixed(2), cell[0].p[1].toFixed(2), cz.toFixed(2));
  for (let n = 1; n <= 14; n++) {
    sim.spawnElement('pollen', { x: cx + ((n % 3) - 1) * 0.09, y: cell[0].p[1] + 0.25, z: cz - 0.05, home: false });
    run(sim, 1.2);
    const h = sim.snapshot().hives.find((x) => x.id === 'hive_red');
    const inCell = [...sim.elements.values()].filter((e) => e.body.translation().y > 0.6 && e.body.translation().x > 0).length;
    console.log(`dropped ${n} POLLEN -> angle ${deg(h.angle)} tipped ${h.tipped}; elements still up in the red HIVE: ${inCell}`);
    if (h.tipped) break;
  }
  run(sim, 2); console.log('after settling: angle', deg(sim.snapshot().hives.find((x) => x.id === 'hive_red').angle), 'blue', deg(sim.snapshot().hives.find((x) => x.id === 'hive_blue').angle));
} else if (arg === 'flower') {
  const sim = new Simulator(robot); const f = sim.fieldShapes.statics.find((s) => s.id === 'flower_1');
  // face the FLOWER on the audience wall: heading 180 deg points the intake at -Z
  const side = Number(process.argv[3] ?? 0); // lateral offset of the robot from the FLOWER, metres
  sim.resetPose({ x: f.center[1] + 0.75, y: f.center[0] + side, heading: Math.PI }); sim.stageElements();
  for (const e of [...sim.elements.values()]) if (Math.hypot(e.body.translation().x - sim.pose.y, e.body.translation().z - sim.pose.x) < 0.5 && e.body.translation().y < 0.05 && Math.abs(e.body.translation().z - f.center[1]) > 0.2) sim.removeElement(e.id); // drop the pre-loads
  run(sim, 0.5);
  sim.setMotorCommand('intake', { power: 1 }); sim.setCRServo('left_intake_servo', 1); sim.setCRServo('right_intake_servo', -1);
  sim.setMotorCommand('left_drive', { power: 0.25 }); sim.setMotorCommand('right_drive', { power: -0.25 });
  const stack = () => [...sim.elements.values()].filter((e) => Math.hypot(e.body.translation().x - f.center[0], e.body.translation().z - f.center[1]) < 0.04).length;
  run(sim, 6, (i) => { if (i % 1000 === 999) console.log(`t=${sim.time.toFixed(1)} robot z ${sim.pose.x.toFixed(3)} carried ${sim.carried().length} left in FLOWER ${stack()} arm ${deg(sim.joints.get('intake_arm').lift)}`); });
} else if (arg === 'shoot') {
  for (const dist of [0.5, 0.7, 0.9, 1.1, 1.3]) for (const tps of [1250, 1000]) {
    const sim = new Simulator(robot);
    const red = sim.fieldShapes.hives.find((h) => h.id === 'hive_red');
    sim.resetPose({ x: -dist, y: red.pivot[0], heading: Math.PI }); // back toward the red HIVE's audience-side CELL
    const id = sim.spawnInHopper('pollen');
    run(sim, 0.4);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: tps, pidf: [40, 0, 0, 12.5] }); run(sim, 1.5);
    sim.setCRServo('windmill', -1);
    let apex = 0; run(sim, 4, () => { apex = Math.max(apex, sim.elements.get(id).body.translation().y); });
    const p = sim.elements.get(id).body.translation();
    console.log(`robot ${dist.toFixed(1)} m from the HIVE axis, ${tps} ticks/s: apex ${apex.toFixed(2)} m, ends at x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)} ${p.y > 0.6 ? '-> IN THE HIVE' : ''}`);
  }
}
if (arg === 'wallshot') {
  // goBILDA's autonomous starts with the front against the wall and launches. Which flywheel speed drops a POLLEN into the raised (far-side) blue CELL from there?
  const blue = new Simulator(robot).fieldShapes.hives.find((h) => h.id === 'hive_blue');
  for (const zr of [-1.53, -1.3]) for (const tps of [1250, 1150, 1050, 950, 850]) {
    const sim = new Simulator(robot);
    sim.resetPose({ x: zr, y: blue.pivot[0], heading: Math.PI });
    const id = sim.spawnInHopper('pollen');
    run(sim, 0.4);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: tps, pidf: [40, 0, 0, 12.5] }); run(sim, 1.5);
    sim.setCRServo('windmill', -1);
    let apex = 0; run(sim, 4, () => { apex = Math.max(apex, sim.elements.get(id).body.translation().y); });
    const p = sim.elements.get(id).body.translation();
    console.log(`robot z ${zr}, ${tps} ticks/s: apex ${apex.toFixed(2)} m, ends at x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)} ${p.y > 0.6 ? '-> IN THE BLUE HIVE' : ''}`);
  }
}
if (arg === 'redwall') {
  // The red HIVE's raised CELL is on the audience side. Shoot at it from the audience wall, back toward the HIVE.
  const probe = new Simulator(robot), red = probe.fieldShapes.hives.find((h) => h.id === 'hive_red');
  const cell = red.cells.find((c) => c.center[2] < 0);
  console.log('red raised CELL centre', cell.center.map((v) => v.toFixed(2)).join(', '), '| flywheel surface speed at 1250 ticks/s:', ((1250 / 28) * 2 * Math.PI * 0.048).toFixed(1), 'm/s (a ball rolling on the ramp would leave at half that)');
  const wallZ = -(probe.fieldShapes.bounds.innerHalfM - probe.assembly.measured.overallM.maxZ - 0.005);
  for (const zr of [wallZ, wallZ + 0.1, wallZ + 0.2, wallZ + 0.3]) for (const tps of [1250]) for (const dx of [0, -0.1, 0.1]) {
    const sim = new Simulator(robot);
    sim.resetPose({ x: zr, y: cell.center[0] + dx, heading: Math.PI });
    const id = sim.spawnInHopper('pollen');
    run(sim, 0.4);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: tps, pidf: [40, 0, 0, 12.5] }); run(sim, 1.5);
    sim.setCRServo('windmill', -1);
    let apex = 0, exit = null; run(sim, 4, () => { const b = sim.elements.get(id).body, p = b.translation(); apex = Math.max(apex, p.y); if (!exit && p.y > 0.3) exit = b.linvel(); });
    const p = sim.elements.get(id).body.translation();
    console.log(`robot z ${zr.toFixed(2)} x ${(cell.center[0] + dx).toFixed(2)}, ${tps}: exit ${exit ? Math.hypot(exit.x, exit.y, exit.z).toFixed(1) + ' m/s' : 'none'}, apex ${apex.toFixed(2)}, ends x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)} ${p.y > 0.6 ? '-> IN THE RED HIVE' : ''}`);
  }
}
