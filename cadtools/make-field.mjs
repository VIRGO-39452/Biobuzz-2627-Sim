// Builds the simulator's field data from the official FIRST field CAD (converted to GLB, Y-up):
// static collision surfaces (HIVE frame, FLOWERS), the two tipping HIVES (shape, pivot, estimated
// mass), perimeter dimensions, and the staged positions of every POLLEN and NECTAR.
// Simulator world = CAD turned 180 degrees about the vertical: +X toward the red ALLIANCE AREA,
// +Z away from the audience, +Y up, origin at the field centre on the tile surface.
// Usage: node make-field.mjs field.glb out.json
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { readGlb, accessorData, walk, localMatrix } from './glb.mjs';

const [glbPath, outPath] = process.argv.slice(2); // pass the coarse collision GLB here
const glb = readGlb(glbPath), g = glb.gltf;
const r5 = (v) => Math.round(v * 1e5) / 1e5;

/** Triangles of a subtree in world coordinates, optionally keeping only leaf parts whose name passes `keep`. */
function gather(nodeIndex, world, keep = () => true) {
  const vertices = [], indices = [], leaves = [];
  const visit = (i, m, name) => {
    const n = g.nodes[i], nm = n.name ?? name;
    if (n.mesh != null && keep(nm)) {
      let vol = 0; const c = [0, 0, 0], first = vertices.length / 3;
      for (const p of g.meshes[n.mesh].primitives) {
        const pos = accessorData(glb, p.attributes.POSITION), base = vertices.length / 3, v = new Vector3();
        for (let k = 0; k < pos.length; k += 3) { v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(m); vertices.push(-v.x, v.y, -v.z); }
        const idx = p.indices != null ? accessorData(glb, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
        for (let k = 0; k < idx.length; k += 3) {
          const a = base + idx[k], b = base + idx[k + 1], d = base + idx[k + 2];
          indices.push(a, b, d);
          const A = vertices.slice(a * 3, a * 3 + 3), B = vertices.slice(b * 3, b * 3 + 3), C = vertices.slice(d * 3, d * 3 + 3);
          const t = (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
          vol += t; for (let q = 0; q < 3; q++) c[q] += (t * (A[q] + B[q] + C[q])) / 4;
        }
      }
      if (Math.abs(vol) > 1e-12) leaves.push({ name: nm, volumeM3: Math.abs(vol), centroid: c.map((x) => x / vol) });
      void first;
    }
    for (const ch of n.children ?? []) visit(ch, m.clone().multiply(localMatrix(g.nodes[ch])), nm);
  };
  visit(nodeIndex, world, g.nodes[nodeIndex].name);
  return { vertices: vertices.map(r5), indices, leaves };
}
const bounds = (v) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < v.length; i++) { if (v[i] < lo[i % 3]) lo[i % 3] = v[i]; if (v[i] > hi[i % 3]) hi[i % 3] = v[i]; } return { lo, hi, c: lo.map((x, i) => (x + hi[i]) / 2) }; };

// assumed densities for the HIVE mass estimate (kg/m^3)
const density = (name) => (/Churro|Tube|Bracket|Holder|Spacer|Bearing|screw|nut|Washer/i.test(name) ? 2700 : 1050);

