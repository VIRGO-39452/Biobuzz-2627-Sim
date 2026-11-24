// Gear trains: every rotating part is its own simulated shaft, coupled through meshes with play.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator, loadAssembly } from '../server/sim.mjs';
import { ShaftNetwork } from '../server/shafts.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const assembly = loadAssembly(robot), dt = assembly.drivetrain;
const run = (sim, s, each) => { for (let i = 0; i < s * 1000; i++) { sim.step(0.001); each?.(i); } };
const om = (sim, id) => sim.net.omega[sim.net.index.get(id)], an = (sim, id) => sim.net.angle[sim.net.index.get(id)];

describe('shaft network solver', () => {
  const pair = (lash) => new ShaftNetwork([{ id: 'a', inertiaKgM2: 1e-4 }, { id: 'b', inertiaKgM2: 4e-4 }], [{ id: 'm', a: 'a', b: 'b', ga: 0.01, gb: 0.02, stiffness: 2e6, damping: 40, lash }]);
  test('a tight mesh holds the gear ratio and conserves momentum about the mesh', () => {
    const n = pair(0);
    for (let i = 0; i < 2000; i++) { n.addTorque(0, 0.01); n.step(0.001); }
    assert.ok(Math.abs(n.omega[0] / n.omega[1] + 2) < 1e-3, `ratio ${n.omega[0] / n.omega[1]}`);
    // equivalent inertia at shaft a: Ja + Jb * (ga/gb)^2 = 2e-4, so 0.01 N m for 2 s gives 100 rad/s
    assert.ok(Math.abs(n.omega[0] - 100) < 0.5, `speed ${n.omega[0]}`);
  });
  test('with backlash the driven gear waits until the play is taken up, and stays stable at any stiffness', () => {
    const n = pair(0.0005);
    n.addTorque(0, 0.01); n.step(0.001);
    assert.ok(n.omega[0] > 0 && n.omega[1] === 0, 'driver moves first');
    let max = 0;
    for (let i = 0; i < 3000; i++) { n.addTorque(0, i < 1500 ? 0.01 : -0.01); n.step(0.001); max = Math.max(max, Math.abs(n.omega[0])); }
    assert.ok(Number.isFinite(n.omega[0]) && max < 200, 'no blow-up through a reversal');
    assert.ok(Math.abs(0.01 * n.angle[0] + 0.02 * n.angle[1]) <= 0.0005 + 1e-5, 'never beyond the play');
  });
});

