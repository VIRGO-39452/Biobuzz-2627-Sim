import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createServer } from 'node:net';
import AdmZip from 'adm-zip';
import WebSocket from 'ws';
import { Session } from '../server/session.mjs';
import { Simulator } from '../server/sim.mjs';
import { startServer } from '../server/server.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const EXAMPLE = join(ROOT, 'research', 'code', '3200-2627-0003_example-code', 'Java');
const TEAM = join(ROOT, 'test', 'fixtures', 'team-project');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
function zipDir(dir, prefix = '') {
  const zip = new AdmZip();
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else zip.addFile(prefix + relative(dir, p).split(sep).join('/'), readFileSync(p));
    }
  })(dir);
  return zip.toBuffer();
}
function newSession() {
  const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-')), robot, startPose: ORIGIN });
  s.telemetry = []; s.logs = [];
  s.on('telemetry', (l) => { s.telemetry = l; });
  s.on('log', (e) => s.logs.push(e));
  return s;
}
const ORIGIN = { x: 0, y: 0, heading: 0 }; // field centre (under the HIVE), with a clear run forward
const TPR = 537.7, MM_PER_REV = 96 * Math.PI;
// 312 RPM is the 12 V no-load figure; a 12.8 V battery raises the ceiling proportionally.
const FREE_SPEED = (312 / 60) * (MM_PER_REV / 1000) * (robot.battery.openCircuitV / 12);

