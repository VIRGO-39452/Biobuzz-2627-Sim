import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulator, loadField } from '../server/sim.mjs';
import { Session } from '../server/session.mjs';
import { ROOT } from '../server/jdk.mjs';

const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const field = loadField();
const manual = readFileSync(join(ROOT, 'research', 'manual', 'manual.txt'), 'utf8');
const run = (sim, seconds) => { for (let i = 0; i < seconds * 1000; i++) sim.step(0.001); return sim; };
const el = (sim, id) => sim.snapshot().elements.find((e) => e.id === id);
const R = field.elements.pollen.diameterM / 2, half = robot.field.sizeM / 2;

describe('field configuration matches the official competition manual', () => {
  test('element sizes and counts are the manual\'s numbers', () => {
    assert.match(manual, /POLLEN are approximately 2\.8 in\. \(7\.1 cm\)/);
    assert.match(manual, /NECTAR are approximately 3\.6 in\. \(9\.1 cm\)/);
    assert.match(manual, /There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR/);
    assert.equal(field.elements.pollen.diameterM, 0.071);
    assert.equal(field.elements.nectar_red.diameterM, 0.091);
    assert.equal(field.elements.nectar_blue.diameterM, 0.091);
    assert.equal(field.elements.pollen.matchCount, 40);
    assert.match(manual, /144 in\. by 144 in\. \(365\.75 cm by 365\.75 cm\)/);
    assert.ok(Math.abs(field.sizeM - 3.6575) < 0.08, 'CAD inside dimension is within the manual\'s stated tolerance of the nominal 144 in');
    assert.equal(robot.field.sizeM, field.sizeM);
  });
  test('HIVE and FLOWERS come from the official field CAD; estimates are labelled', () => {
    assert.ok(field.structures.every((s) => s.simulated && /official field CAD/.test(s.source)));
    assert.match(field.elements.pollen.mass_source, /inferred/);
    assert.match(field.hive.note, /estimate/);
    assert.match(field.robotStart.note, /not a rule/);
  });
});

