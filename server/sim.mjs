// Simulator core: DC motor models, hub-style closed loops, battery sag, a 3D rigid-body chassis (Rapier)
// carried by six individually modelled tire contacts, and every rotating part (motor rotors, gears, axles,
// chains, servo outputs) as its own shaft in a gear-train network (shafts.mjs).
//
// Frames: the chassis body uses the CAD model frame (+X left, +Y up, +Z front, origin at the centre
// of the middle axle). The 2D "pose" reported to OpModes/UI is x = forward (world +Z), y = left
// (world +X), heading = yaw, counter-clockwise seen from above.
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './jdk.mjs';
import { buildNetwork } from './shafts.mjs';

await RAPIER.init();

const G = 9.81;
const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sat = (v) => clamp(v, -1, 1);

// --- small vector helpers (plain {x,y,z})
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return mul(a, 1 / l); };
const rot = (q, v) => { // rotate v by unit quaternion q
  const u = { x: q.x, y: q.y, z: q.z }, t = mul(cross(u, v), 2);
  return add(add(v, mul(t, q.w)), cross(u, t));
};

function motorConstants(model) {
  const freeRad = (model.freeRpm * TWO_PI) / 60;
  return {
    R: 12 / model.stallCurrentA,              // winding resistance seen at 12 V stall
    Kt: model.stallTorqueNm / model.stallCurrentA, // output-shaft torque per amp
    Ke: 12 / freeRad,                         // back-EMF volts per output rad/s
    maxTps: (model.freeRpm / 60) * model.ticksPerRev,
    ticksPerRad: model.ticksPerRev / TWO_PI,
  };
}

function defaultCommand() {
  return { mode: 'RUN_WITHOUT_ENCODER', power: 0, velTicks: null, targetPos: 0, zpb: 'BRAKE', pidf: null, posP: 5 };
}

export function loadField(name = 'biobuzz.json') {
  return JSON.parse(readFileSync(join(ROOT, 'fields', name), 'utf8'));
}

// Collision groups (memberships << 16 | filter). Wheel rays only see the floor.
const GROUP_FLOOR = 0x0001ffff, GROUP_ELEMENT = 0x0002ffff, GROUP_WALL = 0x0004ffff, RAY_FLOOR_ONLY = 0xffff0001;
const GROUP_HULL = 0x00080005;     // outer boxes: touch floor and walls only
const GROUP_HULL_ALL = 0x0008ffff; // fallback when no interior shapes exist: the hull also pushes elements
const GROUP_INTERIOR = 0x00100002; // CAD-derived interior shapes: touch game elements only

