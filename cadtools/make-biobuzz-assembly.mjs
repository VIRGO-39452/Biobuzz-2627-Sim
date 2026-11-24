// Derives robots/biobuzz-assembly.json from the converted official CAD.
// Parts are assigned to moving components by goBILDA SKU and measured position; everything else
// stays in the static chassis. The output is plain JSON and is meant to be edited by hand.
//
// Model frame (as exported): +X = robot left, +Y = up, +Z = robot front (intake end), metres.
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { readGlbJson, walk, subtree } from './glb.mjs';
import { partMassKg } from './materials.mjs';
import { inertiaTool } from './inertia.mjs';

const [glbPath, outPath, modelUrl, volumesPath] = process.argv.slice(2);
const g = readGlbJson(glbPath);
const parts = [];
let rootName = null, triangles = 0;
const subParts = new Map(), nameStack = []; // "part/sub/part" -> bounding box centre, for shafts inside motors and servos
walk(g, (i, n, w, parent, depth) => {
  if (depth === 0) rootName = n.name;
  if (depth >= 1) { nameStack.length = depth - 1; nameStack.push(n.name); }
  if (depth > 1 && /^(5203|2000-0025)/.test(nameStack[0]) && /shaft|Shaft|Spline/.test(n.name)) subParts.set(nameStack.join('/'), subtree(g, i, w).box.getCenter(new Vector3()));
  if (depth !== 1) return;
  const s = subtree(g, i, w);
  triangles += s.tris;
  parts.push({ name: n.name, sku: n.name.split(/[ :]/)[0], c: s.box.getCenter(new Vector3()), size: s.box.getSize(new Vector3()), box: s.box });
});
const mm = (v) => Math.round(v * 1e5) / 1e5; // 0.01 mm
const used = new Set();
const take = (pred) => parts.filter((p) => !used.has(p.name) && pred(p)).map((p) => { used.add(p.name); return p.name; });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** Path of the rotating sub-part (gearbox output shaft, rotor shaft or servo spline) inside a motor or servo; it must lie on the given axle. */
const inner = (owner, pattern, pivot, axis) => {
  const hit = [...subParts].find(([path]) => path.startsWith(owner + '/') && pattern.test(path.split('/').pop()));
  if (!hit) throw new Error(`no ${pattern} inside ${owner}`);
  const off = ['x', 'y', 'z'].map((k, i) => (axis[i] ? 0 : hit[1][k] - pivot[i]));
  if (Math.hypot(...off) > 0.0015) throw new Error(`${hit[0]} is ${(Math.hypot(...off) * 1000).toFixed(2)} mm off the axle it should turn on`);
  return hit[0];
};
const one = (name) => { const p = parts.find((q) => q.name === name); if (!p) throw new Error(`CAD part not found: ${name}`); return p; };

// ---- measured reference geometry
const hogbacks = parts.filter((p) => p.sku === '3626-0014-0096');
const omnis = parts.filter((p) => p.sku === '3624-0014-0096');
const driveWheels = [...hogbacks.filter((p) => Math.abs(p.c.x) > 0.15), ...omnis];
if (driveWheels.length !== 6) throw new Error(`expected 6 drive wheels in CAD, found ${driveWheels.length}`);
const wheelRadius = Math.min(hogbacks[0].size.y, hogbacks[0].size.z) / 2;
const axleZ = [...new Set(driveWheels.map((w) => mm(w.c.z)))].sort((a, b) => a - b);
const overall = parts.reduce((b, p) => b.union(p.box), parts[0].box.clone());
const structure = parts.filter((p) => /^(11|12|16)/.test(p.sku)).reduce((b, p) => b.union(p.box), parts.find((p) => /^11/.test(p.sku)).box.clone());

const components = [];
const AXLE_SKUS = new Set(['3626-0014-0096', '3624-0014-0096', '1310-0016-4008', '1309-0016-4008', '2106-4008-0800', '3307-4008-0010', '2303-4008-0030']);
const POS = { [axleZ[0]]: 'rear', [axleZ[1]]: 'middle', [axleZ[2]]: 'front' };

