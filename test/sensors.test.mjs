import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../server/session.mjs';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const PROJECT = join(ROOT, 'test', 'fixtures', 'sensor-project');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000, what = 'condition') => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(10); } };
const session = (cfg = robot, pose = { x: 0, y: 0, heading: 0 }) => { const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-sens-')), robot: cfg, startPose: pose }); s.lines = []; s.logs = []; s.on('telemetry', (l) => { s.lines = l; }); s.on('log', (e) => s.logs.push(e)); return s; };
// the StarterBot has no extra sensors; this variant mounts a distance sensor on the front and a colour sensor over the hopper
const withSensors = { ...robot, devices: { ...robot.devices,
  front_distance: { kind: 'distance', mount: { position: [0, 0.05, 0.26], direction: [0, 0, 1] }, maxM: 2, label: 'front distance sensor (test)' },
  hopper_color: { kind: 'color', mount: { position: [-0.01, 0.06, 0.02] }, rangeM: 0.06, label: 'hopper colour sensor (test)' } } };

describe('IMU', () => {
  test('simulator IMU: yaw is counter-clockwise positive, relative to the last reset, and survives between OpModes', () => {
    const sim = new Simulator({ ...robot, field: { sizeM: 1000 } });
    sim.ensureDevice('imu', 'imu');
    const yaw = () => sim.sensorReadings().find(([n]) => n === 'imu')[1][0];
    assert.ok(Math.abs(yaw()) < 1e-3);
    sim.setMotorCommand('left_drive', { power: -0.3 }); sim.setMotorCommand('right_drive', { power: -0.3 }); // right motor is mirrored: this spins left
    for (let i = 0; i < 600; i++) sim.step(0.001);
    const turned = yaw(), rate = sim.sensorReadings()[0][1][5];
    assert.ok(turned > 0.3, `turning left gives positive yaw (${turned} rad)`);
    assert.ok(Math.abs(turned - sim.pose.heading) < 1e-9 && rate > 0.5, 'yaw and yaw rate follow the chassis');
    sim.resetImuYaw('imu');
    assert.ok(Math.abs(yaw()) < 1e-9);
    sim.clearDevices(); sim.ensureDevice('imu', 'imu'); // next OpMode
    assert.ok(Math.abs(yaw()) < 1e-9, 'the zero set by resetYaw() persists, like a powered hub');
    sim.resetPose();
    sim.ensureDevice('imu', 'imu');
    assert.ok(Math.abs(yaw()) < 1e-3);
    sim.dispose();
  });

  test('real Java: an autonomous turns 90 degrees on IMU yaw, with bulk caching and the hub voltage sensor', { timeout: 60000 }, async () => {
    const s = session();
    try {
      s.loadDir(PROJECT, 'Sensor project');
      const hw = Object.fromEntries(s.project.hardware.map((h) => [h.name, h]));
      assert.equal(hw.imu.kind, 'imu'); assert.equal(hw.imu.status, 'connected');
      const r = await s.compile();
      assert.equal(r.ok, true, r.raw);
      await s.init('org.firstinspires.ftc.teamcode.ImuTurn');
      await waitFor(() => s.lines.some((l) => /^Battery : 12\.\d$/.test(l)), 4000, 'battery telemetry');
      assert.ok(s.hardwareBindings().find((b) => b.name === 'imu').resolved);
      s.start();
      await waitFor(() => s.lines.some((l) => /^Yaw : \d/.test(l)), 4000, 'yaw telemetry while turning');
      await waitFor(() => s.opmode.state === 'stopped', 20000, 'the OpMode to finish');
      const heading = (s.sim.pose.heading * 180) / Math.PI;
      assert.ok(heading > 84 && heading < 110, `robot turned to ${heading.toFixed(1)} degrees`);
      const final = Number(/Final yaw : (-?[\d.]+)/.exec(s.lines.join('\n'))[1]);
      assert.ok(Math.abs(final - heading) < 2, `the code's final yaw (${final}) matches the simulated heading`);
      assert.ok(Math.hypot(s.sim.pose.x, s.sim.pose.y) < 0.15, 'turned roughly in place');
    } finally { await s.dispose(); }
  });
});

describe('other sensors', () => {
  test('sensors the robot model lacks are flagged and can be set by hand; they never read made-up values silently', { timeout: 60000 }, async () => {
    const s = session();
    try {
      s.loadDir(PROJECT, 'Sensor project');
      const hw = Object.fromEntries(s.project.hardware.map((h) => [h.name, h]));
      for (const [name, kind] of [['front_distance', 'distance'], ['bumper', 'touch'], ['hopper_color', 'color'], ['beam', 'digital'], ['pot', 'analog']]) {
        assert.equal(hw[name].kind, kind); assert.match(hw[name].status, /unresolved: this sensor is not on the robot model/);
      }
      assert.equal((await s.compile()).ok, true);
      await s.init('org.firstinspires.ftc.teamcode.SensorDrive');
      await waitFor(() => s.logs.filter((l) => l.stream === 'warning' && /Sensor "/.test(l.text)).length === 5, 4000, 'five sensor warnings');
      s.start();
      await waitFor(() => s.lines.includes('Front : out of range') && s.lines.includes('Bumper : false') && s.lines.includes('Hopper : nothing') && s.lines.includes('Beam : true') && s.lines.includes('Pot : 0.00'), 4000, 'default readings');
      await sleep(400);
      assert.ok(s.sim.vel.v > 0.2, 'nothing ahead as far as the code can tell: it drives');
      s.setSensor('bumper', [1]); s.setSensor('beam', [0]); s.setSensor('pot', [1.65]); s.setSensor('hopper_color', [0.84, 0.15, 0.24, 1, 0.01]);
      await waitFor(() => s.lines.includes('Bumper : true') && s.lines.includes('Beam : false') && s.lines.includes('Pot : 1.65') && s.lines.includes('Hopper : red NECTAR'), 4000, 'hand-set readings');
      await waitFor(() => Math.abs(s.sim.vel.v) < 0.02, 4000, 'the pressed bumper stops the robot');
      s.setSensor('bumper', [0]); s.setSensor('front_distance', [0.2]);
      await waitFor(() => s.lines.includes('Front : 20 cm'), 4000, 'hand-set distance');
      await sleep(300);
      assert.ok(Math.abs(s.sim.vel.v) < 0.02, 'a hand-set 20 cm reading keeps it stopped');
      assert.throws(() => s.setSensor('left_drive', [1]), /not a sensor/);
      await s.stop();
    } finally { await s.dispose(); }
  });

  test('sensors mounted in the robot configuration read the simulated world: distance to the wall, colour of the ball in the hopper', { timeout: 60000 }, async () => {
    const s = session(withSensors);
    try {
      s.loadDir(PROJECT, 'Sensor project');
      assert.equal(s.project.hardware.find((h) => h.name === 'front_distance').status, 'connected');
      assert.equal((await s.compile()).ok, true);
      await s.init('org.firstinspires.ftc.teamcode.SensorDrive');
      s.start();
      await waitFor(() => s.lines.some((l) => /^Front : 1\d\d cm$/.test(l)), 4000, 'a wall distance reading');
      const wall = s.sim.fieldShapes.bounds.innerHalfM, expectCm = (wall - 0.26 - s.sim.pose.x) * 100;
      const cm = Number(/Front : (\d+) cm/.exec(s.lines.join('\n'))[1]);
      assert.ok(Math.abs(cm - expectCm) < 25, `reads ${cm} cm with the wall about ${expectCm.toFixed(0)} cm ahead`);
      await waitFor(() => Math.abs(s.sim.vel.v) < 0.02 && s.sim.pose.x > 0.5, 15000, 'the robot to stop short of the wall');
      const gap = wall - 0.26 - s.sim.pose.x;
      assert.ok(gap > 0.15 && gap < 0.32, `stopped ${Math.round(gap * 100)} cm from the wall`);
      assert.equal(s.sim.atWall, false);
      assert.ok(s.lines.includes('Hopper : nothing'));
      s.sim.spawnInHopper('pollen');
      await waitFor(() => s.lines.includes('Hopper : POLLEN'), 4000, 'the colour sensor to see the POLLEN');
      s.sim.clearElements(); s.sim.spawnInHopper('nectar_blue');
      await waitFor(() => s.lines.includes('Hopper : blue NECTAR'), 4000, 'the colour sensor to see blue NECTAR');
      s.setSensor('front_distance', [1.5]);
      await waitFor(() => s.lines.includes('Front : 150 cm'), 3000, 'hand-set override');
      s.setSensor('front_distance', null);
      await waitFor(() => /Front : [12]\d cm/.test(s.lines.join('\n')), 3000, 'return to the simulated reading');
      await s.stop();
    } finally { await s.dispose(); }
  });
});