const out = { source: 'FIRST Field CAD (STEP) v26-27.2, via cadtools/make-field.mjs', frame: '+X red ALLIANCE AREA, +Y up, +Z away from the audience; metres', statics: [], hives: [], elements: [], nodes: { elements: [], hives: {} } };
let tiles = null, perimeter = null, flowerN = 0;
walk(g, (i, n, world, parent, depth) => {
  if (depth !== 1) return;
  const name = n.name;
  if (/Soft Tiles/.test(name)) tiles = bounds(gather(i, world).vertices);
  else if (/Perimeter/.test(name)) perimeter = bounds(gather(i, world).vertices);
  else if (/^am-5854: Frame/.test(name)) {
    const m = gather(i, world, (nm) => /A-Frame|Foot Bar|Frame Foot|ACM Panel|Axle Holder/.test(nm));
    out.statics.push({ id: 'hive_frame', label: 'HIVE frame', triangles: m.indices.length / 3, vertices: m.vertices, indices: m.indices });
  } else if (/Flower Assembly/.test(name)) {
    const m = gather(i, world, (nm) => /Flower Layer|HIPS Pipe|Peanut Support|Backstop|Flower Field Bracket/.test(nm));
    const b = bounds(m.vertices), pipes = bounds(gather(i, world, (nm) => /HIPS Pipe/.test(nm)).vertices);
    out.statics.push({ id: `flower_${++flowerN}`, label: 'FLOWER', center: [r5(pipes.c[0]), r5(pipes.c[2])], topM: r5(b.hi[1]), triangles: m.indices.length / 3, vertices: m.vertices, indices: m.indices });
  } else if (/Hive </.test(name)) {
    const color = /Blue/.test(name) ? 'blue' : 'red';
    const shape = gather(i, world, (nm) => /Skin|Goal Rib|Base Tube|Churro/.test(nm));
    const all = gather(i, world);
    const pivotB = bounds(gather(i, world, (nm) => /Shielded Flanged Bearing/.test(nm)).vertices);
    const pivot = [r5(pivotB.c[0]), r5(pivotB.c[1]), r5(pivotB.c[2])];
    // the two CELLS: which one is up, and how far the HIVE is tipped from its balanced position
    const cells = [];
    for (const ch of n.children ?? []) if (/Cell/.test(g.nodes[ch].name)) {
      const b = bounds(gather(ch, world.clone().multiply(localMatrix(g.nodes[ch]))).vertices);
      cells.push({ name: g.nodes[ch].name, c: b.c });
    }
    let M = 0, I = 0; const com = [0, 0, 0];
    for (const l of all.leaves) { const m = l.volumeM3 * density(l.name); M += m; for (let q = 0; q < 3; q++) com[q] += m * l.centroid[q]; I += m * ((l.centroid[1] - pivot[1]) ** 2 + (l.centroid[2] - pivot[2]) ** 2); }
    for (let q = 0; q < 3; q++) com[q] /= M;
    // The HIVE balances like an upside-down pendulum: its centre of mass sits above the pivot and leans toward the lowered CELL.
    const lean = Math.atan2(com[2] - pivot[2], com[1] - pivot[1]);
    out.hives.push({ id: `hive_${color}`, label: `HIVE (${color})`, color, node: name, pivot, axis: [1, 0, 0],
      leanRad: r5(lean), swingRad: r5(-2 * lean), upCell: lean < 0 ? '+Z (far side)' : '-Z (audience side)',
      note: 'CAD pose is one of the two stable positions; the other is its mirror image. swingRad is the rotation about +X that takes it there.',
      massKg: r5(M), comM: com.map(r5), inertiaAboutPivotKgM2: r5(I),
      mass_source: 'estimate: CAD part volumes with assumed densities (plastic skins and ribs 1050 kg/m3, aluminium tubes and brackets 2700 kg/m3)',
      cells: cells.map((c) => ({ name: c.name.trim(), center: c.c.map(r5) })), triangles: shape.indices.length / 3, vertices: shape.vertices, indices: shape.indices });
    out.nodes.hives[`hive_${color}`] = name;
  } else if (/Pollen|Nectar/.test(name)) {
    const b = bounds(gather(i, world).vertices);
    out.elements.push({ type: /Pollen/.test(name) ? 'pollen' : /Red/.test(name) ? 'nectar_red' : 'nectar_blue', p: b.c.map(r5) });
    if (!out.nodes.elements.includes(name)) out.nodes.elements.push(name);
  }
});
const innerHalf = r5(tiles.hi[0]);
out.bounds = { innerHalfM: innerHalf, insideM: r5(innerHalf * 2), wallTopM: r5(perimeter.hi[1]), wallOuterHalfM: r5(perimeter.hi[0]), tileThicknessM: r5(-tiles.lo[1]),
  note: 'Inside dimension is the tile floor extent in the CAD; the manual quotes a nominal 144 in (3.6575 m).' };
// where each staged element sits
for (const e of out.elements) {
  const [x, y, z] = e.p;
  if (Math.abs(x) > innerHalf || Math.abs(z) > innerHalf) e.where = e.type === 'pollen' ? 'outside: robot pre-loads in the ALLIANCE AREA' : 'outside: NECTAR in the ALLIANCE AREA';
  else if (y > 0.6) e.where = 'hive cell';
  else { const f = out.statics.find((s) => s.center && Math.hypot(s.center[0] - x, s.center[1] - z) < 0.06); e.where = f ? f.id : Math.abs(z) > innerHalf - 0.1 ? (z < 0 ? 'garden_red' : 'garden_blue') : 'field'; }
}
out.elements.sort((a, b) => a.where.localeCompare(b.where) || a.p[1] - b.p[1] || a.p[0] - b.p[0]);
writeFileSync(outPath, JSON.stringify(out));
const count = {}; for (const e of out.elements) count[`${e.type} @ ${e.where}`] = (count[`${e.type} @ ${e.where}`] ?? 0) + 1;
console.log(`wrote ${outPath}`); console.log(JSON.stringify(out.bounds)); console.log(count);
for (const s of out.statics) console.log(' static', s.id, s.triangles, 'tris', s.center ? `at ${s.center.join(', ')} top ${s.topM}` : '');
for (const h of out.hives) console.log(' ', h.id, 'pivot', h.pivot.join(', '), 'lean deg', (h.leanRad * 180 / Math.PI).toFixed(1), 'swing deg', (h.swingRad * 180 / Math.PI).toFixed(1), 'up', h.upCell, 'mass', h.massKg, 'com', h.comM.join(', '), 'I', h.inertiaAboutPivotKgM2, h.triangles, 'tris');