for (const [side, sx, hw] of [['left', 1, 'left_drive'], ['right', -1, 'right_drive']]) {
  // In the official code, positive raw power on left_drive and negative raw power on right_drive roll the robot forward.
  const ratio = side === 'left' ? 1 : -1;
  for (const z of axleZ) {
    const wheel = driveWheels.find((w) => Math.sign(w.c.x) === sx && near(w.c.z, z, 0.002));
    const y = wheel.sku.startsWith('3624') ? wheel.c.y : 0; // Hogback centres sit on the axle line y = 0
    const nodes = take((p) => AXLE_SKUS.has(p.sku) && Math.sign(p.c.x) === sx && Math.abs(p.c.x) > 0.13 && near(p.c.z, z, 0.003) && near(p.c.y, y, 0.004));
    components.push({
      id: `${side}_${POS[z]}_wheel`, label: `${side[0].toUpperCase()}${side.slice(1)} ${POS[z]} wheel (${wheel.sku.startsWith('3624') ? '96 mm omni' : '96 mm Hogback'}) with axle, hub, sprocket/gear`,
      nodes, movable: true, parent: 'chassis',
      joint: { type: 'revolute', pivot: [mm(wheel.c.x), mm(y), mm(z)], axis: [1, 0, 0] },
      drive: POS[z] === 'front'
        ? { hardware: null, shaft: `${side}_${POS[z]}_axle`, ratio: 1, of: 'own shaft angle', note: 'No sprocket or chain reaches the front axle in the CAD: the omni wheels roll freely.' }
        : { hardware: hw, shaft: `${side}_${POS[z]}_axle`, ratio: 1, of: 'own shaft angle' },
      collision: { shape: 'cylinder', radius: mm(wheelRadius), width: mm(wheel.size.x), axis: [1, 0, 0], center: [mm(wheel.c.x), mm(y), mm(z)], kind: wheel.sku.startsWith('3624') ? 'omni' : 'traction' },
      wheel: { side, position: POS[z], type: wheel.sku.startsWith('3624') ? 'omni' : 'traction' },
    });
  }
  const motor = parts.find((p) => p.sku === '5203-2402-0019' && Math.sign(p.c.x) === sx && Math.abs(p.c.y) < 0.01);
  const gear = take((p) => p.sku === '2303-4008-0030' && Math.sign(p.c.x) === sx && near(p.c.z, motor.c.z, 0.003));
  const g0 = one(gear[0]);
  const pp = [mm(g0.c.x), mm(g0.c.y), mm(g0.c.z)];
  components.push({ id: `${side}_drive_motor_gear`, label: `${side} drive motor output shaft and pinion (30T, meshes 1:1 with the rear axle gear)`, nodes: [...gear, inner(motor.name, /Gearbox Shaft/, pp, [1, 0, 0])], movable: true, parent: 'chassis',
    joint: { type: 'revolute', pivot: pp, axis: [1, 0, 0] }, drive: { hardware: hw, shaft: `${side}_drive_pinion`, ratio: 1, of: 'own shaft angle' }, collision: null });
  components.push({ id: `${side}_drive_rotor`, label: `${side} drive motor rotor (turns 19.2 times per output turn; only its shaft is in the CAD)`, nodes: [inner(motor.name, /motor shaft/, pp, [1, 0, 0])], movable: true, parent: 'chassis',
    joint: { type: 'revolute', pivot: pp, axis: [1, 0, 0] }, drive: { hardware: hw, shaft: `${side}_drive_rotor`, ratio: 1, of: 'own shaft angle' }, collision: null });
  used.add(motor.name);
  components.push({ id: `${side}_drive_motor`, label: `${side} drive motor (5203 Yellow Jacket 19.2:1)`, nodes: [motor.name], movable: false, parent: 'chassis', hardware: hw, collision: null });
}

