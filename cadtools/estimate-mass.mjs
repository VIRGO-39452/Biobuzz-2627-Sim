// Estimates robot mass, centre of mass and inertia from CAD part volumes and assumed material densities.
// This is an ESTIMATE: the STEP file has geometry but no mass data. Weigh the real robot to replace it.
// Usage: node estimate-mass.mjs part-volumes.json robot.json
import { readFileSync, writeFileSync } from 'node:fs';
import { RULES } from './materials.mjs';

const [volPath, robotPath] = process.argv.slice(2);
const { parts } = JSON.parse(readFileSync(volPath, 'utf8'));
const robot = JSON.parse(readFileSync(robotPath, 'utf8'));

let M = 0; const com = [0, 0, 0]; const items = []; const byClass = {}; const unmatched = [];
for (const p of parts) {
  const name = p.product ?? p.instance ?? '?';
  const rule = RULES.find((r) => r.match.test(name));
  if (!rule) { unmatched.push(name); continue; }
  const m = rule.massKg ?? rule.density * p.volumeM3;
  items.push({ m, c: p.centroid, size: p.boxMax.map((v, i) => v - p.boxMin[i]) });
  M += m; for (let i = 0; i < 3; i++) com[i] += m * p.centroid[i];
  byClass[rule.cls] = (byClass[rule.cls] ?? 0) + m;
}
if (unmatched.length) throw new Error('no density rule for: ' + [...new Set(unmatched)].join(', '));
for (let i = 0; i < 3; i++) com[i] /= M;
const I = [0, 0, 0];
for (const { m, c, size } of items) {
  const d = c.map((v, i) => v - com[i]);
  I[0] += m * (d[1] ** 2 + d[2] ** 2) + (m / 12) * (size[1] ** 2 + size[2] ** 2);
  I[1] += m * (d[0] ** 2 + d[2] ** 2) + (m / 12) * (size[0] ** 2 + size[2] ** 2);
  I[2] += m * (d[0] ** 2 + d[1] ** 2) + (m / 12) * (size[0] ** 2 + size[1] ** 2);
}
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 1e4) / 1e4;
robot.chassis.massProperties = {
  massKg: r3(M), comM: com.map(r4), inertiaKgM2: I.map(r4),
  frame: '+X left, +Y up, +Z front; origin at the centre of the middle axle',
  source: 'estimate: official CAD part volumes x assumed material densities, with approximate fixed masses for motors, battery and servos',
  missing: 'REV Control Hub (about 0.2 kg) and wiring are not in the CAD and are not included',
  breakdownKg: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r3(v)])),
};
robot.chassis.massKg = r3(M); robot.chassis.massKg_source = 'estimate from CAD volumes (see massProperties)';
robot.chassis.yawInertiaKgM2 = r4(I[1]); robot.chassis.yawInertia_source = 'estimate from CAD volumes (see massProperties)';
writeFileSync(robotPath, JSON.stringify(robot, null, 2) + '\n');
console.log(JSON.stringify(robot.chassis.massProperties, null, 1));