describe('game element physics', () => {
  test('official staging from the field CAD: FLOWER stacks, GARDENS, NECTAR in the raised CELLS, pre-loads at the robot', () => {
    const sim = new Simulator(robot);
    assert.equal(sim.stageElements('match'), 34);
    run(sim, 1.5);
    const e = sim.snapshot().elements, pollen = e.filter((x) => x.type === 'pollen');
    assert.equal(pollen.length, 28);
    for (const f of sim.fieldShapes.statics.filter((s) => s.id.startsWith('flower'))) {
      const stack = pollen.filter((x) => Math.hypot(x.p[0] - f.center[0], x.p[2] - f.center[1]) < 0.03).sort((a, b) => a.p[1] - b.p[1]);
      assert.equal(stack.length, 4, `${f.id} holds a stack of four`);
      assert.ok(Math.abs(stack[0].p[1] - R) < 0.004 && stack[3].p[1] > 0.22 && stack[3].p[1] < 0.27, `${f.id} stack heights ${stack.map((x) => x.p[1].toFixed(3))}`);
    }
    const zr = field.zones.find((z) => z.id === 'garden_red'), zb = field.zones.find((z) => z.id === 'garden_blue');
    const inZone = (x, z) => x.p[0] + R > z.min[0] && x.p[0] - R < z.max[0] && x.p[2] + R > z.min[1] && x.p[2] - R < z.max[1];
    assert.equal(pollen.filter((x) => inZone(x, zr) && x.p[1] < 0.05).length, 4, 'red GARDEN');
    assert.equal(pollen.filter((x) => inZone(x, zb) && x.p[1] < 0.05).length, 4, 'blue GARDEN');
    for (const color of ['red', 'blue']) {
      const n = e.filter((x) => x.type === `nectar_${color}`);
      assert.equal(n.length, 3);
      assert.ok(n.every((x) => x.p[1] > 1.2 && x.p[1] < 1.35), `${color} NECTAR rests in the raised CELL (${n.map((x) => x.p[1].toFixed(2))})`);
    }
    const front = sim.assembly.measured.overallM.maxZ;
    assert.equal(pollen.filter((x) => Math.abs(x.p[2] - (front + R)) < 0.01 && Math.abs(x.p[0]) < 0.2).length, 4, 'pre-loads sit against the front of the robot');
    assert.ok(Math.hypot(sim.pose.x, sim.pose.y) < 0.002, 'staging does not shove the robot');
    assert.ok(sim.snapshot().hives.every((h) => !h.tipped), 'HIVES hold their staged position');
  });
  test('a dropped POLLEN falls, bounces lower each time and comes to rest on the tiles', () => {
    const sim = new Simulator(robot);
    const id = sim.spawnElement('pollen', { x: 1, z: 1, y: 0.5 });
    let prevY = 0.5, peaks = [], rising = false;
    for (let i = 0; i < 4000; i++) { sim.step(0.001); const y = sim.elements.get(id).body.translation().y; if (rising && y < prevY) peaks.push(prevY); rising = y > prevY; prevY = y; }
    assert.ok(peaks.length >= 2 && peaks[0] < 0.5 && peaks[1] < peaks[0], `bounce heights ${peaks.slice(0, 3)}`);
    assert.ok(Math.abs(el(sim, id).p[1] - R) < 0.002);
  });
  test('a rolling POLLEN slows down and stops (it does not roll forever)', () => {
    const sim = new Simulator(robot);
    const id = sim.spawnElement('pollen', { x: 1, z: -1 });
    sim.elements.get(id).body.setLinvel({ x: -1.5, y: 0, z: 0 }, true);
    run(sim, 0.3);
    assert.ok(el(sim, id).p[0] < 0.75, 'it rolls');
    run(sim, 8);
    const v = sim.elements.get(id).body.linvel();
    assert.ok(Math.hypot(v.x, v.z) < 0.02 && Math.abs(el(sim, id).p[0]) < half);
  });
  test('walls contain a POLLEN fired at 12 m/s (no tunnelling)', () => {
    const sim = new Simulator(robot);
    const id = sim.spawnElement('pollen', { x: 1, z: 0 });
    sim.elements.get(id).body.setLinvel({ x: 12, y: 0, z: 3 }, true);
    for (let i = 0; i < 3000; i++) { sim.step(0.001); const p = sim.elements.get(id).body.translation(); assert.ok(Math.abs(p.x) <= half && Math.abs(p.z) <= half, `escaped at step ${i}`); }
  });
  test('elements collide with each other', () => {
    const sim = new Simulator(robot);
    const a = sim.spawnElement('pollen', { x: 1, z: 1 }), b = sim.spawnElement('nectar_red', { x: 1.5, z: 1 });
    sim.elements.get(a).body.setLinvel({ x: 2, y: 0, z: 0 }, true);
    run(sim, 1.5);
    assert.ok(el(sim, b).p[0] > 1.52, 'the NECTAR was knocked forward');
    assert.ok(el(sim, b).p[0] - el(sim, a).p[0] >= R + field.elements.nectar_red.diameterM / 2 - 0.002, 'no overlap');
  });
  test('with the intake off, a POLLEN ahead is pushed along by the robot but not collected; one beside it is untouched', () => {
    const sim = new Simulator(robot);
    const ahead = sim.spawnElement('pollen', { x: 0, z: 0.6 }), beside = sim.spawnElement('pollen', { x: 0.4, z: 0.3 });
    sim.setMotorCommand('left_drive', { power: 0.4 }); sim.setMotorCommand('right_drive', { power: -0.4 });
    run(sim, 1.5);
    const s = sim.snapshot(), front = s.pose.x + sim.assembly.measured.overallM.maxZ;
    assert.ok(s.pose.x > 0.6);
    assert.ok(el(sim, ahead).p[2] > s.pose.x + 0.12 && el(sim, ahead).p[2] < front + R, 'pushed ball rides at the front of the robot');
    assert.deepEqual(s.carried, [], 'nothing is collected without the intake running');
    assert.ok(Math.abs(el(sim, beside).p[0] - 0.4) < 1e-3 && Math.abs(el(sim, beside).p[2] - 0.3) < 1e-3);
    const total = s.wheels.reduce((a, w) => a + w.loadN, 0);
    assert.ok(Math.abs(total - robot.chassis.massProperties.massKg * 9.81) < 3, 'robot still rides on the tiles, not on a ball');
  });
  test('spawn, remove, clear and reset', () => {
    const sim = new Simulator(robot);
    const a = sim.spawnElement('pollen', { x: 1, z: 1 });
    sim.spawnElement('nectar_blue', { x: -1, z: 1 });
    assert.throws(() => sim.spawnElement('cube', { x: 0, z: 0 }), /Unknown game element type/);
    sim.elements.get(a).body.setLinvel({ x: -1, y: 0, z: 0 }, true);
    run(sim, 1);
    assert.ok(el(sim, a).p[0] < 0.9);
    sim.resetElements();
    assert.deepEqual(el(sim, a).p.map((v) => +v.toFixed(4)), [1, R, 1].map((v) => +v.toFixed(4)));
    assert.equal(sim.removeElement(a), true);
    assert.equal(sim.removeElement(a), false);
    assert.equal(sim.snapshot().elements.length, 1);
    sim.clearElements();
    assert.equal(sim.snapshot().elements.length, 0);
    assert.equal(sim.spawnElement('pollen', { x: 99, z: -99 }) && el(sim, 'pollen-3').p[0] < half, true, 'placement is clamped inside the field');
  });
  test('same inputs give identical element motion', () => {
    const go = () => { const sim = new Simulator(robot); sim.stageElements(); sim.setMotorCommand('left_drive', { power: 0.6 }); sim.setMotorCommand('right_drive', { power: -0.4 }); return run(sim, 2).snapshot(); };
    assert.deepEqual(go(), go());
  });
});

test('element commands through the session (as sent by the dashboard)', async () => {
  const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-el-')), robot });
  try {
    s.elements({ action: 'stage' });
    s.elements({ action: 'spawn', elementType: 'nectar_red', x: 0.5, z: -0.5 });
    assert.equal(s.sim.snapshot().elements.length, 35);
    s.elements({ action: 'remove', id: s.sim.snapshot().elements[0].id });
    assert.equal(s.sim.snapshot().elements.length, 34);
    assert.throws(() => s.elements({ action: 'explode' }), /Unknown element action/);
    await s.reset();
    assert.equal(s.sim.snapshot().elements.length, 34, 'RESET keeps the layout and puts elements back');
    s.elements({ action: 'clear' });
    assert.equal(s.sim.snapshot().elements.length, 0);
  } finally { await s.dispose(); }
});