// ---- launcher: fifth Hogback wheel on the 1:1 motor
const fly = hogbacks.find((p) => Math.abs(p.c.x) < 0.15);
const launchMotor = parts.find((p) => p.sku === '5203-2402-0019' && p.c.y > 0.05);
used.add(launchMotor.name);
const flyPivot = [mm(fly.c.x), mm(one('1310-0016-4008:5').c.y), mm(fly.c.z)];
components.push({ id: 'launcher_flywheel', label: 'Launcher flywheel (96 mm Hogback wheel on Hyper Hub) with the motor shaft it is clamped to', movable: true, parent: 'chassis',
  nodes: [...take((p) => (p.sku === '3626-0014-0096' || p.sku === '1310-0016-4008') && near(p.c.y, fly.c.y, 0.004) && near(p.c.z, fly.c.z, 0.004)), inner(launchMotor.name, /Gearbox Shaft/, flyPivot, [1, 0, 0]), inner(launchMotor.name, /motor shaft/, flyPivot, [1, 0, 0])],
  joint: { type: 'revolute', pivot: flyPivot, axis: [1, 0, 0] },
  drive: { hardware: 'launcher', shaft: 'launcher_shaft', ratio: 1, of: 'own shaft angle', note: 'Direction derived from geometry: positive velocity moves the underside of the wheel rearward, carrying POLLEN up the curved ramp behind it and out over the back of the robot.' },
  collision: { shape: 'cylinder', radius: mm(wheelRadius), width: mm(fly.size.x), axis: [1, 0, 0], center: [mm(fly.c.x), mm(fly.c.y), mm(fly.c.z)], kind: 'flywheel' } });
components.push({ id: 'launcher_motor', label: 'Launcher motor (5203 Yellow Jacket, converted to 1:1 per assembly step 44; the CAD shows the stock gearbox)', nodes: [launchMotor.name], movable: false, parent: 'chassis', hardware: 'launcher', collision: null });

// ---- intake: 50.9:1 motor -> 100T gear -> 20T gear on the Gecko wheel shaft (5:1 speed-up)
const intakeMotor = one('5203-2402-0051:1'); used.add(intakeMotor.name);
const bigGear = one('2302-0014-0100:1'), smallGear = one('2303-4008-0020:1');
components.push({ id: 'intake_motor', label: 'Intake motor (5203 Yellow Jacket 50.9:1)', nodes: [intakeMotor.name], movable: false, parent: 'chassis', hardware: 'intake', collision: null });
const bigPivot = [mm(bigGear.c.x), mm(bigGear.c.y), mm(bigGear.c.z)];
components.push({ id: 'intake_drive_gear', label: 'Intake motor output shaft with the 100T gear', movable: true, parent: 'chassis',
  nodes: [...take((p) => (p.sku === '2302-0014-0100' || p.sku === '1309-0016-4008') && near(p.c.y, bigGear.c.y, 0.004) && near(p.c.z, bigGear.c.z, 0.004)), inner(intakeMotor.name, /Gearbox Shaft/, bigPivot, [1, 0, 0])],
  joint: { type: 'revolute', pivot: bigPivot, axis: [1, 0, 0] }, drive: { hardware: 'intake', shaft: 'intake_gear', ratio: 1, of: 'own shaft angle' }, collision: null });
components.push({ id: 'intake_rotor', label: 'Intake motor rotor (turns 50.9 times per output turn; only its shaft is in the CAD)', movable: true, parent: 'chassis', nodes: [inner(intakeMotor.name, /motor shaft/, bigPivot, [1, 0, 0])],
  joint: { type: 'revolute', pivot: bigPivot, axis: [1, 0, 0] }, drive: { hardware: 'intake', shaft: 'intake_rotor', ratio: 1, of: 'own shaft angle' }, collision: null });
const geckos = parts.filter((p) => p.sku === '3613-4008-0048');
components.push({ id: 'intake_gecko_shaft', label: `Intake shaft: ${geckos.length} x 48 mm GripForce Gecko wheels, driven 100T:20T`, movable: true, parent: 'chassis',
  nodes: take((p) => ['3613-4008-0048', '1522-0010-0120', '2106-4008-2400', '2303-4008-0020', '2920-0001-4008'].includes(p.sku) && near(p.c.y, smallGear.c.y, 0.004) && near(p.c.z, smallGear.c.z, 0.004)),
  joint: { type: 'revolute', pivot: [0, mm(smallGear.c.y), mm(smallGear.c.z)], axis: [1, 0, 0] },
  drive: { hardware: 'intake', shaft: 'intake_gecko_shaft', ratio: 1, of: 'own shaft angle', note: 'Positive intake power moves the underside of the wheels toward the robot.' },
  collision: { shape: 'cylinder', radius: 0.024, width: mm(Math.max(...geckos.map((p) => p.c.x)) - Math.min(...geckos.map((p) => p.c.x)) + 0.016), axis: [1, 0, 0], center: [mm((Math.max(...geckos.map((p) => p.c.x)) + Math.min(...geckos.map((p) => p.c.x))) / 2), mm(smallGear.c.y), mm(smallGear.c.z)], kind: 'intake-roller' } });
