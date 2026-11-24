// Measures true outer radius and width of round parts from mesh vertices (bounding boxes overstate them).
import { Matrix4, Vector3 } from 'three';
import { readGlb, accessorData, walk, localMatrix } from './glb.mjs';
const glb = readGlb(process.argv[2]), g = glb.gltf;
const want = /^(3626-0014-0096|3624-0014-0096|3613-4008-0048|3613-0014-0072|3618-4008-0016|2302-0014-0100|2106-4008-2640)/;
const seen = new Set();
walk(g, (i, node, world, parent, depth) => {
  if (depth !== 1 || !want.test(node.name)) return;
  const sku = node.name.split(/[ :]/)[0]; if (seen.has(sku)) return; seen.add(sku);
  const pts = [];
  const visit = (ni, m) => { const n = g.nodes[ni]; if (n.mesh != null) for (const p of g.meshes[n.mesh].primitives) { const pos = accessorData(glb, p.attributes.POSITION), v = new Vector3(); for (let k = 0; k < pos.length; k += 3) { v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(m); pts.push(v.clone()); } } for (const c of n.children ?? []) visit(c, m.clone().multiply(localMatrix(g.nodes[c]))); };
  visit(i, world);
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) for (const k of ['x', 'y', 'z']) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  const ext = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z];
  const ax = sku === '3613-0014-0072' ? 'y' : 'x'; // axle direction
  const mid = { x: (hi.x + lo.x) / 2, y: (hi.y + lo.y) / 2, z: (hi.z + lo.z) / 2 };
  const radial = pts.map((p) => ax === 'x' ? Math.hypot(p.y - mid.y, p.z - mid.z) : Math.hypot(p.x - mid.x, p.z - mid.z)).sort((a, b) => a - b);
  console.log(node.name.padEnd(40), 'outer radius mm', (radial.at(-1) * 1000).toFixed(2), ' 99th pct', (radial[Math.floor(radial.length * 0.99)] * 1000).toFixed(2), ' width mm', (ext[ax === 'x' ? 0 : 1] * 1000).toFixed(1), ' axis centre', [mid.x, mid.y, mid.z].map((v) => (v * 1000).toFixed(1)).join(','));
});
