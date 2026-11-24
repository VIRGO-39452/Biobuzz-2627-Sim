import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../server/session.mjs';
import { analyzeJava } from '../server/analyzer.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const EXAMPLE = join(ROOT, 'research', 'code', '3200-2627-0003_example-code', 'Java');
const TEAM = join(ROOT, 'test', 'fixtures', 'team-project');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await sleep(10); } };

describe('project management', () => {
  test('projects are saved, listed, switched, removed, and reopened after a restart', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'ftcsim-proj-'));
    let s = new Session({ workDir, robot });
    try {
      assert.deepEqual(s.listProjects(), []);
      s.loadDir(EXAMPLE, 'goBILDA example');
      const first = s.projectId;
      s.loadDir(TEAM, 'Team project');
      const second = s.projectId;
      assert.notEqual(first, second);
      assert.deepEqual(s.listProjects().map((p) => [p.name, p.current]).sort(), [['Team project', true], ['goBILDA example', false]]);
      assert.equal(s.project.java.length, 8);
      s.openProject(first);
      assert.equal(s.project.name, 'goBILDA example');
      assert.equal(s.project.java.length, 2);
      assert.equal(s.compileResult, null, 'switching projects clears the previous build');
      s.saveSettings({ keyBindings: { 1: { a: 'KeyJ' } } });
      await s.dispose();
      s = new Session({ workDir, robot }); // "restart"
      assert.equal(s.projectId, first, 'the last project is reopened');
      assert.equal(s.project.opmodes.length, 2);
      assert.deepEqual(s.getSettings().keyBindings, { 1: { a: 'KeyJ' } });
      s.removeProject(second);
      assert.deepEqual(s.listProjects().map((p) => p.name), ['goBILDA example']);
      s.removeProject();
      assert.equal(s.project, null);
      assert.deepEqual(s.listProjects(), []);
      assert.throws(() => s.openProject('../../etc'), /No saved project/);
    } finally { await s.dispose(); }
  });

  test('edits stay with their own project', async () => {
    const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-proj-')), robot });
    try {
      s.loadDir(EXAMPLE, 'A'); const a = s.projectId;
      s.loadDir(EXAMPLE, 'B');
      s.saveFile('StarterBotAuto.java', s.readFile('StarterBotAuto.java').replace('Auto Complete!', 'Edited in B'));
      s.openProject(a);
      assert.ok(s.readFile('StarterBotAuto.java').includes('Auto Complete!'));
    } finally { await s.dispose(); }
  });
});

describe('manual hardware mapping', () => {
  test('an unresolved hardware name can be assigned to a robot device; the code then drives the real mechanism', async () => {
    const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-map-')), robot, startPose: { x: 0, y: 0, heading: 0 } });
    try {
      s.loadDir(TEAM, 'Team project');
      // the team calls its motors something the robot model does not know
      const path = 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/subsystems/Drive.java';
      s.saveFile(path, s.readFile(path).replace('"left_drive"', '"leftMotor"').replace('"right_drive"', '"rightMotor"'));
      const hw = () => Object.fromEntries(s.project.hardware.map((h) => [h.name, h]));
      assert.match(hw().leftMotor.status, /unresolved/);
      assert.throws(() => s.setHardwareAlias('leftMotor', 'no_such_device'), /no device/);
      s.setHardwareAlias('leftMotor', 'left_drive');
      s.setHardwareAlias('rightMotor', 'right_drive');
      assert.equal(hw().leftMotor.status, 'connected');
      assert.match(hw().leftMotor.component, /mapped to left_drive/);
      assert.equal((await s.compile()).ok, true);
      await s.init('org.firstinspires.ftc.teamcode.opmodes.DriveTest');
      s.start();
      s.setGamepad(1, { ly: -0.5 });
      await sleep(900);
      const snap = s.sim.snapshot();
      assert.ok(snap.pose.x > 0.2, `the robot drives (x=${snap.pose.x})`);
      assert.equal(snap.devices.leftMotor.resolved, true);
      assert.equal(snap.devices.leftMotor.device, 'left_drive');
      assert.ok(s.hardwareBindings().every((b) => b.resolved));
      await s.stop();
      s.setHardwareAlias('leftMotor', null);
      assert.match(hw().leftMotor.status, /unresolved/, 'the mapping can be cleared');
    } finally { await s.dispose(); }
  });

  test('gamepad 2 reaches the OpMode separately from gamepad 1', async () => {
    const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-gp2-')), robot, startPose: { x: 0, y: 0, heading: 0 } });
    try {
      s.loadDir(TEAM, 'Team project');
      const path = 'TeamCode/src/main/java/org/firstinspires/ftc/teamcode/opmodes/DriveTest.java';
      s.saveFile(path, s.readFile(path).replace('telemetry.addData("A pressed", gamepad1.a);', 'telemetry.addData("A pressed", gamepad1.a);\n            telemetry.addData("Pad2", "%.1f %b", gamepad2.right_trigger, gamepad2.y);'));
      assert.equal((await s.compile()).ok, true);
      let lines = []; s.on('telemetry', (l) => { lines = l; });
      await s.init('org.firstinspires.ftc.teamcode.opmodes.DriveTest');
      s.start();
      s.setGamepad(2, { rt: 0.5, buttons: { y: true } });
      await waitFor(() => lines.includes('Pad2 : 0.5 true') && lines.includes('A pressed : false'));
      s.setGamepad(1, { buttons: { a: true } }); s.setGamepad(2, {});
      await waitFor(() => lines.includes('Pad2 : 0.0 false') && lines.includes('A pressed : true'));
      await s.stop();
    } finally { await s.dispose(); }
  });
});

describe('source analysis for the explorer', () => {
  test('methods and class dependencies are found; analysis stays fast on comment-heavy files', async () => {
    const src = readFileSync(join(EXAMPLE, 'StarterBotAuto.java'), 'utf8');
    const t0 = performance.now();
    const info = analyzeJava('StarterBotAuto.java', src);
    assert.ok(performance.now() - t0 < 200, 'no pathological regex');
    assert.deepEqual(info.methods.map((m) => m.name), ['init', 'init_loop', 'start', 'loop', 'stop', 'launch', 'drive', 'rotate']);
    assert.equal(src.split('\n')[info.methods.find((m) => m.name === 'drive').line - 1].includes('boolean drive('), true);
    const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-an-')), robot });
    try {
      s.loadDir(TEAM, 'Team project');
      const uses = (name) => s.project.java.find((j) => j.path.endsWith(name)).uses.map((u) => u.type).sort();
      assert.deepEqual(uses('DriveTest.java'), ['Robot']);
      assert.deepEqual(uses('Robot.java'), ['Drive']);
      assert.deepEqual(uses('Drive.java'), []);
    } finally { await s.dispose(); }
  });
});