const sleeves = parts.filter((p) => p.sku === '3618-4008-0016');
components.push({ id: 'lower_roller', label: `Lower roller: ${sleeves.length} intake roller sleeves on the 264 mm shaft`, movable: false, parent: 'chassis',
  nodes: take((p) => p.sku === '3618-4008-0016' || p.sku === '2106-4008-2640'),
  note: 'No gear, chain, motor or bearing connects to this shaft in the CAD, so it is treated as a fixed, grippy bar.', collision: { shape: 'cylinder', radius: 0.0085, width: 0.264, axis: [1, 0, 0], center: [0, mm(sleeves[0].c.y), mm(sleeves[0].c.z)], kind: 'passive-roller' } });

// ---- corner intake servos (72 mm Gecko wheels, vertical axis)
for (const [side, sx, hw] of [['left', 1, 'left_intake_servo'], ['right', -1, 'right_intake_servo']]) {
  const w = parts.find((p) => p.sku === '3613-0014-0072' && Math.sign(p.c.x) === sx);
  const servo = parts.find((p) => p.sku === '2000-0025-0003' && Math.sign(p.c.x) === sx);
  used.add(servo.name);
  const wp = [mm(w.c.x), mm(w.c.y), mm(w.c.z)];
  components.push({ id: `${side}_intake_servo_wheel`, label: `${side} corner intake wheel (72 mm GripForce Gecko) on the speed servo's output spline`, nodes: [...take((p) => p.name === w.name), inner(servo.name, /Spline/, wp, [0, 1, 0])], movable: true, parent: 'chassis',
    joint: { type: 'revolute', pivot: wp, axis: [0, 1, 0] },
    drive: { hardware: hw, shaft: `${side}_intake_servo_wheel`, ratio: 1, of: 'own shaft angle', note: 'With the official code, intake power turns the inner edge of each wheel toward the robot.' },
    collision: { shape: 'cylinder', radius: 0.036, width: mm(w.size.y), axis: [0, 1, 0], center: [mm(w.c.x), mm(w.c.y), mm(w.c.z)], kind: 'intake-roller' } });
  components.push({ id: `${side}_intake_servo`, label: `${side} intake servo (2000-0025-0003 speed)`, nodes: [servo.name], movable: false, parent: 'chassis', hardware: hw, collision: null });
}

// ---- windmill: four gridplate blades around a vertical servo axis
const blades = parts.filter((p) => p.name.startsWith('1117-0040-0352 (3200-2627-0003_A)'));
const axis = blades.reduce((s, p) => s.add(p.c), new Vector3()).multiplyScalar(1 / blades.length);
const windServo = one('2000-0025-0002:1'); used.add(windServo.name);
components.push({ id: 'windmill', label: `Windmill feeder: ${blades.length} gridplate blades on the torque servo`, movable: true, parent: 'chassis',
  nodes: [...take((p) => blades.includes(p) || (p.sku === '1201-0043-0002' && Math.hypot(p.c.x - axis.x, p.c.z - axis.z) < 0.03 && p.c.y < windServo.c.y)), inner(windServo.name, /Spline/, [axis.x, axis.y, axis.z], [0, 1, 0])],
  joint: { type: 'revolute', pivot: [mm(axis.x), mm(axis.y), mm(axis.z)], axis: [0, 1, 0] },
  drive: { hardware: 'windmill', shaft: 'windmill', ratio: 1, of: 'own shaft angle', note: 'Direction derived from geometry: the official code feeds with the servo reversed at full power, and feeding must sweep POLLEN rearward onto the launcher ramp at the robot centreline.' },
  collision: { shape: 'paddles', count: blades.length, radius: mm(Math.max(...blades.map((b) => Math.hypot(b.box.max.x - axis.x, b.box.max.z - axis.z), 0))), height: mm(blades[0].size.y), center: [mm(axis.x), mm(axis.y), mm(axis.z)], kind: 'feeder' } });
