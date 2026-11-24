import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readGlbJson, walk } from '../cadtools/glb.mjs';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const assembly = JSON.parse(readFileSync(join(ROOT, 'robots', robot.assembly), 'utf8'));
const glbPath = join(ROOT, assembly.model.url.replace(/^\//, ''));
const haveGlb = existsSync(glbPath);
const movable = assembly.components.filter((c) => c.movable);
const wheels = assembly.components.filter((c) => c.wheel);

describe('robot assembly configuration (derived from the official CAD)', () => {
  test('SIX drive wheels: three per side, four traction + two omni, no mecanum', () => {
    assert.equal(wheels.length, 6);
    for (const side of ['left', 'right']) {
      const s = wheels.filter((w) => w.wheel.side === side);
      assert.deepEqual(s.map((w) => w.wheel.position).sort(), ['front', 'middle', 'rear']);
      assert.ok(s.filter((w) => w.wheel.position !== 'front').every((w) => w.drive.hardware === `${side}_drive`), 'rear and middle wheels of a side share one motor');
      assert.equal(s.find((w) => w.wheel.position === 'front').drive.hardware, null, 'no sprocket or chain reaches the front omni in the CAD: it rolls freely');
      assert.equal(s.find((w) => w.wheel.position === 'front').wheel.type, 'omni');
      assert.equal(s.filter((w) => w.wheel.type === 'traction').length, 2);
    }
    assert.ok(wheels.every((w) => w.joint.axis.join() === '1,0,0'), 'all axles are parallel (differential drive)');
  });

  test('CAD dimensions agree with goBILDA\'s official example code', () => {
    const auto = readFileSync(join(ROOT, 'research/code/3200-2627-0003_example-code/Java/StarterBotAuto.java'), 'utf8');
    const track = Number(/TRACK_WIDTH_MM = (\d+)/.exec(auto)[1]), dia = Number(/WHEEL_DIAMETER_MM = (\d+)/.exec(auto)[1]);
    assert.equal(assembly.measured.trackWidthM * 1000, track);
    assert.ok(Math.abs(assembly.measured.wheelRadiusM * 2000 - dia) < 0.5);
    assert.equal(assembly.measured.wheelbaseM, 0.288);
    assert.equal(assembly.measured.frontAxleRiseM, 0.002);
    assert.ok(assembly.measured.overallM.width <= 0.4572 && assembly.measured.overallM.length <= 0.4572, 'fits the 18 inch sizing limit');
  });

  test('physics configuration uses the CAD-measured geometry', () => {
    assert.equal(robot.chassis.trackWidthM, assembly.measured.trackWidthM);
    assert.equal(robot.chassis.wheelbaseM, assembly.measured.wheelbaseM);
    assert.equal(robot.chassis.bodyLengthM, assembly.measured.overallM.length);
  });

  test('every device in the official code is bound to CAD components', () => {
    for (const name of Object.keys(robot.devices).filter((n) => ['motor', 'crservo', 'servo'].includes(robot.devices[n].kind))) {
      assert.ok(assembly.components.some((c) => (c.drive?.hardware ?? c.hardware) === name), `no CAD component for ${name}`);
      assert.ok(movable.some((c) => c.drive.hardware === name), `nothing moves for ${name}`);
    }
    assert.ok(movable.every((c) => assembly.drivetrain.shafts.some((s) => s.id === c.drive.shaft) || assembly.joints.some((j) => j.id === c.drive.joint)), 'every moving part turns with a simulated shaft or a passive joint');
    for (const [name, a] of Object.entries(assembly.drivetrain.actuators)) assert.ok(robot.devices[name] && assembly.drivetrain.shafts.some((s) => s.id === (a.rotor ?? a.shaft)), `actuator ${name}`);
  });

  test('no part belongs to two components', () => {
    const all = [...assembly.chassis.nodes, ...assembly.components.flatMap((c) => c.nodes)].filter((n) => !n.includes('/')); // "a/b" names a shaft inside a motor or servo
    assert.equal(new Set(all).size, all.length);
    assert.equal(all.length, assembly.model.parts);
  });
});

describe('converted CAD model', { skip: !haveGlb && 'run "npm run cad" to convert the official STEP file' }, () => {
  test('GLB keeps every top-level part of the STEP assembly, by name', () => {
    const g = readGlbJson(glbPath);
    const names = [];
    const paths = new Set(), stack = [];
    walk(g, (i, n, w, parent, depth) => { if (depth === 1) names.push(n.name); if (depth >= 1) { stack.length = depth - 1; stack.push(n.name); paths.add(stack.join('/')); } });
    assert.equal(names.length, 167, 'same count as NEXT_ASSEMBLY_USAGE children of the STEP root');
    assert.equal(new Set(names).size, names.length, 'part names are unique');
    const every = [...assembly.chassis.nodes, ...assembly.components.flatMap((c) => c.nodes)], configured = new Set(every.filter((n) => !n.includes('/')));
    assert.deepEqual(every.filter((n) => !paths.has(n)), [], 'every configured part exists in the model');
    assert.equal(every.filter((n) => n.includes('/')).length, 11, 'four gearbox shafts, four rotor shafts and three servo splines turn inside their housings');
    assert.deepEqual(names.filter((n) => !configured.has(n)), [], 'every model part is assigned');
    assert.equal(names.filter((n) => /^3626-0014-0096|^3624-0014-0096/.test(n)).length, 7, '6 drive wheels + launcher flywheel');
  });
});

describe('CAD component motion comes from simulator state', () => {
  // the 3D view poses each part from its shaft's angle (snapshot.shafts, wrapped to one turn); here the unwrapped angle is read
  const angleOf = (sim, id) => { const c = movable.find((m) => m.id === id); return (c.drive.joint ? sim.joints.get(c.drive.joint).lift : sim.net.angle[sim.net.index.get(c.drive.shaft)]) * c.drive.ratio; };
  test('wheels roll forward by distance / radius on both sides; motor pinions counter-rotate', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    sim.setMotorCommand('left_drive', { power: 0.4 }); sim.setMotorCommand('right_drive', { power: -0.4 });
    for (let i = 0; i < 2000; i++) sim.step(0.001);
    const s = sim.snapshot(), expected = s.pose.x / robot.chassis.wheelRadiusM;
    assert.ok(s.pose.x > 0.5);
    for (const w of wheels.filter((x) => x.drive.hardware)) assert.ok(Math.abs(angleOf(sim, w.id) - expected) / expected < 0.05, `${w.id}: ${angleOf(sim, w.id)} vs ${expected}`);
    for (const w of wheels.filter((x) => !x.drive.hardware)) assert.ok(angleOf(sim, w.id) >= 0 && angleOf(sim, w.id) < expected * 1.05, `${w.id} only turns when the floor turns it`);
    assert.ok(angleOf(sim, 'left_drive_motor_gear') < 0 && angleOf(sim, 'right_drive_motor_gear') < 0);
    assert.ok(Math.abs(angleOf(sim, 'left_drive_rotor') / angleOf(sim, 'left_drive_motor_gear') - 19.2) < 0.01, 'rotor turns 19.2 times per output turn');
    assert.deepEqual(Object.keys(s.shafts).sort(), assembly.drivetrain.shafts.map((x) => x.id).sort(), 'the snapshot carries every shaft');
  });
  test('turning in place rolls the two sides in opposite directions', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    sim.setMotorCommand('left_drive', { power: 0.5 }); sim.setMotorCommand('right_drive', { power: 0.5 });
    for (let i = 0; i < 1000; i++) sim.step(0.001);
    const s = sim.snapshot();
    assert.ok(angleOf(sim, 'left_middle_wheel') > 1 && angleOf(sim, 'right_middle_wheel') < -1);
    assert.ok(s.vel.omega < -1, 'robot yaws right');
  });
  test('intake gearing: Gecko shaft turns 5x the motor, opposite to the 100T gear', () => {
    const sim = new Simulator(robot);
    sim.setMotorCommand('intake', { power: 1 });
    for (let i = 0; i < 1000; i++) sim.step(0.001);
    assert.ok(angleOf(sim, 'intake_gecko_shaft') > 0);
    const mesh = assembly.drivetrain.couplings.find((c) => c.id === 'intake_mesh'), play = mesh.backlashM / (mesh.moduleMm * mesh.teethB / 2000);
    assert.ok(Math.abs(angleOf(sim, 'intake_gecko_shaft') + 5 * angleOf(sim, 'intake_drive_gear')) <= play, '5:1 within the tooth backlash');
  });
  test('parts stay still when their device is not commanded', () => {
    const sim = new Simulator(robot);
    for (const d of Object.entries(robot.devices)) sim.ensureDevice(d[0], d[1].kind);
    for (let i = 0; i < 500; i++) sim.step(0.001);
    const s = sim.snapshot();
    for (const c of movable) assert.ok(Math.abs(angleOf(sim, c.id)) < (c.id.endsWith('rotor') ? 0.2 : 0.01), `${c.id} moved ${angleOf(sim, c.id)} rad`); // tires settle by a fraction of a degree
  });
});
