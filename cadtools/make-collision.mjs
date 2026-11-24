// Builds simplified physics collision shapes for the robot's static interior from the converted CAD.
// Flat plates, channels, motors, posts etc. become oriented boxes fitted to the part in its own CAD
// frame; bent plates keep their real triangles. Moving parts are excluded (they are modelled as
// compliant rollers/blades in the assembly's "mechanisms" list).
// Usage: node make-collision.mjs model.glb assembly.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix4, Vector3, Quaternion } from 'three';
import { readGlb, accessorData, walk, localMatrix } from './glb.mjs';

const [glbPath, assemblyPath, outPath] = process.argv.slice(2);
const glb = readGlb(glbPath), g = glb.gltf;
const assembly = JSON.parse(readFileSync(assemblyPath, 'utf8'));
// moving parts, and everything riding on a moving part (e.g. the motor on the intake arm), are not static shapes
const moving = new Set(assembly.components.filter((c) => c.movable || c.parent !== 'chassis').flatMap((c) => c.nodes));
const BOX = /^(1120|1121|1143|1201|1205|1616|1209|3100|5203|2000|3217|1501|1516)-/;
const PLATE = /^1117-/;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// Bent gridplates are perforated. Colliding a ball with thousands of hole rims gives noisy contact
// normals, so the plate is resampled as a smooth skin: heights on a regular grid over (x, z), taken
// from the real vertices near each grid node. The skin follows the CAD surface; only the holes go.
function resurface(name, model, cell = 0.003, reach = 0.005) {
  const n = model.length / 3;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = model[i * 3], z = model[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
  const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, h = new Float64Array((nx + 1) * (nz + 1)).fill(-Infinity);
  const rx = Math.ceil(reach / dx), rz = Math.ceil(reach / dz);
  for (let i = 0; i < n; i++) {
    const x = model[i * 3], y = model[i * 3 + 1], z = model[i * 3 + 2], ix = Math.round((x - x0) / dx), iz = Math.round((z - z0) / dz);
    for (let a = Math.max(0, ix - rx); a <= Math.min(nx, ix + rx); a++) for (let b = Math.max(0, iz - rz); b <= Math.min(nz, iz + rz); b++) {
      if (Math.hypot(x0 + a * dx - x, z0 + b * dz - z) > reach) continue;
      const k = a * (nz + 1) + b; if (y > h[k]) h[k] = y;
    }
  }
  const vertices = [], index = new Int32Array(h.length).fill(-1), indices = [];
  for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) { const k = a * (nz + 1) + b; if (h[k] > -Infinity) { index[k] = vertices.length / 3; vertices.push(r5(x0 + a * dx), r5(h[k]), r5(z0 + b * dz)); } }
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    const p = index[a * (nz + 1) + b], q = index[(a + 1) * (nz + 1) + b], r = index[(a + 1) * (nz + 1) + b + 1], t = index[a * (nz + 1) + b + 1];
    if (p >= 0 && q >= 0 && r >= 0 && t >= 0) indices.push(p, t, r, p, r, q);
  }
  return { part: name, kind: 'smooth skin resampled from the CAD surface on a 3 mm grid', triangles: indices.length / 3, vertices, indices };
}