components.push({ id: 'windmill_servo', label: 'Windmill servo (2000-0025-0002 torque)', nodes: [windServo.name], movable: false, parent: 'chassis', hardware: 'windmill', collision: null });

// ---- floating intake arm: assembly steps 34-36 hang the whole intake on two stub shafts in bearings,
// so it swings up about that axis when a ball passes underneath.
const pivotShafts = parts.filter((p) => p.sku === '2106-4008-0800' && p.c.y > 0.03);
const armPivot = [0, mm(one('1120-0001-0048:1').c.y), mm(one('1120-0001-0048:1').c.z)];
const armStructure = take((p) => ['1120-0008-0216:1', '1121-0001-0048:1', '1121-0001-0048:2', '1143-0003-0096:1', '1143-0003-0096:2', '1201-0043-0002:1',
  '1205-0001-0005:5', '1205-0001-0005:6', '1309-0016-4008:3', '1309-0016-4008:4', '2920-0001-4008:1', '2920-0001-4008:2', '1611-0514-4008:17', '1611-0514-4008:18', '1516-4008-0430:2'].includes(p.name) || pivotShafts.includes(p));
for (const id of ['intake_gecko_shaft', 'intake_drive_gear', 'intake_motor', 'intake_rotor']) components.find((c) => c.id === id).parent = 'intake_arm';
components.push({ id: 'intake_arm', label: 'Floating intake arm (8-hole U-channel, end plates, pivot shafts); carries the Gecko shaft, 100T gear and intake motor', nodes: armStructure, movable: true, parent: 'chassis',
  joint: { type: 'revolute', pivot: armPivot, axis: [1, 0, 0] }, drive: { joint: 'intake_arm', ratio: -1, of: 'lift angle (positive lift raises the Gecko shaft)' }, collision: null });
const joints = [];
{
  const armParts = new Set([...armStructure, ...components.filter((c) => c.parent === 'intake_arm').flatMap((c) => c.nodes.filter((n) => !n.includes('/')))]);
  const j = { id: 'intake_arm', type: 'passive revolute', pivot: armPivot, axis: [1, 0, 0], minLiftRad: 0, maxLiftRad: 0.6, dampingNmsPerRad: 0.02,
    limits_source: 'estimate: the CAD pose is taken as the lower stop; the upper stop is not modelled in the CAD', parts: armParts.size };
  if (volumesPath && existsSync(volumesPath)) {
    let M = 0, cy = 0, cz = 0, I = 0; const items = [];
    for (const v of JSON.parse(readFileSync(volumesPath, 'utf8')).parts) {
      if (!armParts.has(v.instance)) continue;
      const pm = partMassKg(v.product ?? v.instance, v.volumeM3); if (!pm) continue;
      M += pm.massKg; cy += pm.massKg * v.centroid[1]; cz += pm.massKg * v.centroid[2]; items.push([pm.massKg, v.centroid]);
    }
    cy /= M; cz /= M;
    for (const [m, c] of items) I += m * ((c[1] - armPivot[1]) ** 2 + (c[2] - armPivot[2]) ** 2);
    Object.assign(j, { massKg: mm(M), comM: [0, mm(cy), mm(cz)], inertiaAboutPivotKgM2: mm(I), mass_source: 'estimate from CAD volumes and assumed densities (cadtools/materials.mjs)' });
  } else Object.assign(j, { massKg: 0.9, comM: [0, 0.085, 0.172], inertiaAboutPivotKgM2: 0.003, mass_source: 'rough estimate (run npm run cad:mass for a CAD-based one)' });
  joints.push(j);
}

// ---- mechanisms: parts that push game elements. Rollers and blades are compliant contacts in the
// physics (soft wheels gripping a ball), posed by the same device angle as the visuals above.
const comp = (id) => components.find((c) => c.id === id);
const SOFT = { note: 'estimate' };
const mechanisms = [];
geckos.slice().sort((a, b) => a.c.x - b.c.x).forEach((w, i) => mechanisms.push({ id: `intake_gecko_${i + 1}`, kind: 'roller', hardware: 'intake', shaft: 'intake_gecko_shaft',
  center: [mm(w.c.x), mm(smallGear.c.y), mm(smallGear.c.z)], axis: [1, 0, 0], radius: 0.024, width: 0.016, stiffnessNPerM: 1500, friction: 1.0, joint: 'intake_arm' }));
