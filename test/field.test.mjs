import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator, loadField, loadFieldShapes } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const field = loadField(), shapes = loadFieldShapes(field);
const manual = readFileSync(join(ROOT, 'research', 'manual', 'manual.txt'), 'utf8');
const run = (sim, seconds, each) => { for (let i = 0; i < seconds * 1000; i++) { sim.step(0.001); each?.(); } return sim; };
const IN = 0.0254;
const skip = !shapes && 'run "npm run cad:field" to convert the official field CAD';

describe('field structures from the official FIRST field CAD', { skip }, () => {
  test('CAD dimensions agree with the competition manual', () => {
    assert.match(manual, /pivots with their axis 43\.95 in\./);
    for (const h of shapes.hives) assert.ok(Math.abs(h.pivot[1] - 43.95 * IN) < 0.002, `${h.id} pivot height ${h.pivot[1]}`);
    assert.match(manual, /approximately 21\.5 in\. \(54\.6 cm\)\s+above the TILES/);
    const flowers = shapes.statics.filter((s) => s.id.startsWith('flower'));
    assert.equal(flowers.length, 4);
    for (const f of flowers) {
      assert.ok(Math.abs(f.topM - (21.5 + 1.25) * IN) < 0.01, `${f.id}: backstop top ${f.topM} m = opening height + 1.25 in backstop`);
      assert.ok(Math.max(Math.abs(f.center[0]), Math.abs(f.center[1])) > shapes.bounds.innerHalfM - 0.08, 'FLOWERS stand at the perimeter wall');
    }
    assert.ok(Math.abs(shapes.bounds.insideM - 144 * IN) < 0.08);
    assert.equal(field.wallHeightM, shapes.bounds.wallTopM);
    const count = (type, re) => shapes.elements.filter((e) => e.type === type && re.test(e.where)).length;
    assert.equal(shapes.elements.filter((e) => e.type === 'pollen').length, 40, 'manual: 40 POLLEN in a match');
    assert.equal(count('pollen', /^flower/), 16); assert.equal(count('pollen', /^garden/), 8); assert.equal(count('pollen', /^outside/), 16);
    assert.equal(count('nectar_red', /hive cell/), 3); assert.equal(count('nectar_blue', /hive cell/), 3);
    assert.equal(count('nectar_red', /outside/) + count('nectar_blue', /outside/), 10);
  });

  test('each HIVE is balanced like the real one: centre of mass above the pivot, leaning toward its lowered CELL', () => {
    for (const h of shapes.hives) {
      assert.ok(h.comM[1] > h.pivot[1], 'top-heavy, so it has two rest positions');
      assert.ok(Math.abs(Math.abs(h.leanRad) - 0.52) < 0.05, `${h.id} leans ${h.leanRad} rad`);
      assert.match(h.mass_source, /estimate/);
    }
    assert.notEqual(Math.sign(shapes.hives[0].leanRad), Math.sign(shapes.hives[1].leanRad), 'red and blue HIVES start tipped opposite ways');
  });

  test('a HIVE holds its position, tips once enough POLLEN lands in the raised CELL, spills, and stays tipped', () => {
    const sim = new Simulator(robot);
    sim.stageElements();
    run(sim, 2);
    assert.ok(sim.snapshot().hives.every((h) => !h.tipped && Math.abs(h.angle) < 0.01), 'stable with 3 NECTAR staged');
    const cell = shapes.elements.filter((e) => e.type === 'nectar_red' && e.where === 'hive cell');
    const cx = cell.reduce((a, e) => a + e.p[0], 0) / cell.length;
    let needed = 0;
    for (let n = 1; n <= 16 && !needed; n++) {
      sim.spawnElement('pollen', { x: cx + ((n % 3) - 1) * 0.09, y: cell[0].p[1] + 0.25, z: cell[0].p[2] - 0.05, home: false });
      run(sim, 1.2);
      if (sim.snapshot().hives.find((h) => h.id === 'hive_red').tipped) needed = n;
    }
    assert.ok(needed >= 3 && needed <= 14, `tipped after ${needed} POLLEN on top of the 3 staged NECTAR`);
    run(sim, 2);
    const s = sim.snapshot(), red = s.hives.find((h) => h.id === 'hive_red');
    assert.ok(Math.abs(red.angle - shapes.hives.find((h) => h.id === 'hive_red').swingRad) < 0.02, 'rests on the opposite stop');
    assert.ok(Math.abs(s.hives.find((h) => h.id === 'hive_blue').angle) < 0.01, 'the other HIVE is unaffected');
    assert.equal(s.elements.filter((e) => e.p[0] > 0 && e.p[1] > 0.6).length, 0, 'the tipped CELL spilled its contents');
    sim.resetElements(); run(sim, 0.5);
    assert.ok(Math.abs(sim.snapshot().hives.find((h) => h.id === 'hive_red').angle) < 0.01, 'reset restores the staged position');
  });

  test('a FLOWER feeds POLLEN down: take the bottom one and the stack drops', () => {
    const sim = new Simulator(robot);
    sim.stageElements(); run(sim, 1);
    const f = shapes.statics.find((s) => s.id === 'flower_2');
    const stack = () => [...sim.elements.values()].filter((e) => Math.hypot(e.body.translation().x - f.center[0], e.body.translation().z - f.center[1]) < 0.03).sort((a, b) => a.body.translation().y - b.body.translation().y);
    const before = stack();
    assert.equal(before.length, 4);
    sim.removeElement(before[0].id);
    run(sim, 1.5);
    const after = stack();
    assert.equal(after.length, 3);
    assert.ok(Math.abs(after[0].body.translation().y - 0.0355) < 0.004, 'the next POLLEN is now at the retrieval opening');
  });

  test('the HIVE frame is a solid obstacle; the robot fits underneath between its feet', () => {
    const under = run(new Simulator(robot), 1).snapshot();
    assert.ok(Math.hypot(under.pose.x, under.pose.y) < 0.002 && Math.abs(under.tilt.pitchDeg) < 1, 'rests undisturbed at field centre');
    const sim = new Simulator(robot);
    sim.resetPose({ x: 0, y: 0, heading: Math.PI / 2 }); // facing the red-side frame foot
    sim.setMotorCommand('left_drive', { power: 0.5 }); sim.setMotorCommand('right_drive', { power: -0.5 });
    run(sim, 2.5);
    const front = sim.assembly.measured.overallM.maxZ; // the CAD foot bar spans x = 0.578 to 0.628 m
    assert.ok(sim.pose.y > 0.2 && sim.pose.y + front > 0.57 && sim.pose.y + front < 0.63, `stopped at the foot bar (robot at ${sim.pose.y}, front at ${sim.pose.y + front})`);
    assert.ok(sim.snapshot().tilt.upY > 0.99);
  });
});