describe('PoC end to end over the local server: official goBILDA example, unmodified', () => {
  let srv, ws, msgs = [], last = {};
  before(async () => {
    srv = await startServer({ port: 0, workDir: mkdtempSync(join(tmpdir(), 'ftcsim-srv-')), startPose: ORIGIN });
    ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    ws.on('message', (d) => { const m = JSON.parse(d); msgs.push(m); last[m.type] = m; });
    await new Promise((r) => ws.on('open', r));
  });
  after(async () => { ws.close(); await srv.close(); });
  const send = (m) => ws.send(JSON.stringify(m));

  test('1. upload a ZIP of a Java FTC project', async () => {
    const zip = zipDir(EXAMPLE, 'FtcProject/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/');
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/upload?name=example.zip`, { method: 'POST', body: zip });
    assert.deepEqual(await r.json(), { ok: true, files: 2 });
    await waitFor(() => last.project?.project, 2000, 'project message');
  });

  test('2. detect the TeleOp and its hardware from source, without hardcoded names', () => {
    const p = last.project.project;
    const tele = p.opmodes.find((o) => o.flavor === 'TeleOp');
    assert.equal(tele.name, 'BioBuzz StarterBot Teleop');
    assert.equal(tele.base, 'OpMode');
    assert.equal(p.opmodes.find((o) => o.flavor === 'Autonomous').name, 'StarterBotAuto');
    assert.deepEqual(p.hardware.map((h) => h.name).sort(),
      ['intake', 'launcher', 'left_drive', 'left_intake_servo', 'right_drive', 'right_intake_servo', 'windmill']);
    assert.ok(p.hardware.every((h) => h.status === 'connected'), 'all official devices map to the robot model');
    assert.deepEqual(p.hardware.find((h) => h.name === 'launcher').types, ['DcMotorEx']);
  });

  test('3. compile it with real javac', async () => {
    send({ type: 'compile' });
    const { result } = await waitFor(() => last.compile, 30000, 'compile result');
    assert.equal(result.ok, true, result.raw);
    assert.equal(result.diagnostics.filter((d) => d.severity === 'error').length, 0);
    const w = result.diagnostics.find((d) => d.category === 'file-name');
    assert.match(w.message, /BioBuzzStarterbotTeleop\.java/, 'goBILDA file/class name mismatch is reported, not hidden');
    assert.deepEqual(result.opmodes.map((o) => o.class).sort(),
      ['org.firstinspires.ftc.teamcode.BioBuzzStarterbotTeleop', 'org.firstinspires.ftc.teamcode.StarterBotAuto']);
    assert.ok(result.opmodes.every((o) => o.supported && !o.disabled));
  });

  test('4+5. INIT executes the real OpMode, which initializes simulated motors', async () => {
    send({ type: 'init', opmode: 'org.firstinspires.ftc.teamcode.BioBuzzStarterbotTeleop' });
    await waitFor(() => last.opmode?.opmode.state === 'init', 8000, 'init state');
    await waitFor(() => last.hardware?.bindings.length === 7, 3000, '7 hardware bindings');
    assert.ok(last.hardware.bindings.every((b) => b.resolved));
    await waitFor(() => last.telemetry?.lines.includes('Status : Initialized'), 3000, 'init telemetry');
    await waitFor(() => last.sim?.snapshot.devices.right_drive?.dir === 'REVERSE', 2000, 'direction from code');
    assert.equal(last.sim.snapshot.devices.launcher.mode, 'RUN_USING_ENCODER');
    assert.ok(Math.abs(last.sim.snapshot.pose.x) < 1e-3, 'robot does not move during INIT');
  });

  test('6+7+8. PLAY: gamepad input reaches the Java code, which drives the drivetrain and reports telemetry', async () => {
    send({ type: 'start' });
    await waitFor(() => last.opmode.opmode.state === 'running', 3000, 'running');
    send({ type: 'gamepad', id: 1, state: { lx: 0, ly: -1, rx: 0, ry: 0, lt: 0, rt: 0, buttons: {} } });
    await sleep(60);
    const early = last.sim.snapshot;
    assert.ok(early.vel.v < 1.0, `no instant top speed (v=${early.vel.v})`);
    await sleep(1000);
    const s = last.sim.snapshot;
    assert.ok(s.pose.x > 0.6, `robot drove forward (x=${s.pose.x})`);
    assert.ok(Math.abs(s.pose.y) < 0.06 && Math.abs(s.pose.heading) < 0.06, `nearly straight (y=${s.pose.y}, heading=${s.pose.heading}); the estimated centre of mass is 7 mm off-centre, so a small drift is expected`);
    assert.ok(s.vel.v > 1.0 && s.vel.v < FREE_SPEED, `below the no-load speed at battery voltage (v=${s.vel.v})`);
    const expectTicks = (s.pose.x * 1000 / MM_PER_REV) * TPR;
    assert.ok(Math.abs(s.devices.left_drive.positionTicks - expectTicks) / expectTicks < 0.1, 'encoder matches distance');
    assert.ok(s.devices.right_drive.positionTicks < 0, 'reversed right motor counts negative in raw ticks');
    assert.ok(s.battery.volts < 12.8, 'battery sags under load');
    await waitFor(() => last.telemetry.lines.some((l) => /^Motors : left \(1\.00\), right \(1\.00\)$/.test(l)), 2000, 'drive telemetry');
    send({ type: 'gamepad', id: 1, state: { ly: 0, rx: 1, buttons: {} } });
    await sleep(400);
    assert.ok(last.sim.snapshot.vel.omega < -1, `turns right on right stick (yaw rate=${last.sim.snapshot.vel.omega} rad/s)`);
    await waitFor(() => last.telemetry.lines.some((l) => /left \(1\.00\), right \(-1\.00\)/.test(l)), 2000, 'turn telemetry');
    send({ type: 'gamepad', id: 1, state: { buttons: {} } });
  });

  test('launcher: setVelocity spins up over time under the code\'s PIDF, then the code starts the windmill', async () => {
    send({ type: 'gamepad', id: 1, state: { buttons: { right_bumper: true } } });
    await sleep(50);
    assert.ok(last.sim.snapshot.devices.launcher.velocityTps < 1200, 'flywheel is not instantly at speed');
    assert.equal(last.sim.snapshot.devices.windmill.commandedPower, 0, 'windmill waits for launcher speed');
    await waitFor(() => Math.abs(last.sim.snapshot.devices.launcher.velocityTps - 1250) < 40, 4000, 'launcher at 1250 ticks/s');
    await waitFor(() => last.sim.snapshot.devices.windmill.commandedPower === -1, 2000, 'windmill on (reversed in code)');
    assert.ok(last.sim.snapshot.devices.intake.commandedPower === 0.5, 'code adds intake power while launching');
    send({ type: 'gamepad', id: 1, state: { buttons: {} } });
  });

  test('9. STOP ends the OpMode cleanly and de-energizes the motors', async () => {
    send({ type: 'stop' });
    await waitFor(() => last.opmode.opmode.state === 'stopped', 3000, 'stopped');
    assert.equal(last.opmode.opmode.forced, false);
    assert.equal(srv.session.proc, null);
    await sleep(100);
    assert.equal(last.sim.snapshot.devices.left_drive.appliedDuty, 0);
  });
});

describe('team-style project (LinearOpMode + Robot + subsystem classes)', () => {
  let s;
  before(async () => { s = newSession(); s.loadZip(zipDir(TEAM)); await s.compile(); });
  after(() => s.dispose());
  const cls = (n) => `org.firstinspires.ftc.teamcode.opmodes.${n}`;

  test('whole project is scanned; OpModes, @Disabled and dependencies are discovered', () => {
    assert.equal(s.compileResult.ok, true, s.compileResult.raw);
    assert.equal(s.project.java.length, 8);
    const byName = Object.fromEntries(s.compileResult.opmodes.map((o) => [o.name, o]));
    assert.deepEqual(Object.keys(byName).sort(), ['Auto Forward 300', 'Crasher', 'Drive Test', 'Hidden', 'Infinite Loop', 'Rogue']);
    assert.equal(byName.Hidden.disabled, true);
    assert.equal(byName['Drive Test'].base, 'LinearOpMode');
    assert.equal(byName['Auto Forward 300'].flavor, 'Autonomous');
    const hw = Object.fromEntries(s.project.hardware.map((h) => [h.name, h]));
    assert.equal(hw.right_drive.refs[0].file.endsWith('subsystems/Drive.java'), true, 'hardware found in a non-OpMode file');
    assert.match(hw.mystery_motor.status, /unresolved/);
  });

  test('LinearOpMode teleop: waitForStart, gamepad buttons, encoder + velocity readings', async () => {
    await s.init(cls('DriveTest'));
    await waitFor(() => s.telemetry.includes('Status : Ready v1'), 3000, 'init telemetry');
    s.start();
    s.setGamepad(1, { ly: -0.5, buttons: { a: true } });
    await sleep(1200);
    const snap = s.sim.snapshot();
    assert.ok(snap.vel.v > 0.55 && snap.vel.v < 0.85, `half power gives roughly half speed (v=${snap.vel.v})`);
    const ticks = Number(/Left ticks : (-?\d+)/.exec(s.telemetry.join('\n'))[1]);
    const actual = snap.devices.left_drive.positionTicks;
    assert.ok(ticks > 1000 && ticks <= actual && actual - ticks < 700, `Java sees the simulated encoder (${ticks} vs ${actual}; telemetry is sent every 250 ms)`);
    assert.ok(Number(/Left velocity : (-?[\d.]+)/.exec(s.telemetry.join('\n'))[1]) > 500, 'Java sees simulated velocity');
    assert.ok(s.telemetry.includes('A pressed : true'));
    const r = await s.stop();
    assert.equal(r.state, 'stopped'); assert.equal(r.forced, false);
  });

  test('autonomous RUN_TO_POSITION drives 300 mm and the OpMode ends by itself', async () => {
    s.sim.resetPose();
    await s.init(cls('AutoForward'));
    s.start();
    await waitFor(() => s.opmode.state === 'stopped', 8000, 'auto to finish');
    const x = s.sim.snapshot().pose.x;
    assert.ok(Math.abs(x - 0.3) < 0.03, `stopped at 300 mm (x=${x})`);
    assert.ok(s.logs.some((l) => l.stream === 'stdout' && l.text === 'auto finished'), 'System.out reaches the console');
  });

  test('STOP reliably terminates an OpMode stuck in an infinite loop', async () => {
    await s.init(cls('InfiniteLoop'));
    s.start();
    await sleep(300);
    assert.ok(s.sim.snapshot().devices.left_drive.appliedDuty === 1);
    const r = await s.stop();
    assert.equal(r.forced, true);
    assert.equal(s.opmode.state, 'killed');
    assert.ok(r.ms < 2500, `terminated in ${r.ms} ms`);
    assert.equal(s.proc, null);
    await sleep(50);
    assert.equal(s.sim.snapshot().devices.left_drive.appliedDuty, 0, 'motors off after kill');
  });

  test('runtime exception is reported with a stack trace; unresolved hardware is flagged', async () => {
    await s.init(cls('Crasher'));
    await waitFor(() => s.logs.some((l) => l.stream === 'warning' && /mystery_motor/.test(l.text)), 3000, 'unresolved hardware warning');
    assert.equal(s.hardwareBindings().find((b) => b.name === 'mystery_motor').resolved, false);
    s.start();
    await waitFor(() => s.opmode.state === 'error', 3000, 'error state');
    assert.match(s.opmode.error, /NullPointerException/);
    assert.match(s.opmode.error, /Crasher\.loop\(Crasher\.java:17\)/);
  });

  test('sandbox blocks file writes, network and home-folder reads from uploaded code', { skip: process.platform !== 'darwin' }, async () => {
    const listener = createServer().listen(5999, '127.0.0.1');
    try {
      await s.init(cls('Rogue'));
      s.start();
      await waitFor(() => s.telemetry.length === 3, 5000, 'rogue telemetry');
      assert.deepEqual(s.telemetry, ['write : blocked', 'net : blocked', 'read : blocked']);
      assert.equal(existsSync(join(homedir(), 'ftcsim-rogue-test.txt')), false);
      await s.stop();
    } finally { listener.close(); rmSync(join(homedir(), 'ftcsim-rogue-test.txt'), { force: true }); }
  });

  test('edit a source file, recompile, run again', async () => {
    const path = 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/opmodes/DriveTest.java';
    s.saveFile(path, s.readFile(path).replace('Ready v1', 'Ready v2'));
    assert.equal((await s.compile()).ok, true);
    await s.init(cls('DriveTest'));
    await waitFor(() => s.telemetry.includes('Status : Ready v2'), 3000, 'new telemetry');
    await s.stop();
  });
});

test('compile errors carry file, line, message and category', async () => {
  const s = newSession();
  try {
    s.loadDir(join(ROOT, 'test', 'fixtures', 'broken'));
    const r = await s.compile();
    assert.equal(r.ok, false);
    const errs = r.diagnostics.filter((d) => d.severity === 'error');
    assert.ok(errs.every((e) => e.file === 'Broken.java' && e.line > 0 && e.message));
    assert.equal(errs.find((e) => e.line === 3).category, 'unsupported-android-api');
    assert.equal(errs.find((e) => e.line === 6).category, 'ftc-sdk-class-not-simulated');
    await assert.rejects(() => s.init('org.firstinspires.ftc.teamcode.Broken'), /Compile the project successfully/);
  } finally { await s.dispose(); }
});

describe('rigid-body physics: six-wheel chassis', () => {
  const big = { ...robot, field: { sizeM: 1000 } };
  const m = robot.chassis.massProperties.massKg;
  const cmd = (sim, l, r) => { sim.setMotorCommand('left_drive', { power: l }); sim.setMotorCommand('right_drive', { power: -r }); }; // right motor is mirrored
  const run = (sim, seconds) => { for (let i = 0; i < seconds * 1000; i++) sim.step(0.001); return sim; };
  const drive = (power, seconds, zpb = 'BRAKE', cfg = big) => {
    const sim = new Simulator(cfg);
    sim.setMotorCommand('left_drive', { power, zpb }); sim.setMotorCommand('right_drive', { power: -power, zpb });
    return run(sim, seconds);
  };

  test('robot rests on its tires: weight is carried, level, no sinking or drifting', () => {
    const s = run(new Simulator(robot), 2).snapshot();
    const total = s.wheels.reduce((a, w) => a + w.loadN, 0);
    assert.ok(Math.abs(total - m * 9.81) < 0.5, `wheel loads ${total} N vs weight ${m * 9.81} N`);
    assert.ok(Math.abs(s.pose3d.p[1] - 0.048) < 0.002, `axle height ${s.pose3d.p[1]}`);
    assert.ok(Math.abs(s.tilt.pitchDeg) < 1 && Math.abs(s.tilt.rollDeg) < 0.2);
    assert.ok(Math.hypot(s.pose.x, s.pose.y) < 1e-3 && Math.abs(s.vel.v) < 1e-3);
  });
  test('2 mm front-axle rise: the robot sits on the middle wheels and rocks between rear and front', () => {
    const s = new Simulator(robot).snapshot();
    const load = (pos) => s.wheels.filter((w) => w.id.includes(pos)).reduce((a, w) => a + w.loadN, 0);
    assert.ok(load('middle') > 0.8 * m * 9.81, 'middle axle carries most of the weight');
    assert.ok(load('rear') === 0 || load('front') === 0, 'rear and front axles never both carry load at rest');
    const accel = drive(1, 0.1).snapshot();
    assert.ok(accel.wheels.filter((w) => w.id.includes('rear')).every((w) => w.loadN > 3), 'accelerating forward shifts load onto the rear wheels');
  });
  test('motors accelerate over time toward a speed below the no-load speed', () => {
    assert.ok(drive(1, 0.05).vel.v < 0.6);
    const v = drive(1, 3).vel.v;
    assert.ok(v > 1.3 && v < FREE_SPEED, `v=${v}`);
  });
  test('half power is roughly half speed', () => {
    const ratio = drive(0.5, 3).vel.v / drive(1, 3).vel.v;
    assert.ok(ratio > 0.42 && ratio < 0.55, `ratio=${ratio}`);
  });
  test('launch from rest is traction limited (wheel slip), not instant', () => {
    const sim = drive(1, 0.03);
    const s = sim.snapshot();
    assert.ok(s.devices.left_drive.slipMps > 0.05, `wheels slip under full power (slip ${s.devices.left_drive.slipMps} m/s)`);
    assert.ok(s.vel.accel < robot.chassis.tireFriction * 9.81 * 1.05, `acceleration ${s.vel.accel} within the friction limit`);
  });
  test('BRAKE stops the robot sooner than FLOAT', () => {
    const coast = (zpb) => {
      const sim = drive(1, 2, zpb);
      sim.setMotorCommand('left_drive', { power: 0 }); sim.setMotorCommand('right_drive', { power: 0 });
      const x0 = sim.pose.x;
      run(sim, 3);
      return sim.pose.x - x0;
    };
    const brake = coast('BRAKE'), float = coast('FLOAT');
    assert.ok(brake < float * 0.6, `brake ${brake} m vs float ${float} m`);
  });
  test('differential turning: opposite wheel speeds spin in place, unequal speeds drive an arc', () => {
    const spin = new Simulator(big); cmd(spin, 0.5, -0.5); run(spin, 1);
    assert.ok(spin.vel.omega < -1, `yaw rate ${spin.vel.omega}`);
    assert.ok(Math.hypot(spin.pose.x, spin.pose.y) < 0.05, 'pivots about the middle axle without translating');
    const arc = new Simulator(big); cmd(arc, 1, 0.5); run(arc, 1);
    assert.ok(arc.pose.x > 0.3 && arc.pose.y < -0.1 && arc.pose.heading < -0.3, 'curves toward the slower side');
  });
  test('no sideways motion: traction wheels resist lateral sliding (not a mecanum or holonomic drive)', () => {
    const sim = new Simulator(big);
    sim.body.setLinvel({ x: 0.8, y: 0, z: 0 }, true); // shove the robot sideways
    run(sim, 0.5);
    assert.ok(Math.abs(sim.pose.y) < 0.12, `slid only ${sim.pose.y} m`);
    assert.ok(Math.abs(sim.body.linvel().x) < 0.01);
  });
  test('walls are solid: full speed into the perimeter stops at the wall and stays upright', () => {
    const sim = drive(1, 3, 'BRAKE', robot);
    const s = sim.snapshot(), half = robot.field.sizeM / 2, front = sim.assembly.measured.overallM.maxZ;
    assert.equal(s.atWall, true);
    assert.ok(Math.abs(s.pose.x + front - half) < 0.01, `front bumper at the wall (x=${s.pose.x})`);
    assert.ok(Math.abs(s.tilt.pitchDeg) < 3 && s.pose3d.p[1] < 0.06, 'does not climb or flip');
    cmd(sim, -1, -1); run(sim, 0.8);
    assert.ok(sim.pose.x < s.pose.x - 0.5, 'can back away from the wall');
  });
  test('hitting a wall at an angle keeps the whole robot inside the field', () => {
    const sim = new Simulator(robot); cmd(sim, 1, 0.8); run(sim, 4);
    const half = robot.field.sizeM / 2;
    assert.ok(Math.abs(sim.pose.x) < half && Math.abs(sim.pose.y) < half);
    assert.ok(sim.snapshot().tilt.upY > 0.99, 'still upright');
  });
  test('same inputs give identical results', () => {
    assert.deepEqual(drive(0.7, 2).snapshot(), drive(0.7, 2).snapshot());
  });
});