mechanisms.push({ id: 'lower_roller', kind: 'roller', hardware: null, shaft: null, center: [0, mm(sleeves[0].c.y), mm(sleeves[0].c.z)], axis: [1, 0, 0], radius: 0.0085, width: 0.256, stiffnessNPerM: 8000, friction: 1.0,
  note: 'This shaft has no bearings in the CAD (all 18 are on the drive axles, intake pivots and Gecko shaft), so it is modelled as a fixed bar. Its silicone sleeves give a spinning ball the grip to climb over it.' });
mechanisms.push({ id: 'launcher_flywheel', kind: 'roller', hardware: 'launcher', shaft: 'launcher_shaft', center: [mm(fly.c.x), mm(one('1310-0016-4008:5').c.y), mm(fly.c.z)], axis: [1, 0, 0],
  radius: mm(wheelRadius), width: mm(fly.size.x), stiffnessNPerM: 6000, friction: 0.9, dampingRatio: 1.0,
  dampingRatio_note: 'The ball is gripped for only about 25 ms. With light damping the squeeze rings and the ball leaves at a different angle each shot; a squashy hollow ball is assumed to settle without ringing (estimate).' });
for (const side of ['left', 'right']) { const c = comp(`${side}_intake_servo_wheel`);
  mechanisms.push({ id: c.id, kind: 'roller', hardware: c.drive.hardware, shaft: c.drive.shaft, center: c.joint.pivot, axis: [0, 1, 0], radius: 0.036, width: c.collision.width, stiffnessNPerM: 500, friction: 1.0 }); }
mechanisms.push({ id: 'windmill', kind: 'blades', hardware: 'windmill', shaft: 'windmill', pivot: comp('windmill').joint.pivot, axis: [0, 1, 0],
  blades: blades.map((b) => ({ center: [mm(b.c.x), mm(b.c.y), mm(b.c.z)], half: [mm(Math.max(b.size.x, 0.003) / 2), mm(b.size.y / 2), mm(Math.max(b.size.z, 0.003) / 2)] })), stiffnessNPerM: 8000, friction: 0.4, dampingRatio: 0.7 });