// The launcher ramp wraps around the flywheel. A thin triangle skin is a poor surface for a ball
// arriving at 6 m/s (it glances off unpredictably), so this one plate is rebuilt as a chain of short
// solid blocks that follow the plate's inner face. The face itself is read from the CAD: for each
// direction from the flywheel axle, the nearest point of the plate.
const flywheel = assembly.mechanisms?.find((m) => m.id === 'launcher_flywheel');
const hood = flywheel ? /3200-2627-0003_G\)/ : null;
function wrapSegments(name, model, stepDeg = 3, thick = 0.008) {
  const cy = flywheel.center[1], cz = flywheel.center[2], bins = new Map();
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < model.length; i += 3) {
    const x = model[i], y = model[i + 1] - cy, z = model[i + 2] - cz;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    const k = Math.round((Math.atan2(y, z) * 180) / Math.PI / stepDeg), r = Math.hypot(y, z);
    if (!bins.has(k) || r < bins.get(k)) bins.set(k, r);
  }
  // order the profile along the plate: it runs from under the flywheel, round the back, to its top edge
  const keys = [...bins.keys()].sort((a, b) => a - b);
  let start = 0; for (let i = 1; i < keys.length; i++) if (keys[i] - keys[i - 1] > 3) start = i; // largest gap = where the plate is absent
  const order = [...keys.slice(start), ...keys.slice(0, start)];
  const pts = order.map((k) => { const a = (k * stepDeg * Math.PI) / 180, r = bins.get(k); return [cy + r * Math.sin(a), cz + r * Math.cos(a)]; }); // [y, z]
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ya, za] = pts[i], [yb, zb] = pts[i + 1], len = Math.hypot(yb - ya, zb - za);
    if (len < 1e-4 || len > 0.05) continue;
    const ty = (yb - ya) / len, tz = (zb - za) / len; // along the plate
    let ny = -tz, nz = ty; // across it; make it point away from the flywheel
    const my = (ya + yb) / 2, mz = (za + zb) / 2;
    if (ny * (my - cy) + nz * (mz - cz) < 0) { ny = -ny; nz = -nz; }
    const ang = Math.atan2(ty, tz); // rotation about +X taking local +Z onto the plate direction
    out.push({ part: `${name} [segment ${i + 1}]`, c: [r5((x0 + x1) / 2), r5(my + ny * thick / 2), r5(mz + nz * thick / 2)], h: [r5((x1 - x0) / 2), r5(thick / 2), r5(len / 2 + 0.001)],
      q: [r5(Math.sin(-ang / 2)), 0, 0, r5(Math.cos(-ang / 2))] });
  }
  return out;
}

const boxes = [], meshes = [], skipped = {};
walk(g, (i, node, world, parent, depth) => {
  if (depth !== 1) return;
  const name = node.name, sku = name.split(/[ :]/)[0];
  if (moving.has(name) || !(BOX.test(name) || PLATE.test(name))) { skipped[sku] = (skipped[sku] ?? 0) + 1; return; }
  // gather every vertex of the part, both in the part's own frame and in the model frame
  const local = [], model = [], indices = [];
  const visit = (ni, toPart, toModel) => {
    const n = g.nodes[ni];
    if (n.mesh != null) for (const p of g.meshes[n.mesh].primitives) {
      const pos = accessorData(glb, p.attributes.POSITION), base = model.length / 3, v = new Vector3();
      for (let k = 0; k < pos.length; k += 3) {
        v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(toPart); local.push(v.x, v.y, v.z);
        v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(toModel); model.push(v.x, v.y, v.z);
      }
      if (p.indices != null) for (const ix of accessorData(glb, p.indices)) indices.push(base + ix);
      else for (let k = 0; k < pos.length / 3; k++) indices.push(base + k);
    }
    for (const c of n.children ?? []) visit(c, toPart.clone().multiply(localMatrix(g.nodes[c])), toModel.clone().multiply(localMatrix(g.nodes[c])));
  };
  visit(i, new Matrix4(), world);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < local.length; k++) { min[k % 3] = Math.min(min[k % 3], local[k]); max[k % 3] = Math.max(max[k % 3], local[k]); }
  const size = max.map((v, k) => v - min[k]);
  if (PLATE.test(name) && Math.min(...size) > 0.004) { // bent plate: keep the real surface
    if (hood && hood.test(name)) { boxes.push(...wrapSegments(name, model)); return; }
    meshes.push(resurface(name, model));
    return;
  }
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  world.decompose(p, q, s);
  const c = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).applyMatrix4(world);
  boxes.push({ part: name, c: c.toArray().map(r5), h: size.map((v, k) => r5(Math.max(v * s.getComponent(k), 0.0015) / 2)), q: q.toArray().map((v) => Math.round(v * 1e6) / 1e6) });
});
writeFileSync(outPath, JSON.stringify({ source: 'official CAD via cadtools/make-collision.mjs', frame: '+X left, +Y up, +Z front, metres', boxes, meshes }));
console.log(`wrote ${outPath}: ${boxes.length} boxes, ${meshes.length} triangle meshes (${meshes.reduce((a, m) => a + m.triangles, 0)} triangles)`);
for (const m of meshes) console.log('  mesh', m.part, m.triangles);
console.log('  boxes', Object.entries(boxes.reduce((a, b) => { const k = b.part.split(/[ :]/)[0]; a[k] = (a[k] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k}x${v}`).join(' '));
console.log('  not used for collision:', Object.entries(skipped).map(([k, v]) => `${k}x${v}`).join(' '));