describe('the StarterBot on the official field', { skip }, () => {
  test('pulls POLLEN out of a FLOWER with a corner intake wheel and collects it', () => {
    const sim = new Simulator(robot), f = shapes.statics.find((s) => s.id === 'flower_1'); // on the audience wall
    // The pickup is sensitive to how the corner wheel meets the stack: only some approaches work (in the simulator; untested on a real robot).
    sim.resetPose({ x: f.center[1] + 0.75, y: f.center[0] + 0.175, heading: Math.PI }); // left corner wheel lined up with the FLOWER
    for (const e of shapes.elements.filter((x) => x.where === 'flower_1')) sim.spawnElement(e.type, { x: e.p[0], y: e.p[1], z: e.p[2] });
    run(sim, 0.5);
    sim.setMotorCommand('intake', { power: 1 }); sim.setCRServo('left_intake_servo', 1); sim.setCRServo('right_intake_servo', -1);
    sim.setMotorCommand('left_drive', { power: 0.4 }); sim.setMotorCommand('right_drive', { power: -0.4 });
    run(sim, 6.5);
    const left = [...sim.elements.values()].filter((e) => Math.hypot(e.body.translation().x - f.center[0], e.body.translation().z - f.center[1]) < 0.04).length;
    assert.ok(sim.carried().length >= 3, `collected ${sim.carried().length} POLLEN from the FLOWER`);
    assert.ok(left <= 1, `${left} left in the FLOWER`);
  });
  test('with the intake and corner wheels off, the same approach takes nothing', () => {
    const sim = new Simulator(robot), f = shapes.statics.find((s) => s.id === 'flower_1');
    sim.resetPose({ x: f.center[1] + 0.75, y: f.center[0] + 0.16, heading: Math.PI });
    for (const e of shapes.elements.filter((x) => x.where === 'flower_1')) sim.spawnElement(e.type, { x: e.p[0], y: e.p[1], z: e.p[2] });
    sim.setMotorCommand('left_drive', { power: 0.25 }); sim.setMotorCommand('right_drive', { power: -0.25 });
    run(sim, 6.5);
    assert.equal(sim.carried().length, 0);
  });
  const shot = (pose, tps = 1250) => {
    const sim = new Simulator(robot);
    sim.resetPose(pose);
    const id = sim.spawnInHopper('pollen');
    run(sim, 0.4);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: tps, pidf: [40, 0, 0, 12.5] });
    run(sim, 1.5);
    sim.setCRServo('windmill', -1);
    let apex = 0;
    run(sim, 4, () => { apex = Math.max(apex, sim.elements.get(id).body.translation().y); });
    const p = sim.elements.get(id).body.translation(), out = { apex, x: p.x, y: p.y, z: p.z, inRedCell: p.y > 1.0 && p.x > 0.05 && p.x < 0.6 && p.z < 0 };
    sim.dispose();
    return out;
  };
  test('launched POLLEN lands in the red HIVE from a band near the audience wall, and not from mid-field', () => {
    // Single shots near the CELL lip are sensitive to millimetres, so this checks rates over a grid, not one shot.
    const cell = shapes.hives.find((h) => h.id === 'hive_red').cells.find((c) => c.center[2] < 0);
    const wall = shapes.bounds.innerHalfM - new Simulator(robot).assembly.measured.overallM.maxZ;
    const grid = (dists, offsets) => dists.flatMap((d) => offsets.map((o) => shot({ x: -d, y: cell.center[0] + o, heading: Math.PI })));
    const near = grid([wall - 0.04, wall - 0.08, wall - 0.12], [-0.06, -0.03, 0, 0.03, 0.06]);
    const scored = near.filter((r) => r.inRedCell).length;
    assert.ok(scored >= 5, `${scored} of ${near.length} shots from 4 to 12 cm off the wall landed in the CELL`);
    assert.ok(near.every((r) => r.apex > 1.2 && r.apex < 2.1), 'every shot rises to HIVE height');
    const mid = grid([0.8], [-0.03, 0, 0.03]);
    assert.equal(mid.filter((r) => r.inRedCell).length, 0, 'from 0.8 m the ball is still rising when it reaches the HIVE');
  });
});