// ---- drivetrain: every rotating group of parts as a shaft with its own inertia, joined by the meshes the CAD shows
const measure = inertiaTool(glbPath);
const E = (v) => Number(v.toPrecision(4));
const ROTOR = 3e-6, SERVO_REFLECTED = 1.5e-3, BEARING = 0.002;
const shafts = [], couplings = [], actuators = {};
const shaftOf = (id, extra = {}) => {
  const cs = components.filter((c) => c.drive?.shaft === id);
  let I = 0; const detail = [];
  for (const c of cs) { const r = measure(c.nodes, c.joint.pivot, c.joint.axis); I += r.inertiaKgM2; detail.push(...r.detail); }
  const s = { id, inertiaKgM2: E(I + (extra.addKgM2 ?? 0)), inertia_source: `estimate from CAD solids and assumed densities (${detail.join('; ')})${extra.addNote ? `, plus ${extra.addNote}` : ''}`, frictionNm: extra.frictionNm ?? 0, viscousNmPerRadS: extra.viscousNmPerRadS ?? 0 };
  shafts.push(s);
  return s;
};
const GEAR = { type: 'gear', moduleMm: 0.8, stiffnessNPerM: 2e6, dampingNsPerM: 40, backlashM: 0.0001, efficiency: 0.97 };
const BOX = (ratio) => ({ type: 'gearbox', ratio, stiffnessNmPerRad: 400, dampingNmsPerRad: 0.05, backlashRad: 0.012, efficiency: 1 });
for (const side of ['left', 'right']) {
  // encoder sign: positive device angle rolls the left wheels forward and the right wheels backward (official example code)
  const sign = side === 'left' ? -1 : 1, hw = `${side}_drive`;
  shaftOf(`${side}_drive_rotor`, { addKgM2: ROTOR, addNote: `${ROTOR} kg m2 for the motor armature (estimate; the CAD only has its shaft)` });
  shaftOf(`${side}_drive_pinion`);
  shaftOf(`${side}_rear_axle`, { frictionNm: BEARING });
  shaftOf(`${side}_middle_axle`, { frictionNm: BEARING });
  shaftOf(`${side}_front_axle`, { frictionNm: BEARING });
  couplings.push({ id: `${side}_drive_gearbox`, a: `${side}_drive_rotor`, b: `${side}_drive_pinion`, ...BOX(19.2), label: 'Yellow Jacket 19.2:1 planetary gearbox (internal gears are not in the CAD; modelled as one stage)' });
  couplings.push({ id: `${side}_drive_mesh`, a: `${side}_drive_pinion`, b: `${side}_rear_axle`, ...GEAR, teethA: 30, teethB: 30, label: '30T pinion on 30T axle gear' });
  couplings.push({ id: `${side}_drive_chain`, a: `${side}_rear_axle`, b: `${side}_middle_axle`, type: 'chain', pitchMm: 8, teethA: 10, teethB: 10, stiffnessNPerM: 2e5, dampingNsPerM: 20, slackM: 0.0008, efficiency: 0.96, label: '8 mm plastic chain loop on two 10T sprockets' });
  actuators[hw] = { type: 'motor', rotor: `${side}_drive_rotor`, sign, gearbox: 19.2 };
}
shaftOf('launcher_shaft', { addKgM2: 0.00001, addNote: '0.00001 kg m2 for the motor armature at 1:1', viscousNmPerRadS: 0.00002 });
actuators.launcher = { type: 'motor', rotor: 'launcher_shaft', sign: 1, gearbox: 1 };
shaftOf('intake_rotor', { addKgM2: ROTOR, addNote: `${ROTOR} kg m2 for the motor armature (estimate)` });
shaftOf('intake_gear', { frictionNm: BEARING });
shaftOf('intake_gecko_shaft', { frictionNm: 2 * BEARING });
couplings.push({ id: 'intake_gearbox', a: 'intake_rotor', b: 'intake_gear', ...BOX(50.9), label: 'Yellow Jacket 50.9:1 planetary gearbox (modelled as one stage)' });
couplings.push({ id: 'intake_mesh', a: 'intake_gear', b: 'intake_gecko_shaft', ...GEAR, teethA: 100, teethB: 20, label: '100T gear on 20T pinion (the Gecko shaft turns 5 times faster, the other way)' });
actuators.intake = { type: 'motor', rotor: 'intake_rotor', sign: -1, gearbox: 50.9 };
for (const id of ['left_intake_servo_wheel', 'right_intake_servo_wheel', 'windmill']) {
  shaftOf(id, { addKgM2: SERVO_REFLECTED, addNote: `${SERVO_REFLECTED} kg m2 for the servo's own motor and gears seen at its output (estimate)` });
  actuators[comp(id).drive.hardware] = { type: 'servo', shaft: id, sign: -1 };
}
{ // tooth counts must agree with where the CAD puts the shafts
  const dist = (a, b) => Math.hypot(comp(a).joint.pivot[1] - comp(b).joint.pivot[1], comp(a).joint.pivot[2] - comp(b).joint.pivot[2]);
  const check = (what, got, want) => { if (Math.abs(got - want) > 0.0006) throw new Error(`${what}: centre distance ${(got * 1000).toFixed(2)} mm, tooth counts need ${(want * 1000).toFixed(2)} mm`); };
  check('drive pinion / axle gear', dist('left_drive_motor_gear', 'left_rear_wheel'), 0.0008 * (30 + 30) / 2);
  check('intake 100T / 20T', dist('intake_drive_gear', 'intake_gecko_shaft'), 0.0008 * (100 + 20) / 2);
}
const drivetrain = {
  note: 'Each shaft is simulated with its own angle and speed. Tooth counts and positions are from the CAD (centre distances checked against MOD 0.8 teeth). Inertias are integrated from the CAD solids with assumed densities. Mesh stiffness, backlash, chain slack, efficiency and bearing friction are estimates.',
  shafts, couplings, actuators,
};

