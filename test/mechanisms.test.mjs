import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulator, loadAssembly } from '../server/sim.mjs';
import { Session } from '../server/session.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const assembly = loadAssembly(robot);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (sim, seconds, each) => { for (let i = 0; i < seconds * 1000; i++) { sim.step(0.001); each?.(); } return sim; };
const TPS = (sim) => (sim.devices.get('launcher').omega * 28) / (2 * Math.PI);
const PIDF = [40, 0, 0, 12.5]; // from goBILDA's example code
const hopper = (sim) => sim.spawnInHopper('pollen');
const drive = (sim, p) => { sim.setMotorCommand('left_drive', { power: p }); sim.setMotorCommand('right_drive', { power: -p }); };
const intake = (sim, p) => { sim.setMotorCommand('intake', { power: p }); sim.setCRServo('left_intake_servo', p); sim.setCRServo('right_intake_servo', -p); };

describe('mechanism model comes from the CAD and the assembly manual', () => {
  test('the intake is a passive floating arm carrying the Gecko shaft, gear and motor', () => {
    const arm = assembly.joints.find((j) => j.id === 'intake_arm');
    assert.deepEqual(arm.pivot, [0, 0.048, 0.144]);
    assert.ok(arm.massKg > 0.5 && arm.massKg < 2);
    assert.deepEqual(assembly.components.filter((c) => c.parent === 'intake_arm').map((c) => c.id).sort(), ['intake_drive_gear', 'intake_gecko_shaft', 'intake_motor', 'intake_rotor']);
    assert.equal(assembly.mechanisms.filter((m) => m.joint === 'intake_arm').length, 7, 'seven Gecko wheels ride on the arm');
  });
  test('every powered mechanism is driven by a device from the official code; the lower bar is fixed', () => {
    for (const m of assembly.mechanisms) if (m.hardware) assert.ok(robot.devices[m.hardware], m.id);
    const bar = assembly.mechanisms.find((m) => m.id === 'lower_roller');
    assert.equal(bar.hardware, null); assert.ok(bar.friction > 0.5);
    assert.equal(assembly.mechanisms.find((m) => m.id === 'windmill').blades.length, 4);
  });
});

describe('intake', () => {
  test('driving onto a POLLEN with the intake running collects it: it climbs the bar, the arm floats up, and it lands in the hopper', () => {
    const sim = new Simulator(robot);
    const id = sim.spawnElement('pollen', { x: 0, z: 0.45 });
    intake(sim, 1); drive(sim, 0.25);
    let maxLift = 0, maxSpeed = 0, prev = sim.elements.get(id).body.translation();
    run(sim, 2.5, () => { maxLift = Math.max(maxLift, sim.joints.get('intake_arm').lift); const p = sim.elements.get(id).body.translation(); maxSpeed = Math.max(maxSpeed, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) / 0.001); prev = p; });
    assert.deepEqual(sim.carried(), [id]);
    const p = sim.elements.get(id).body.translation(), rel = p.z - sim.pose.x;
    assert.ok(rel > 0 && rel < 0.12, `resting on the hopper floor behind the bar (z ${rel})`);
    assert.ok(p.y > 0.06 && p.y < 0.1, `on the floor plate, above the tiles (y ${p.y})`);
    assert.ok(maxLift > 0.1, `arm lifted ${maxLift} rad`);
    assert.equal(sim.joints.get('intake_arm').lift, 0, 'arm settles back on its stop');
    assert.ok(maxSpeed < 3, `the ball moves continuously, no teleport (peak ${maxSpeed} m/s)`);
  });
  test('intake stopped or reversed: the same approach does not collect', () => {
    for (const power of [0, -1]) {
      const sim = new Simulator(robot);
      sim.spawnElement('pollen', { x: 0, z: 0.45 });
      intake(sim, power); drive(sim, 0.25);
      run(sim, 2.5);
      assert.deepEqual(sim.carried(), [], `intake power ${power}`);
    }
  });
  test('collecting loads the intake motor', () => {
    const sim = new Simulator(robot);
    sim.spawnElement('pollen', { x: 0, z: 0.45 });
    intake(sim, 1); drive(sim, 0.25);
    run(sim, 0.6);
    const free = sim.snapshot().devices.intake.currentA;
    let peak = 0;
    run(sim, 1.2, () => { peak = Math.max(peak, Math.abs(sim.devices.get('intake').current)); });
    assert.ok(peak > free * 1.3, `current rises from ${free} A to ${peak} A while a ball is in the rollers`);
  });
});