describe('the StarterBot gear trains', () => {
  test('tooth counts, ratios and inertias come from the CAD', () => {
    const c = (id) => dt.couplings.find((x) => x.id === id), s = (id) => dt.shafts.find((x) => x.id === id);
    assert.deepEqual([c('left_drive_mesh').teethA, c('left_drive_mesh').teethB], [30, 30]);
    assert.deepEqual([c('intake_mesh').teethA, c('intake_mesh').teethB], [100, 20]);
    assert.deepEqual([c('left_drive_chain').teethA, c('left_drive_chain').teethB], [10, 10]);
    assert.equal(c('left_drive_gearbox').ratio, 19.2); assert.equal(c('intake_gearbox').ratio, 50.9);
    assert.ok(!dt.couplings.some((x) => x.a.includes('front') || x.b.includes('front')), 'nothing drives the front omni wheels');
    for (const x of dt.shafts) assert.ok(x.inertiaKgM2 > 1e-7 && x.inertiaKgM2 < 0.01, `${x.id}: ${x.inertiaKgM2}`);
    assert.ok(Math.abs(s('launcher_shaft').inertiaKgM2 - 0.00015) < 0.00001, 'flywheel inertia unchanged from the calibrated launcher');
    assert.ok(Math.abs(s('left_rear_axle').inertiaKgM2 - s('right_rear_axle').inertiaKgM2) < 1e-6, 'mirror-image sides match');
  });
  test('the wheels lag the motor by the play in the gearbox, mesh and chain, then follow it', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    sim.setMotorCommand('left_drive', { power: 0.3 }); sim.setMotorCommand('right_drive', { power: -0.3 });
    let rotorFirst = false, order = [];
    run(sim, 0.05, () => { if (om(sim, 'left_drive_rotor') !== 0 && om(sim, 'left_middle_axle') === 0) rotorFirst = true;
      for (const id of ['left_drive_pinion', 'left_rear_axle', 'left_middle_axle']) if (!order.includes(id) && Math.abs(om(sim, id)) > 0.5) order.push(id); });
    assert.ok(rotorFirst, 'rotor turns before the middle wheel');
    assert.deepEqual(order, ['left_drive_pinion', 'left_rear_axle', 'left_middle_axle'], 'motion passes down the train');
    run(sim, 1.5);
    assert.ok(Math.abs(om(sim, 'left_rear_axle') + om(sim, 'left_drive_pinion')) < 0.05, 'meshed 30T gears turn opposite ways at the same speed');
    assert.ok(Math.abs(om(sim, 'left_rear_axle') - om(sim, 'left_middle_axle')) < 0.05, 'chained axles turn together');
    assert.ok(Math.abs(om(sim, 'left_drive_rotor') / om(sim, 'left_drive_pinion') - 19.2) < 0.02);
    assert.ok(Math.abs(om(sim, 'left_rear_axle') * robot.chassis.wheelRadiusM - sim.vel.v) < 0.02, 'driven wheels roll without slipping at cruise');
    const d = sim.devices.get('left_drive');
    assert.ok(Math.abs(d.angle * d.k.ticksPerRad / 537.7 - -an(sim, 'left_drive_rotor') / 19.2 / (2 * Math.PI)) < 1e-6, 'the encoder counts rotor turns');
  });
  test('reversing takes up the backlash: the rotor reverses before the wheels do', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    const play = (id) => { const c = sim.net.couplings.find((x) => x.id === id); return c.state; };
    sim.setMotorCommand('left_drive', { power: 0.5 }); sim.setMotorCommand('right_drive', { power: -0.5 });
    run(sim, 1); const driving = [play('left_drive_gearbox'), play('left_drive_mesh'), play('left_drive_chain')];
    assert.ok(driving.every((s) => s !== 0), 'all meshes loaded while accelerating');
    sim.setMotorCommand('left_drive', { power: -0.5 }); sim.setMotorCommand('right_drive', { power: 0.5 });
    run(sim, 0.3); const braking = [play('left_drive_gearbox'), play('left_drive_mesh'), play('left_drive_chain')];
    assert.deepEqual(braking, driving.map((s) => -s), 'every mesh now bears on the other flank');
  });
  test('the front omni wheels are turned only by the floor', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    sim.setMotorCommand('left_drive', { power: 0.6 }); sim.setMotorCommand('right_drive', { power: -0.6 });
    run(sim, 2.5);
    const front = sim.wheels.find((w) => w.id === 'left_front_wheel');
    assert.ok(Math.abs(om(sim, 'left_front_axle') * 0.048 - sim.vel.v) < 0.1 || !front.contact, 'rolls at ground speed when it touches down');
    sim.body.setTranslation({ x: 0, y: 1, z: 0 }, true); sim.body.setLinvel({ x: 0, y: 0, z: 0 }, true); // lift the robot: powered wheels keep turning, the omnis coast down
    run(sim, 0.2);
    assert.ok(Math.abs(om(sim, 'left_rear_axle')) > 15 && Math.abs(om(sim, 'left_middle_axle')) > 15);
    assert.ok(Math.abs(om(sim, 'left_front_axle')) < Math.abs(om(sim, 'left_rear_axle')));
  });
  test('a stalled windmill stops instead of forcing its way through, and loads nothing when free', () => {
    const sim = new Simulator(robot);
    sim.setCRServo('windmill', -1); run(sim, 0.5);
    assert.ok(Math.abs(Math.abs(om(sim, 'windmill')) * 60 / (2 * Math.PI) - robot.devices.windmill.freeRpm) < 1, 'free speed');
    for (let i = 0; i < 300; i++) { sim.net.addTorque(sim.net.index.get('windmill'), -Math.sign(om(sim, 'windmill') || 1) * 5); sim.step(0.001); } // more than its stall torque
    assert.ok(om(sim, 'windmill') * -1 <= 0 || Math.abs(om(sim, 'windmill')) < 20, 'cannot hold speed against an overload');
  });
  test('a continuous-rotation servo can be driven through the Servo class (0.5 stops)', () => {
    const sim = new Simulator(robot);
    const d = sim.ensureDevice('windmill', 'servo');
    assert.ok(d.resolved && !d.mismatch);
    sim.setServo('windmill', 1); run(sim, 0.4); const fwd = om(sim, 'windmill');
    sim.setServo('windmill', 0.5); run(sim, 0.4); const stopped = om(sim, 'windmill');
    sim.setServo('windmill', 0); run(sim, 0.4);
    assert.ok(Math.abs(fwd) > 4 && Math.abs(stopped) < 0.05 && Math.sign(om(sim, 'windmill')) === -Math.sign(fwd));
  });
  test('parts animate when the code uses its own hardware names', () => {
    const sim = new Simulator(robot);
    sim.aliases = { servoIndexer: 'windmill', leftWheel: 'left_drive', yellowJacketShooter: 'launcher' };
    sim.setCRServo('servoIndexer', 1); sim.setMotorCommand('leftWheel', { power: 0.5 }); sim.setMotorCommand('yellowJacketShooter', { power: 1 });
    run(sim, 0.5);
    const s = sim.snapshot();
    for (const id of ['windmill', 'left_rear_axle', 'left_drive_rotor', 'launcher_shaft']) assert.ok(Math.abs(s.shafts[id][1]) > 1, `${id} is turning in the snapshot`);
    assert.equal(s.devices.windmill, undefined, 'devices are listed under the names the code uses');
  });
  test('a ball wedged against several blades does not buzz', () => {
    const sim = new Simulator(robot);
    for (let i = 0; i < 3; i++) { sim.spawnInHopper('pollen'); run(sim, 0.4); }
    sim.setCRServo('windmill', -1);
    let rough = 0, steps = 0; const prev = new Map();
    run(sim, 6, () => { for (const e of sim.elements.values()) { const v = e.body.linvel(), q = prev.get(e.id); if (q) { steps++; if (Math.hypot(v.x - q.x, v.y - q.y, v.z - q.z) > 0.1) rough++; } prev.set(e.id, v); } });
    assert.ok(rough / steps < 0.05, `${(100 * rough / steps).toFixed(1)}% of ball-steps had a jolt (was a continuous 1 kHz buzz)`);
  });
});

describe('launcher diagnostics', () => {
  const feed = (setup) => { const sim = new Simulator(robot); sim.spawnInHopper('pollen'); run(sim, 0.4); setup(sim); run(sim, 1.5); sim.setCRServo('windmill', -1); let fault = null; run(sim, 4, () => { fault ??= sim.launchFault; }); return fault; };
  test('a ball fed to a stopped or reversed flywheel is reported; a normal launch is not', () => {
    assert.equal(feed((s) => s.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 1250, pidf: [40, 0, 0, 12.5] })), null);
    assert.equal(feed(() => {}).kind, 'stopped');
    assert.equal(feed((s) => s.setMotorCommand('launcher', { power: -1 })).kind, 'reversed');
  });
});