const battery = one('3100-0012-0020:1');
const chassisNodes = parts.filter((p) => !used.has(p.name)).map((p) => p.name);
const assembly = {
  id: 'gobilda-biobuzz-starterbot-6wd',
  source: { cad: '3200-2627-0003.step (goBILDA resource guide)', converter: 'cadtools/step2glb.py (OpenCascade tessellation)', generatedBy: 'cadtools/make-biobuzz-assembly.mjs' },
  model: { url: modelUrl, root: rootName, parts: parts.length, triangles: Math.round(triangles), units: 'm', frame: { left: '+X', up: '+Y', front: '+Z' } },
  measured: {
    note: 'Read from the official CAD geometry.',
    trackWidthM: mm(Math.abs(hogbacks.find((p) => p.c.x > 0.15).c.x) * 2),
    omniTrackWidthM: mm(Math.abs(omnis[0].c.x) * 2),
    axleZM: axleZ, wheelbaseM: mm(axleZ[2] - axleZ[0]),
    wheelRadiusM: mm(wheelRadius),
    frontAxleRiseM: mm(omnis[0].c.y),
    frontAxleRise_note: 'Rear and middle (Hogback) axles are level; the front omni axle sits this much higher, so the robot rests on four wheels and rocks onto the omnis.',
    groundYM: mm(-wheelRadius),
    frameFootprintM: { width: mm(structure.max.x - structure.min.x), length: mm(structure.max.z - structure.min.z), minZ: mm(structure.min.z), maxZ: mm(structure.max.z) },
    overallM: { width: mm(overall.max.x - overall.min.x), length: mm(overall.max.z - overall.min.z), heightAboveGround: mm(overall.max.y + wheelRadius), minZ: mm(overall.min.z), maxZ: mm(overall.max.z) },
    batteryCenterM: [mm(battery.c.x), mm(battery.c.y), mm(battery.c.z)],
  },
  appearance: {
    note: 'The STEP file carries colours only. These render-only rules add surface finish; they never change geometry.',
    byColor: [
      { when: 'light', metalness: 0.8, roughness: 0.42, meaning: 'bare aluminium and steel' },
      { when: 'dark', metalness: 0.0, roughness: 0.85, meaning: 'rubber, anodized and plastic parts' },
      { when: 'colored', metalness: 0.1, roughness: 0.6, meaning: 'labels, motor cans, wiring' },
    ],
    byPart: [{ match: '^1117-', opacity: 0.38, metalness: 0.0, roughness: 0.15, color: [0.85, 0.9, 0.95], meaning: 'polycarbonate grid plates' }],
  },
  joints,
  drivetrain,
  mechanisms,
  mechanisms_note: 'Radii and positions are from the CAD. Contact stiffness and friction are estimates (soft GripForce wheels and a slightly squashy ball); tune them against the real robot.',
  collisionShapes: '/assets/biobuzz/collision.json',
  notInCad: ['REV Control Hub', 'wiring', 'the 1:1 launcher gearbox conversion (CAD shows a stock 19.2:1 motor)'],
  notAnimated: ['plastic chain loops (drawn static; their pull and slack are simulated)', 'gears inside the motor gearboxes and servos (not in the CAD; each is simulated as one stage)', 'fasteners merged into the "Hardware" part'],
  chassis: { id: 'chassis', label: 'Static chassis (structure, plates, bearings, battery, fasteners)', nodes: chassisNodes,
    collision: { shape: 'box', min: [mm(structure.min.x), mm(structure.min.y), mm(structure.min.z)], max: [mm(structure.max.x), mm(structure.max.y), mm(structure.max.z)] } },
  components,
};
writeFileSync(outPath, JSON.stringify(assembly, null, 2) + '\n');
console.log(`wrote ${outPath}: ${components.length} components (${components.filter((c) => c.movable).length} movable), ${chassisNodes.length} static chassis parts`);
console.log(JSON.stringify(assembly.measured, null, 1));
for (const c of components.filter((c) => c.movable)) console.log(c.id.padEnd(28), String(c.nodes.length).padStart(2), 'parts  pivot', c.joint.pivot.map((v) => (v * 1000).toFixed(1)).join(', '), ' <-', c.drive.shaft ?? c.drive.joint);
for (const s of shafts) console.log(s.id.padEnd(28), 'J', s.inertiaKgM2.toExponential(3), 'kg m2');
