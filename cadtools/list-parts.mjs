import { readGlbJson, walk, subtree } from './glb.mjs';
import { Vector3 } from 'three';
const g = readGlbJson(process.argv[2]);
let total = 0;
const f = (v) => v.toArray().map((x) => (x * 1000).toFixed(2).padStart(8)).join('');
walk(g, (i, n, w, parent, depth) => {
  if (depth !== 1) return;
  const s = subtree(g, i, w); total += s.tris;
  console.log(n.name.padEnd(40), f(s.box.getCenter(new Vector3())), ' |', f(s.box.getSize(new Vector3())), String(Math.round(s.tris)).padStart(8));
});
console.log('total tris', total);