const fieldShapeCache = new Map();
/** CAD-derived field structures (HIVE frame, FLOWERS, HIVES, staged element positions), or null if not generated. */
export function loadFieldShapes(field) {
  if (!field.collisionShapes) return null;
  const file = join(ROOT, field.collisionShapes.replace(/^\//, ''));
  if (!fieldShapeCache.has(file)) fieldShapeCache.set(file, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  return fieldShapeCache.get(file);
}

/** CAD-derived interior collision shapes for the robot, or null if they have not been generated. */
export function loadCollisionShapes(assembly) {
  if (!assembly.collisionShapes) return null;
  const file = join(ROOT, assembly.collisionShapes.replace(/^\//, ''));
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
const invRot = (q, v) => rot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
const V = (a) => ({ x: a[0], y: a[1], z: a[2] });
const len = (a) => Math.hypot(a.x, a.y, a.z);

export function loadAssembly(robot) {
  return JSON.parse(readFileSync(join(ROOT, 'robots', robot.assembly), 'utf8'));
}

export class Simulator {
  constructor(robot, assembly = loadAssembly(robot), field = loadField(), shapes = loadCollisionShapes(assembly)) {
    this.shapes = shapes;
    // Field structures are built only on the real field; tests that enlarge the field get open floor.
    this.fieldShapes = robot.field.sizeM === field.sizeM ? loadFieldShapes(field) : null;
    this.hives = [];
    this.robot = robot;
    this.assembly = assembly;
    this.field = field;
    this.elements = new Map();
    this.nextElementId = 1;
    this.devices = new Map();
    this.time = 0;
    this.battery = { volts: robot.battery.openCircuitV, amps: 0 };
    this.#buildWorld();
    this.resetPose();
  }

  #buildWorld() {
    const ch = this.robot.chassis, m = this.assembly.measured, size = this.robot.field.sizeM;
    const world = (this.world = new RAPIER.World({ x: 0, y: -G, z: 0 }));
    // The engine's default tolerances suit metre-sized objects (it lets bodies overlap by up to 5 mm).
    // A ball in this robot's launch chute has a fraction of a millimetre of clearance, so tighten them.
    world.integrationParameters.normalizedAllowedLinearError = 0.00005; // 0.05 mm: the launch chute side plates step by only 0.16 mm
    world.integrationParameters.numSolverIterations = 8;
    // floor and perimeter walls
    const S = size / 2;
    world.createCollider(RAPIER.ColliderDesc.cuboid(S + 30, 0.05, S + 30).setTranslation(0, -0.05, 0).setFriction(0.6).setCollisionGroups(GROUP_FLOOR));
    this.wallHandles = new Set();
    const wallH = this.field.wallHeightM ?? 0.3, t = 0.05;
    if (this.fieldShapes) {
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const st of this.fieldShapes.statics) {
        world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(st.vertices), new Uint32Array(st.indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(0.4).setRestitution(0.2).setCollisionGroups(GROUP_WALL), fixed);
      }
      // each HIVE: a rigid body hinged on the frame's top bar, free to tip between its two rest positions
      for (const h of this.fieldShapes.hives) {
        const d2 = (h.comM[1] - h.pivot[1]) ** 2 + (h.comM[2] - h.pivot[2]) ** 2, Icom = Math.max(h.inertiaAboutPivotKgM2 - h.massKg * d2, 0.02);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAngularDamping(this.field.hive?.angularDamping ?? 1.5)
          .setAdditionalMassProperties(h.massKg, V(h.comM), { x: Icom, y: Icom, z: Icom }, { x: 0, y: 0, z: 0, w: 1 }));
        world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(h.vertices), new Uint32Array(h.indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setDensity(0).setFriction(0.4).setRestitution(0.15).setCollisionGroups(GROUP_INTERIOR), body);
        const joint = world.createImpulseJoint(RAPIER.JointData.revolute(V(h.pivot), V(h.pivot), V(h.axis)), fixed, body, true);
        joint.setLimits(Math.min(0, h.swingRad), Math.max(0, h.swingRad));
        this.hives.push({ id: h.id, cfg: h, body, joint });
      }
    }
    for (const [x, z, hx, hz] of [[0, S + t, S + 2 * t, t], [0, -S - t, S + 2 * t, t], [S + t, 0, t, S], [-S - t, 0, t, S]]) {
      this.wallHandles.add(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, wallH / 2, hz).setTranslation(x, wallH / 2, z).setFriction(0.4).setRestitution(0.1).setCollisionGroups(GROUP_WALL)).handle);
    }
    // chassis: one rigid body; mass, centre of mass and inertia come from the robot configuration
    const mp = ch.massProperties ?? { massKg: ch.massKg, comM: [0, 0.03, 0], inertiaKgM2: [0.14, ch.yawInertiaKgM2, 0.12] };
    this.massProps = mp;
    const body = (this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false)
      .setAdditionalMassProperties(mp.massKg, { x: mp.comM[0], y: mp.comM[1], z: mp.comM[2] }, { x: mp.inertiaKgM2[0], y: mp.inertiaKgM2[1], z: mp.inertiaKgM2[2] }, { x: 0, y: 0, z: 0, w: 1 })));
    // simplified collision hulls from the CAD bounding boxes (visual meshes are never used for physics)
    const o = m.overallM, st = this.assembly.chassis.collision, split = 0.07, bottom = -0.025;
    const box = (min, max) => RAPIER.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2)
      .setTranslation((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2).setDensity(0).setFriction(0.3).setRestitution(0.05);
    const hullGroup = this.shapes ? GROUP_HULL : GROUP_HULL_ALL;
    // The front of the robot is not a flat face: the Gecko shaft sits back between two corner intake
    // wheels, leaving a bay that a FLOWER (or a wall corner) can enter. Positions are from the CAD.
    const gecko = (this.assembly.mechanisms ?? []).find((x) => x.id.startsWith('intake_gecko')), corner = (this.assembly.mechanisms ?? []).find((x) => x.id === 'left_intake_servo_wheel');
    const zFront = gecko ? gecko.center[2] + gecko.radius : o.maxZ, bayHalf = corner ? corner.center[0] - corner.radius : 0;
    const servo = this.shapes?.boxes.find((b) => b.part.startsWith('2000-0025-0003'));
    const podTop = servo ? servo.c[1] + Math.max(...servo.h) : split; // the corner pods are low: wheel plus servo, so they pass under a FLOWER's middle ring
    this.hullColliders = [world.createCollider(box([-o.width / 2, bottom, o.minZ], [o.width / 2, split, zFront]).setCollisionGroups(hullGroup), body)];
    if (zFront < o.maxZ) for (const sx of [-1, 1]) this.hullColliders.push(world.createCollider(box([Math.min(sx * bayHalf, sx * o.width / 2), bottom, zFront], [Math.max(sx * bayHalf, sx * o.width / 2), podTop, o.maxZ]).setCollisionGroups(hullGroup), body));
    this.chassisCollider = this.hullColliders[0];
    world.createCollider(box([st.min[0], split, st.min[2]], [st.max[0], st.max[1], st.max[2]]).setCollisionGroups(hullGroup), body);
    // interior: what game elements actually touch. Boxes and bent-plate surfaces from the CAD, plus the six drive wheels.
    if (this.shapes) {
      // Inside the robot a ball is squeezed and guided, not bounced: contacts with robot surfaces take the lower restitution of the pair.
      const bounce = this.robot.chassis.interiorRestitution ?? 0.02;
      const interior = (desc) => world.createCollider(desc.setDensity(0).setFriction(0.3).setRestitution(bounce).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(GROUP_INTERIOR), body);
      this.shapeNames = new Map();
      const named = (name, col) => this.shapeNames.set(col.handle, name);
      // Real plate and channel edges are not knife-sharp and the ball is soft, so box edges are rounded slightly
      // (same outer size). Without this a ball brushing a plate edge by a fraction of a millimetre is thrown off course.
      const edge = (h) => Math.min(this.robot.chassis.edgeRadiusM ?? 0.001, Math.min(...h) * 0.9);
      const rounded = (h) => { const r = edge(h); return RAPIER.ColliderDesc.roundCuboid(h[0] - r, h[1] - r, h[2] - r, r); };
      for (const b of this.shapes.boxes) named(b.part, interior(rounded(b.h).setTranslation(b.c[0], b.c[1], b.c[2]).setRotation({ x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3] })));
      for (const m of this.shapes.meshes) named(m.part, interior(RAPIER.ColliderDesc.trimesh(new Float32Array(m.vertices), new Uint32Array(m.indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)));
      for (const c of this.assembly.components.filter((x) => x.wheel)) {
        const k = c.collision; // Rapier cylinders lie along Y; turn them onto the axle (X)
        named(c.id, interior(RAPIER.ColliderDesc.cylinder(k.width / 2, k.radius).setTranslation(k.center[0], k.center[1], k.center[2]).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })));
      }
    }
    this.intakeBarZ = (this.assembly.mechanisms ?? []).find((x) => x.id === 'lower_roller')?.center[2] ?? this.assembly.measured.overallM.maxZ;
    // every rotating part: its own angle and speed, coupled through gear meshes, chains and gearboxes
    const net = (this.net = buildNetwork(this.assembly.drivetrain));
    const shaft = (id) => { const i = net.index.get(id); if (i == null) throw new Error(`robot assembly names an unknown shaft "${id}"`); return i; };
    this.mechanisms = (this.shapes ? this.assembly.mechanisms ?? [] : []).map((m) => {
      const pts = m.kind === 'roller' ? [m.center] : m.blades.map((b) => b.center), c = pts.reduce((a, b) => [a[0] + b[0] / pts.length, a[1] + b[1] / pts.length, a[2] + b[2] / pts.length], [0, 0, 0]);
      // everything the part can touch lies inside this sphere (rest pose; blades sweep around their pivot)
      const bound = m.kind === 'roller' ? Math.hypot(m.radius, m.width / 2) : Math.max(...m.blades.map((b) => Math.hypot(b.center[0] - m.pivot[0], b.center[2] - m.pivot[2]) + Math.hypot(...b.half)));
      return { ...m, contacts: 0, launcher: this.robot.devices[m.hardware]?.role === 'flywheel', si: m.shaft ? shaft(m.shaft) : -1, axisV: V(m.axis), centerV: m.kind === 'roller' ? V(m.center) : V(m.pivot), pivotV: m.pivot ? V(m.pivot) : null, bound,
        damping: new Map(), cur: { ctr: null, qb: null, w: 0 } };
    });
    // passive joints (the floating intake arm): one angle each, integrated here
    this.joints = new Map((this.shapes ? this.assembly.joints ?? [] : []).map((j) => [j.id, { cfg: j, lift: j.minLiftRad, rate: 0, torque: 0 }]));
    const fp = this.assembly.measured.overallM;
    this.reach = Math.hypot(fp.width / 2, Math.max(fp.maxZ, -fp.minZ)) + 0.1; // elements farther than this cannot touch a mechanism
    // six wheels: positions and types from the CAD-derived assembly
    this.wheels = this.assembly.components.filter((c) => c.wheel).map((c) => ({
      id: c.id, side: c.wheel.side, omni: c.wheel.type === 'omni', driven: !!c.drive.hardware, si: shaft(c.drive.shaft),
      local: { x: c.joint.pivot[0], y: c.joint.pivot[1], z: c.joint.pivot[2] }, radius: ch.wheelRadiusM, load: 0, contact: false, slip: 0,
    }));
    if (this.wheels.length !== 6) throw new Error(`robot assembly must define six drive wheels, found ${this.wheels.length}`);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.shaftIds = net.ids;
  }

  /** Release the physics world. Call this when a simulator is no longer needed; the engine's memory is not garbage collected. */
  dispose() { if (this.world) { this.world.free(); this.world = null; } }

  /** Put the robot at rest at a start pose (x forward-axis position, y left-axis position in metres, heading in radians). */
  resetPose(start = this.startPose ?? { x: 0, y: 0, heading: 0 }) {
    const ch = this.robot.chassis;
    this.startPose = start;
    this.imuYawZero = start.heading; // a hub zeroes its yaw at power-on; here that is the start pose
    for (const d of this.devices?.values() ?? []) if (d.kind === 'imu') d.yawZero = start.heading;
    this.body.setTranslation({ x: start.y, y: ch.wheelRadiusM, z: start.x }, true);
    this.body.setRotation({ x: 0, y: Math.sin(start.heading / 2), z: 0, w: Math.cos(start.heading / 2) }, true);
    this.stopMotion();
    this.net.reset();
    for (const d of this.devices.values()) {
      d.angle = 0; d.angle0 = 0; d.omega = 0; d.current = 0; d.applied = 0; d.integral = 0; d.lastErr = 0;
      if (d.kind === 'servo') d.position = d.target ?? 0.5;
    }
    for (const j of this.joints?.values() ?? []) { j.lift = j.cfg.minLiftRad; j.rate = 0; }
    this.vel = { v: 0, omega: 0, accel: 0 };
    const volts = this.battery.volts;
    for (let i = 0; i < 400; i++) this.#advance(0.001); // settle onto the tires
    this.battery.volts = volts;
    this.net.reset();
    this.stopMotion();
    const t = this.body.translation();
    this.body.setTranslation({ x: start.y, y: t.y, z: start.x }, true);
    this.time = 0;
    this.#readPose();
  }

  // ------------------------------------------------------------------ game elements
  /** Add a game element (type from the field configuration) at a world position. Returns its id. */
  spawnElement(type, { x, z, y = null, home = true }) {
    const spec = this.field.elements[type];
    if (!spec) throw new Error(`Unknown game element type "${type}". Known: ${Object.keys(this.field.elements).join(', ')}`);
    const r = spec.diameterM / 2, half = this.robot.field.sizeM / 2 - r;
    const pos = { x: clamp(x, -half, half), y: y ?? r, z: clamp(z, -half, half) };
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setCcdEnabled(true).setLinearDamping(spec.linearDamping).setAngularDamping(spec.rollingDamping)); // resting elements may sleep; contacts and forces wake them
    this.world.createCollider(RAPIER.ColliderDesc.ball(r).setMass(spec.massKg).setRestitution(spec.restitution).setFriction(spec.friction).setCollisionGroups(GROUP_ELEMENT), body);
    const id = `${type}-${this.nextElementId++}`;
    this.elements.set(id, { id, type, body, radius: r, home: home ? pos : null });
    return id;
  }

  /** Debug: names of the robot parts a game element is touching right now. */
  touching(id) {
    const e = this.elements.get(id), out = [];
    if (!e) return out;
    const mine = e.body.collider(0);
    this.world.contactPairsWith(mine, (other) => {
      const n = this.shapeNames?.get(other.handle);
      if (!n) return;
      this.world.contactPair(mine, other, (manifold) => { if (manifold.numContacts() > 0 && !out.includes(n)) out.push(n); });
    });
    return out;
  }

  /** Ids of game elements currently inside the robot's frame footprint and off the floor (i.e. carried). */
  carried() {
    const q = this.body.rotation(), p = this.body.translation(), f = this.assembly.measured.overallM, out = [];
    for (const e of this.elements.values()) {
      const c = invRot(q, sub(e.body.translation(), p));
      // inside the frame, behind the intake bar, off the tiles and below the top of the robot
      if (Math.abs(c.x) < f.width / 2 && c.z > f.minZ && c.z < this.intakeBarZ && e.body.translation().y > e.radius + 0.01 && c.y < f.heightAboveGround) out.push(e.id);
    }
    return out;
  }

  /** Drop a game element onto the hopper floor, clear of the windmill blades at rest (robot frame, so it works at any pose). */
  spawnInHopper(type = 'pollen') {
    const w = add(this.body.translation(), rot(this.body.rotation(), { x: -0.01, y: 0.03, z: 0.02 }));
    return this.spawnElement(type, { x: w.x, y: w.y, z: w.z, home: false });
  }

  removeElement(id) {
    const e = this.elements.get(id);
    if (!e) return false;
    this.world.removeRigidBody(e.body);
    return this.elements.delete(id);
  }

  clearElements() { for (const id of [...this.elements.keys()]) this.removeElement(id); }

  /** Put every element back where it was placed, at rest, and the HIVES back in their staged position. */
  resetElements() {
    for (const h of this.hives) {
      h.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); h.body.setTranslation({ x: 0, y: 0, z: 0 }, true);
      h.body.setLinvel({ x: 0, y: 0, z: 0 }, true); h.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const e of this.elements.values()) {
      if (!e.home) { this.removeElement(e.id); continue; }
      e.body.setTranslation(e.home, true); e.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Stage elements per the field configuration (official match setup, as far as it is simulated). */
  stageElements(preset = 'match') {
    const plan = this.field.staging[preset];
    if (!plan) throw new Error(`Unknown staging preset "${preset}"`);
    this.clearElements();
    this.resetElements();
    const preload = (type, count) => { // on the tiles, touching the front of the robot (allowed by Section 10.3.4)
      const d = this.field.elements[type].diameterM, q = this.body.rotation(), p = this.body.translation();
      for (let i = 0; i < count; i++) {
        const w = add(p, rot(q, { x: (i - (count - 1) / 2) * (d + 0.004), y: 0, z: this.assembly.measured.overallM.maxZ + d / 2 + 0.002 }));
        this.spawnElement(type, { x: w.x, z: w.z });
      }
    };
    if (this.fieldShapes) {
      // every element the official field CAD shows inside the field, exactly where the CAD puts it
      for (const e of this.fieldShapes.elements) if (!e.where.startsWith('outside')) this.spawnElement(e.type, { x: e.p[0], y: e.p[1], z: e.p[2] });
      for (const item of plan) if (item.where === 'robot_preload') preload(item.type, item.count);
      return this.elements.size;
    }
    const half = this.robot.field.sizeM / 2;
    for (const item of plan) {
      const d = this.field.elements[item.type].diameterM, r = d / 2;
      if (item.where === 'robot_preload') { preload(item.type, item.count); continue; }
      for (let i = 0; i < item.count; i++) {
        if (item.where === 'garden_red') this.spawnElement(item.type, { x: half - r - i * d, z: -half + r });
        else if (item.where === 'garden_blue') this.spawnElement(item.type, { x: -half + r + i * d, z: half - r });
      }
    }
    return this.elements.size;
  }

  /** Zero the chassis velocity (used when a new OpMode is initialised). */
  stopMotion() {
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.net.omega.fill(0);
    for (const d of this.devices.values()) if (d.act) d.omega = 0;
  }

  /** Bind a device requested by the OpMode to the robot model. Returns the device record. */
  ensureDevice(name, kind) {
    let d = this.devices.get(name);
    if (d) return d;
    const device = this.aliases?.[name] ?? name; // manual mapping: a name used in code -> a device of the robot model
    const cfg = this.robot.devices[device];
    // a continuous-rotation servo is wired and commanded exactly like a positional one: code may use either class
    const asCr = kind === 'servo' && cfg?.kind === 'crservo';
    const resolved = !!cfg && (cfg.kind === kind || asCr);
    const act = resolved ? this.assembly.drivetrain.actuators[device] : null;
    d = { name, device: resolved ? device : null, kind, resolved, role: resolved ? cfg.role ?? kind : 'detached', label: resolved ? cfg.label : null,
          angle: 0, omega: 0, current: 0, applied: 0, integral: 0, lastErr: 0 };
    if (cfg && cfg.kind !== kind && !asCr) d.mismatch = `robot model defines "${name}" as ${cfg.kind}, code requested ${kind}`;
    if (kind === 'motor') {
      const modelId = resolved ? cfg.model : this.robot.unresolvedDefaults.motorModel;
      d.modelId = modelId;
      d.model = this.robot.motorModels[modelId];
      d.k = motorConstants(d.model);
      d.sign = resolved ? cfg.forwardSign ?? 1 : 1;
      d.J = 0.001; d.visc = 0.001; // only used when the name is not bound to a robot part
      d.cmd = defaultCommand();
      if (act) { // the motor acts on its rotor shaft; the encoder counts rotor turns
        d.act = act; d.si = this.net.index.get(act.rotor); d.gearbox = act.gearbox; d.sign = act.sign;
        d.angle0 = (d.sign * this.net.angle[d.si]) / d.gearbox; // encoders read zero when an OpMode first asks for the motor
        d.tq = d.k.Kt / (d.k.R * d.gearbox); d.emfDrag = (d.k.Kt * d.k.Ke) / (d.k.R * d.gearbox * d.gearbox);
      }
    } else if (kind === 'crservo' || asCr) {
      d.freeRad = ((resolved ? cfg.freeRpm : this.robot.unresolvedDefaults.crservoFreeRpm) * TWO_PI) / 60;
      d.power = 0; d.continuous = true;
      if (asCr) { d.target = null; d.position = 0.5; d.label = `${cfg.label} (driven through the Servo class: 0.5 stops, 0 and 1 are full speed)`; }
      if (act) { d.act = act; d.si = this.net.index.get(act.shaft); d.sign = act.sign; d.angle0 = d.sign * this.net.angle[d.si]; d.stall = cfg.stallTorqueNm ?? 1; }
    } else if (kind === 'servo') {
      d.target = null; d.position = 0.5;
    } else { // sensors
      d.sensor = true; d.manual = null; d.cfg = resolved ? cfg : null; d.values = [];
      if (kind === 'imu') d.yawZero = this.imuYawZero ?? 0;
    }
    this.devices.set(name, d);
    return d;
  }

  setMotorCommand(name, cmd) {
    const d = this.ensureDevice(name, 'motor');
    if (d.kind !== 'motor') return;
    const prevMode = d.cmd.mode;
    d.cmd = { ...d.cmd, ...cmd };
    if (d.cmd.mode !== prevMode) { d.integral = 0; d.lastErr = 0; }
  }

  // ------------------------------------------------------------------ sensors
  /** Zero an IMU's yaw at the robot's current heading (IMU.resetYaw()). The zero persists across OpModes, like a real hub. */
  resetImuYaw(name) { const d = this.devices.get(name); if (d?.kind === 'imu') { d.yawZero = this.pose.heading; this.imuYawZero = d.yawZero; } }

  /** Set a sensor's reading by hand (values in the sensor's own units), or pass null to return it to the simulated reading. */
  setSensorManual(name, values) {
    const d = this.devices.get(name);
    if (!d?.sensor) throw new Error(`"${name}" is not a sensor in the running OpMode.`);
    d.manual = values == null ? null : values.map(Number);
  }

  #readSensor(d) {
    if (d.manual) return d.manual;
    const q = this.body.rotation(), p = this.body.translation();
    switch (d.kind) {
      case 'imu': {
        const w = invRot(q, this.body.angvel()); // body frame: x left, y up, z front
        let yaw = this.pose.heading - d.yawZero; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        return [yaw, (this.tilt.pitchDeg * Math.PI) / 180, (this.tilt.rollDeg * Math.PI) / 180, -w.x, w.z, w.y]; // yaw, pitch, roll, then x (pitch), y (roll), z (yaw) rates
      }
      case 'voltage': return [this.battery.volts];
      case 'distance': {
        const m = d.cfg?.mount; if (!m) return [-1];
        const origin = add(p, rot(q, V(m.position))), dir = rot(q, norm(V(m.direction)));
        const hit = this.world.castRay(new RAPIER.Ray(origin, dir), d.cfg.maxM ?? 2, true, undefined, undefined, undefined, this.body);
        return [hit && hit.timeOfImpact >= (d.cfg.minM ?? 0) ? hit.timeOfImpact : -1];
      }
      case 'color': {
        const m = d.cfg?.mount; if (!m) return [0.03, 0.03, 0.03, 0.05, -1];
        const at = add(p, rot(q, V(m.position))), range = d.cfg.rangeM ?? 0.08;
        let best = null, bestD = Infinity;
        for (const e of this.elements.values()) { const dist = len(sub(e.body.translation(), at)) - e.radius; if (dist < bestD) { bestD = dist; best = e; } }
        if (!best || bestD > range) return [0.03, 0.03, 0.03, 0.05, -1];
        const hex = this.field.elements[best.type].color, c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), k = 1 - 0.5 * Math.max(0, bestD) / range;
        return [c[0] * k, c[1] * k, c[2] * k, k, Math.max(0, bestD)];
      }
      case 'touch': return [0];
      case 'digital': return [d.output ?? 1]; // inputs idle high (pull-up), like the hub
      default: return [0];
    }
  }

  /** Readings for every sensor the running OpMode has asked for. */
  sensorReadings() {
    const out = [];
    for (const d of this.devices.values()) if (d.sensor) { d.values = this.#readSensor(d); out.push([d.name, d.values]); }
    return out;
  }

  setCRServo(name, power) { const d = this.ensureDevice(name, 'crservo'); if (d.kind === 'crservo') d.power = clamp(power, -1, 1); }
  setServo(name, pos) {
    const d = this.ensureDevice(name, 'servo');
    if (d.kind !== 'servo') return;
    d.target = clamp(pos, 0, 1);
    if (d.continuous) { d.position = d.target; d.power = 2 * d.target - 1; }
  }

  /** Called when no OpMode is running: the hub de-energizes every output. */
  zeroAll() {
    for (const d of this.devices.values()) {
      if (d.kind === 'motor') { d.cmd = { ...d.cmd, mode: 'RUN_WITHOUT_ENCODER', power: 0, velTicks: null }; d.integral = 0; }
      if (d.continuous) d.power = 0;
    }
  }

  clearDevices() { this.devices.clear(); }

  /** Duty cycle (-1..1) the hub applies this step, following the commanded run mode. */
  duty(d, dt) {
    const c = d.cmd;
    const tps = d.omega * d.k.ticksPerRad;
    let target;
    if (c.mode === 'RUN_WITHOUT_ENCODER') return clamp(c.power, -1, 1);
    if (c.mode === 'STOP_AND_RESET_ENCODER') return 0;
    if (c.mode === 'RUN_USING_ENCODER') {
      target = c.velTicks != null ? c.velTicks : c.power * d.k.maxTps;
    } else { // RUN_TO_POSITION: position P loop feeding the velocity loop, speed capped by |power|
      const posErr = c.targetPos - d.angle * d.k.ticksPerRad;
      const cap = c.velTicks != null ? Math.abs(c.velTicks) : Math.abs(c.power) * d.k.maxTps;
      target = clamp(c.posP * posErr, -cap, cap); // posP treated as 1/s: an approximation of hub firmware
    }
    d.targetTps = target;
    if (target === 0 && c.mode === 'RUN_USING_ENCODER') { d.integral = 0; d.lastErr = 0; return 0; }
    const F0 = 32767 / d.k.maxTps;
    const [P, I, D, F] = c.pidf ?? [0.1 * F0, 0.01 * F0, 0, F0];
    const err = target - tps;
    // Hub firmware integrates per control cycle; modelled here as a 20 Hz-equivalent integral (approximation).
    d.integral = clamp(d.integral + err * dt * 20, -32767 / Math.max(I, 1e-9), 32767 / Math.max(I, 1e-9));
    const deriv = (err - d.lastErr) / dt / 20;
    d.lastErr = err;
    return clamp((P * err + I * d.integral + D * deriv + F * target) / 32767, -1, 1);
  }

  /** Motor torque at the output shaft (motor frame) for this step; records current and duty. */
  motorTorque(d, dt) {
    const duty = this.duty(d, dt);
    d.applied = duty;
    if (duty === 0 && d.cmd.zpb === 'FLOAT') { d.current = 0; return 0; }
    // duty == 0 with BRAKE shorts the windings: only back-EMF drives current, which brakes the motor.
    const amps = (duty * this.battery.volts - d.k.Ke * d.omega) / d.k.R;
    d.current = amps;
    return d.k.Kt * amps;
  }

  /**
   * Tire contacts, first half. Each wheel is a ray from its axle toward the floor: a stiff spring-damper
   * gives the normal load. The grip force depends on the wheel's own speed, which the gear train is about
   * to change, so here each wheel only hands its shaft a drag toward the rolling speed; the force on the
   * chassis is applied by #applyTires once the shafts have moved.
   */
  #wheelContacts() {
    const ch = this.robot.chassis, body = this.body, tire = ch.tire, net = this.net, ray = this.ray;
    const q = body.rotation(), p = body.translation(), com = body.worldCom(), lin = body.linvel(), ang = body.angvel();
    const down = rot(q, { x: 0, y: -1, z: 0 }), fwdBody = rot(q, { x: 0, y: 0, z: 1 }), leftBody = rot(q, { x: 1, y: 0, z: 0 });
    ray.dir = down;
    for (const w of this.wheels) {
      const axle = add(p, rot(q, w.local));
      ray.origin = axle;
      const hit = this.world.castRayAndGetNormal(ray, w.radius + 0.03, true, undefined, RAY_FLOOR_ONLY, undefined, body);
      w.contact = false; w.load = 0; w.slip = 0;
      if (!hit) continue;
      const depth = w.radius - hit.timeOfImpact;
      if (depth <= 0) continue;
      const n = hit.normal, c = add(axle, mul(down, hit.timeOfImpact));
      const v = add(lin, cross(ang, sub(c, com)));
      const load = Math.max(0, tire.stiffnessNPerM * depth - tire.dampingNsPerM * dot(v, n));
      if (load <= 0) continue;
      w.contact = true; w.load = load; w.n = n; w.c = c;
      const f = (w.f = norm(sub(fwdBody, mul(n, dot(fwdBody, n))))), l = (w.l = norm(sub(leftBody, mul(n, dot(leftBody, n)))));
      const vf = (w.vf = dot(v, f)), slip0 = net.omega[w.si] * w.radius - vf;
      const limit = ch.tireFriction * load;
      const Ff0 = limit * sat(slip0 / tire.slipRefMps);
      const Fl = -(w.omni ? tire.omniLateralFriction : ch.tireFriction) * load * sat(dot(v, l) / tire.slipRefMps);
      const mag = Math.hypot(Ff0, Fl), k = mag > limit ? limit / mag : 1; // friction circle
      w.Fl = Fl * k; w.cap = limit * k;
      w.gain = w.cap / Math.max(Math.abs(slip0), tire.slipRefMps); // grip force per m/s of slip
      net.addDamping(w.si, w.gain * w.radius * w.radius, vf / w.radius);
    }
  }

  /** Tire contacts, second half: the grip each wheel ends the step with, applied to the chassis. */
  #applyTires() {
    const ch = this.robot.chassis, body = this.body, net = this.net;
    let sl = 0, sr = 0;
    for (const w of this.wheels) {
      if (!w.contact) continue;
      const slip = (w.slip = net.omega[w.si] * w.radius - w.vf);
      const Ff = clamp(w.gain * slip, -w.cap, w.cap);
      const rolling = -ch.rollingResistance * w.load * Math.tanh(w.vf / 0.02);
      body.addForceAtPoint(add(add(mul(w.n, w.load), mul(w.f, Ff + rolling)), mul(w.l, w.Fl)), w.c, true);
      if (w.driven) { if (w.side === 'left') sl += slip / 2; else sr += slip / 2; }
    }
    this.sideSlip = { left: sl, right: sr };
  }

  /**
   * Compliant contacts between game elements and the robot's powered parts. A soft wheel pressing on
   * a ball is a spring-damper along the contact normal plus friction that drags the ball toward the
   * wheel's surface speed. The same force, reversed, acts on the chassis and on the shaft the part turns on.
   */
  #mechanismContacts(dt) {
    for (const j of this.joints.values()) j.torque = 0;
    if (!this.mechanisms.length) return;
    const body = this.body, net = this.net, q = body.rotation(), p = body.translation();
    let near = null;
    for (const e of this.elements.values()) {
      const bp = e.body.translation();
      if (Math.hypot(bp.x - p.x, bp.z - p.z) > this.reach || bp.y - p.y > 0.4) continue;
      (near ??= []).push(e); e.bp = bp;
    }
    if (!near) { if (this.mechTouched) { for (const m of this.mechanisms) m.contacts = 0; this.mechTouched = false; } }
    else {
      this.mechTouched = true;
      const com = body.worldCom(), lin = body.linvel(), ang = body.angvel();
      // where each part is right now (parts on the floating arm swing with it; blades turn with their shaft)
      for (const m of this.mechanisms) {
        const cur = m.cur, jt = m.joint ? this.joints.get(m.joint) : null;
        m.contacts = 0; cur.w = m.si >= 0 ? net.omega[m.si] : 0; cur.jt = jt; cur.ctr = m.centerV;
        if (jt) {
          const jAxis = (cur.jAxis = jt.axisV ??= V(jt.cfg.axis)), jPivot = (cur.jPivot = jt.pivotV ??= V(jt.cfg.pivot)), hh = -jt.lift / 2, sn = Math.sin(hh);
          cur.ctr = add(jPivot, rot({ x: jAxis.x * sn, y: jAxis.y * sn, z: jAxis.z * sn, w: Math.cos(hh) }, sub(m.centerV, jPivot)));
        }
        if (m.kind !== 'roller') { const half = net.angle[m.si] / 2, sn = Math.sin(half); cur.qb = { x: m.axisV.x * sn, y: m.axisV.y * sn, z: m.axisV.z * sn, w: Math.cos(half) }; }
      }
      const hits = [];
      for (const e of near) {
        const bp = e.bp, c = invRot(q, sub(bp, p)); // ball centre in the chassis frame
        hits.length = 0; // every place this ball touches a powered part: { part, point (chassis frame), normal (toward ball), depth }
        for (const m of this.mechanisms) {
          const cur = m.cur, ctr = cur.ctr, dx = c.x - ctr.x, dy = c.y - ctr.y, dz = c.z - ctr.z, far = m.bound + e.radius;
          if (dx * dx + dy * dy + dz * dz > far * far) continue;
          const axis = m.axisV;
          if (m.kind === 'roller') {
            const h = dx * axis.x + dy * axis.y + dz * axis.z, rx = dx - axis.x * h, ry = dy - axis.y * h, rz = dz - axis.z * h, rho = Math.hypot(rx, ry, rz);
            if (Math.abs(h) > m.width / 2 + e.radius || rho > m.radius + e.radius) continue;
            const hc = clamp(h, -m.width / 2, m.width / 2), k = rho > 1e-9 ? Math.min(rho, m.radius) / rho : 0;
            const cp = { x: ctr.x + axis.x * hc + rx * k, y: ctr.y + axis.y * hc + ry * k, z: ctr.z + axis.z * hc + rz * k };
            const gap = sub(c, cp), dist = len(gap);
            if (dist < e.radius && dist > 1e-9) hits.push({ m, point: cp, normal: mul(gap, 1 / dist), depth: e.radius - dist });
          } else { // blades rotating about a pivot
            const pivot = m.pivotV, qb = cur.qb, rest = add(pivot, invRot(qb, sub(c, pivot))); // ball centre in the blades' rest pose
            for (const b of m.blades) {
              const cp = { x: clamp(rest.x, b.center[0] - b.half[0], b.center[0] + b.half[0]), y: clamp(rest.y, b.center[1] - b.half[1], b.center[1] + b.half[1]), z: clamp(rest.z, b.center[2] - b.half[2], b.center[2] + b.half[2]) };
              const gap = sub(rest, cp), dist = len(gap);
              if (dist < e.radius && dist > 1e-9) hits.push({ m, point: add(pivot, rot(qb, sub(cp, pivot))), normal: rot(qb, mul(gap, 1 / dist)), depth: e.radius - dist });
            }
          }
        }
        if (!hits.length) continue;
        const mass = e.body.mass(), bv = e.body.linvel(), bw = e.body.angvel();
        // Damping and friction are applied from the speeds at the start of the step. A ball held by three or
        // more parts at once (wedged under the windmill, touching all four blades) would get more than one step
        // can absorb and buzz at 1 kHz, so there the shares are scaled down. One or two contacts (a wheel, or the
        // windmill handing a ball to the flywheel) keep their full damping.
        let dampSum = 0;
        for (const hit of hits) {
          const m = hit.m;
          let d = m.damping.get(mass); // how quickly the squeeze settles instead of ringing
          if (d === undefined) m.damping.set(mass, (d = 2 * (m.dampingRatio ?? 0.3) * Math.sqrt(m.stiffnessNPerM * mass)));
          hit.damping = d; dampSum += (d * dt) / mass;
        }
        const many = hits.length > 2, dampMax = many ? 0.6 : 1.35, dampScale = dampSum > dampMax ? dampMax / dampSum : 1, slipShare = Math.min(0.4, 0.8 / hits.length);
        {
          for (const hit of hits) {
            const m = hit.m, cur = m.cur, ctr = cur.ctr, axis = m.axisV, w = cur.w, jt = cur.jt, damping = hit.damping * dampScale;
            const n = rot(q, hit.normal), pt = add(p, rot(q, hit.point)), arm = sub(hit.point, ctr);
            let local = cross(mul(axis, w), arm); // the part's own spin
            if (jt) local = add(local, cross(mul(cur.jAxis, -jt.rate), sub(hit.point, cur.jPivot))); // plus the swing of the arm it rides on
            const surface = add(add(lin, cross(ang, sub(pt, com))), rot(q, local)); // plus chassis motion
            const relv = sub(add(bv, cross(bw, sub(pt, bp))), surface), vn = dot(relv, n);
            const N = Math.max(0, m.stiffnessNPerM * hit.depth - damping * vn);
            if (N <= 0) continue;
            const slip = sub(relv, mul(n, vn)), slipSpeed = len(slip);
            let force = mul(n, N);
            if (slipSpeed > 1e-6 && m.friction > 0) {
              // Coulomb friction, capped so one step can at most remove the slip (keeps light balls stable)
              const mag = Math.min(m.friction * N, (slipShare * mass * slipSpeed) / dt);
              force = add(force, mul(slip, -mag / slipSpeed));
            }
            e.body.addForceAtPoint(force, pt, true);
            body.addForceAtPoint(mul(force, -1), pt, true);
            const back = invRot(q, mul(force, -1)); // the ball's push on the part, chassis frame
            if (m.si >= 0) net.addTorque(m.si, dot(cross(arm, back), axis)); // felt by whatever drives the shaft
            if (m.launcher && w < 30) this.launchFault = { kind: w < -10 ? 'reversed' : w > 10 ? 'slow' : 'stopped', radPerS: w, time: this.time }; // a ball met a flywheel that cannot throw it
            if (jt) jt.torque += -dot(cross(sub(hit.point, cur.jPivot), back), cur.jAxis); // lifting torque on the arm
            m.contacts++;
          }
        }
      }
    }
    // passive joints: contact torque against gravity, between the stops
    for (const j of this.joints.values()) {
      const cfg = j.cfg;
      if (j.torque === 0 && j.rate === 0 && j.lift <= cfg.minLiftRad) continue; // resting on its lower stop
      const ry = cfg.comM[1] - cfg.pivot[1], rz = cfg.comM[2] - cfg.pivot[2];
      const zArm = ry * Math.sin(-j.lift) + rz * Math.cos(-j.lift); // how far the arm's centre of mass sits ahead of the pivot
      const tau = j.torque - cfg.massKg * G * zArm - cfg.dampingNmsPerRad * j.rate;
      j.rate += (tau / cfg.inertiaAboutPivotKgM2) * dt;
      j.lift += j.rate * dt;
      if (j.lift <= cfg.minLiftRad) { j.lift = cfg.minLiftRad; if (j.rate < 0) j.rate = 0; }
      if (j.lift >= cfg.maxLiftRad) { j.lift = cfg.maxLiftRad; if (j.rate > 0) j.rate = 0; }
    }
  }

  #readPose() {
    const p = this.body.translation(), q = this.body.rotation(), lin = this.body.linvel(), ang = this.body.angvel();
    const f = rot(q, { x: 0, y: 0, z: 1 }), up = rot(q, { x: 0, y: 1, z: 0 });
    this.pose = { x: p.z, y: p.x, heading: Math.atan2(f.x, f.z) };
    this.pose3d = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
    this.tilt = { pitchDeg: (Math.asin(clamp(f.y, -1, 1)) * 180) / Math.PI, rollDeg: (Math.asin(clamp(rot(q, { x: 1, y: 0, z: 0 }).y, -1, 1)) * 180) / Math.PI, upY: up.y };
    return { forwardSpeed: dot(lin, norm({ x: f.x, y: 0, z: f.z })), yawRate: ang.y };
  }

  /** One physics step, without advancing the clock. */
  #advance(dt) {
    const net = this.net, body = this.body;
    let batteryAmps = 0;
    // 1. what each motor and servo does to the shaft it sits on
    for (const d of this.devices.values()) {
      if (d.kind === 'motor') {
        if (d.act) {
          const duty = (d.applied = this.duty(d, dt));
          if (duty === 0 && d.cmd.zpb === 'FLOAT') d.current = 0;
          else { // duty == 0 with BRAKE shorts the windings: only back-EMF drives current, which brakes the motor
            d.current = (duty * this.battery.volts - d.k.Ke * d.omega) / d.k.R;
            net.addTorque(d.si, d.sign * d.tq * duty * this.battery.volts);
            net.addDamping(d.si, d.emfDrag);
          }
        } else { // a name with no robot part behind it: a bare motor spinning freely
          d.omega += ((this.motorTorque(d, dt) - d.visc * d.omega) / d.J) * dt;
          d.angle += d.omega * dt;
        }
        batteryAmps += Math.abs(d.applied) * Math.abs(d.current);
      } else if (d.continuous) {
        if (d.act) { // servo output: torque falls linearly from stall to nothing at its free speed
          net.addTorque(d.si, d.sign * d.stall * (Math.abs(d.power) < 0.02 ? 0 : d.power));
          net.addDamping(d.si, d.stall / d.freeRad);
        } else { d.omega += ((d.power * d.freeRad - d.omega) / 0.05) * dt; d.angle += d.omega * dt; }
      } else if (d.target != null) {
        const maxStep = (1 / 0.6) * dt; // full travel in ~0.6 s (estimate)
        d.position += clamp(d.target - d.position, -maxStep, maxStep);
      }
    }
    // 2. loads on the shafts from the floor and from game elements, then the gear trains move
    body.resetForces(true);
    body.resetTorques(true);
    for (const e of this.elements.values()) if (!e.body.isSleeping()) { e.body.resetForces(false); e.body.resetTorques(false); }
    this.#wheelContacts();
    this.#mechanismContacts(dt);
    net.step(dt);
    this.#applyTires();
    for (const d of this.devices.values()) {
      if (!d.act) continue;
      if (d.kind === 'motor') { d.omega = (d.sign * net.omega[d.si]) / d.gearbox; d.angle = (d.sign * net.angle[d.si]) / d.gearbox - d.angle0; d.slip = d.role === 'drive-left' ? this.sideSlip.left : d.role === 'drive-right' ? this.sideSlip.right : undefined; }
      else { d.omega = d.sign * net.omega[d.si]; d.angle = d.sign * net.angle[d.si] - d.angle0; }
    }
    // 3. rigid bodies
    this.world.timestep = dt;
    this.world.step();
    this.battery.amps = batteryAmps;
    this.battery.volts = this.robot.battery.openCircuitV - batteryAmps * this.robot.battery.internalResistanceOhm; // sag from this step's draw
  }

  step(dt) {
    this.#advance(dt);
    const { forwardSpeed, yawRate } = this.#readPose();
    this.vel.accel += ((forwardSpeed - this.vel.v) / dt - this.vel.accel) * Math.min(1, dt / 0.03); // 30 ms low-pass
    this.vel.v = forwardSpeed;
    this.vel.omega = yawRate;
    if (++this.stepCount % 16 === 0) {
      this.atWall = false;
      for (const c of this.hullColliders) this.world.contactPairsWith(c, (other) => { if (this.wallHandles.has(other.handle)) this.atWall = true; });
    }
    this.time += dt;
  }
  stepCount = 0;
  launchFault = null; // set when a ball meets a flywheel that is stopped, slow or reversed; cleared by whoever reports it

  /** Raw (direction-independent) encoder readings for the OpMode JVM. */
  motorReadings() {
    const out = [];
    for (const d of this.devices.values()) {
      if (d.kind === 'motor') out.push([d.name, d.angle * d.k.ticksPerRad, d.omega * d.k.ticksPerRad, Math.abs(d.current)]);
    }
    return out;
  }

  /** Angle (wrapped to one turn) and speed of every shaft, by shaft id: what the 3D view poses the gears from. */
  shaftSnapshot() {
    const out = {}, { angle, omega } = this.net;
    for (let i = 0; i < this.shaftIds.length; i++) { const a = angle[i] % TWO_PI; out[this.shaftIds[i]] = [Math.round(a * 1e4) / 1e4, Math.round(omega[i] * 1e3) / 1e3]; }
    return out;
  }

  snapshot() {
    const devices = {};
    for (const d of this.devices.values()) {
      const base = { kind: d.kind, resolved: d.resolved, device: d.device, role: d.role, label: d.label, mismatch: d.mismatch ?? null };
      if (d.kind === 'motor') {
        devices[d.name] = { ...base, model: d.modelId, mode: d.cmd.mode, commandedPower: d.cmd.power, appliedDuty: d.applied,
          positionTicks: d.angle * d.k.ticksPerRad, velocityTps: d.omega * d.k.ticksPerRad,
          targetVelTps: d.cmd.mode === 'RUN_WITHOUT_ENCODER' ? null : d.targetTps ?? null,
          targetPosTicks: d.cmd.mode === 'RUN_TO_POSITION' ? d.cmd.targetPos : null,
          rpm: (d.omega * 60) / TWO_PI, angle: d.angle, currentA: Math.abs(d.current), zpb: d.cmd.zpb, dir: d.cmd.dir ?? 'FORWARD',
          slipMps: d.slip ?? null };
      } else if (d.continuous) {
        devices[d.name] = { ...base, kind: 'crservo', commandedPower: d.power, rpm: (d.omega * 60) / TWO_PI, angle: d.angle, viaServoClass: d.kind === 'servo' };
      } else if (d.sensor) {
        devices[d.name] = { ...base, sensor: true, values: d.values, manual: !!d.manual, simulated: d.kind === 'imu' || d.kind === 'voltage' || !!d.cfg?.mount };
      } else {
        devices[d.name] = { ...base, target: d.target, position: d.position };
      }
    }
    return { t: this.time, pose: { ...this.pose }, pose3d: this.pose3d, tilt: this.tilt, vel: { ...this.vel }, atWall: !!this.atWall,
      wheels: this.wheels.map((w) => ({ id: w.id, contact: w.contact, loadN: w.load })),
      mechanisms: this.mechanisms.map((m) => ({ id: m.id, contacts: m.contacts })),
      shafts: this.shaftSnapshot(),
      joints: Object.fromEntries([...this.joints].map(([id, j]) => [id, j.lift])),
      carried: this.carried(),
      hives: this.hives.map((h) => { const q = h.body.rotation(), a = 2 * Math.atan2(q.x, q.w); return { id: h.id, angle: a, tipped: Math.abs(a) > Math.abs(h.cfg.swingRad) / 2 }; }),
      elements: [...this.elements.values()].map((e) => { const p = e.body.translation(), q = e.body.rotation(); return { id: e.id, type: e.type, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }; }),
      battery: { ...this.battery }, devices };
  }
}
