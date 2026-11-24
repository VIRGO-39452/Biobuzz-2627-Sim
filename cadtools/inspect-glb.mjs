import { readGlbJson, walk, subtree } from './glb.mjs';
const g = readGlbJson(process.argv[2]);
console.log('nodes', g.nodes.length, 'meshes', g.meshes.length, 'materials', g.materials?.length, 'scenes', g.scenes.length, 'asset', JSON.stringify(g.asset));
let total = 0; const rows = [];
walk(g, (i, n, w, parent, depth) => {
  if (depth === 0) console.log('root', n.name, 'children', n.children?.length, 'matrix', !!n.matrix);
  if (depth === 1) { const s = subtree(g, i, w); total += s.tris; rows.push([n.name, s.tris, s.box]); }
});
console.log('top-level', rows.length, 'total tris', total);
const agg = {};
for (const [name, tris] of rows) { const k = name.replace(/_\d+$/, ''); agg[k] = agg[k] ?? [0, 0]; agg[k][0]++; agg[k][1] += tris; }
console.log(Object.entries(agg).sort((a, b) => b[1][1] - a[1][1]).slice(0, 25).map(([k, [c, t]]) => `${String(Math.round(t)).padStart(8)} x${c} ${k}`).join('\n'));
const f = (v) => v.toArray().map((x) => (x * 1000).toFixed(1).padStart(7)).join(' ');
const all = rows.reduce((b, r) => b.union(r[2]), rows[0][2].clone());
console.log('overall bbox mm min', f(all.min), 'max', f(all.max));
for (const [name, tris, box] of rows) if (/3626|3624|5203|5000|2000-0025|3613|3100|2106-4008-2|2302/.test(name)) {
  const c = box.getCenter(new (box.min.constructor)()), s = box.getSize(new (box.min.constructor)());
  console.log(name.padEnd(38), 'center', f(c), 'size', f(s));
}