describe('windmill and launcher', () => {
  const shot = (launcherTps, windmill) => {
    const sim = new Simulator(robot);
    const id = hopper(sim);
    run(sim, 0.5);
    sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: launcherTps, pidf: PIDF });
    run(sim, 1.5);
    const before = TPS(sim);
    sim.setCRServo('windmill', windmill);
    let minTps = Infinity, maxY = 0, exit = null, tExit = null;
    run(sim, 2.5, () => { minTps = Math.min(minTps, TPS(sim)); const b = sim.elements.get(id).body, p = b.translation(); maxY = Math.max(maxY, p.y); if (!exit && p.y > 0.3) { exit = b.linvel(); tExit = sim.time; } });
    return { sim, id, before, minTps, maxY, exit, tExit };
  };
  test('a fed POLLEN is thrown by the spinning flywheel: up and out over the back, with a flywheel speed dip that recovers', () => {
    const r = shot(1250, -1);
    assert.ok(Math.abs(r.before - 1250) < 30, `flywheel at speed before feeding (${r.before})`);
    assert.ok(r.exit, 'the ball left the robot');
    const speed = Math.hypot(r.exit.x, r.exit.y, r.exit.z), angle = (Math.atan2(r.exit.y, -r.exit.z) * 180) / Math.PI;
    assert.ok(speed > 3.5 && speed < 9, `exit speed ${speed} m/s`);
    assert.ok(angle > 55 && angle < 89.5, `exit angle ${angle} deg above horizontal, toward the rear`);
    assert.ok(Math.abs(r.exit.x) < 1, 'roughly straight');
    assert.ok(r.maxY > 1.0 && r.maxY < 3, `apex ${r.maxY} m`);
    assert.ok(r.minTps < 1200, `flywheel slowed to ${r.minTps} ticks/s while throwing`);
    assert.ok(Math.abs(TPS(r.sim) - 1250) < 40, 'and recovered under the code\'s PIDF');
    assert.deepEqual(r.sim.carried(), []);
  });
  test('a slower flywheel throws a slower ball', () => {
    const fast = shot(1250, -1), slow = shot(800, -1);
    const v = (r) => Math.hypot(r.exit.x, r.exit.y, r.exit.z);
    assert.ok(slow.exit && v(slow) < v(fast) * 0.85, `${v(slow)} vs ${v(fast)} m/s`);
    assert.ok(slow.maxY < fast.maxY);
  });
  test('flywheel stopped: the windmill feeds the ball to it but nothing is launched', () => {
    const r = shot(0, -1);
    assert.equal(r.exit, null);
    assert.ok(r.maxY < 0.3);
    assert.deepEqual(r.sim.carried(), [r.id]);
  });
  test('windmill stopped: the ball stays in the hopper while the flywheel spins', () => {
    const r = shot(1250, 0);
    assert.equal(r.exit, null);
    assert.deepEqual(r.sim.carried(), [r.id]);
    assert.ok(r.minTps > 1200, 'no load on the flywheel');
  });
  test('same inputs give the same shot', () => {
    const a = shot(1250, -1), b = shot(1250, -1);
    assert.deepEqual(a.exit, b.exit);
    assert.equal(a.tExit, b.tExit);
  });
});

describe('goBILDA\'s real TeleOp, unmodified, collects and launches POLLEN', () => {
  let s;
  before(async () => {
    // 23 cm of clear floor ahead: collecting needs the robot to drive onto the balls (from a standstill against the wall they stall at the intake bar)
    s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-mech-')), robot, startPose: { x: -1.3, y: 0.32, heading: Math.PI } });
    s.loadDir(join(ROOT, 'research', 'code', '3200-2627-0003_example-code', 'Java'));
    assert.equal((await s.compile()).ok, true);
  });
  after(() => s.dispose());
  test('drive into four staged pre-loads with the triggers, then hold the bumper', { timeout: 60000 }, async () => {
    s.elements({ action: 'stage' });
    for (const id of [...s.sim.elements.keys()].slice(0, 8)) s.sim.removeElement(id); // keep the four pre-loads
    await s.init('org.firstinspires.ftc.teamcode.BioBuzzStarterbotTeleop');
    s.start();
    await sleep(200);
    s.setGamepad(1, { ly: -0.3, rt: 1 }); // forward at 30 %, right trigger = intake
    await sleep(1300);
    s.setGamepad(1, { rt: 1 });
    await sleep(1200);
    const collected = s.sim.carried().length;
    assert.ok(collected >= 2, `collected ${collected} of 4 POLLEN`); // run in real time against the JVM, so the count varies from 2 to 4 between runs
    s.setGamepad(1, { buttons: { right_bumper: true } });
    const launched = new Set(); let sawFeedGate = false;
    const until = Date.now() + 20000;
    while (Date.now() < until && launched.size < collected) {
      for (const e of s.sim.elements.values()) if (e.body.translation().y > 0.6) launched.add(e.id);
      const d = s.sim.snapshot().devices;
      if (d.launcher.velocityTps < 1200 && d.windmill.commandedPower === 0 && launched.size > 0) sawFeedGate = true;
      await sleep(5);
    }
    assert.ok(launched.size >= Math.max(1, collected - 1), `launched ${launched.size} of ${collected} collected POLLEN`);
    assert.ok(sawFeedGate, 'the Java code paused the windmill while the flywheel recovered');
    assert.ok(Math.abs(s.sim.snapshot().tilt.pitchDeg) < 3, 'robot stays upright');
    await s.stop();
  });
});
