// Debug aid: cross-sections of the collision shapes (planes of constant X) as an SVG side view.
// Usage: node section.mjs collision.json part-volumes.json out.svg x1,x2,...
import { readFileSync, writeFileSync } from 'node:fs';
import { Vector3, Quaternion } from 'three';
const [colPath, volPath, outPath, xs] = process.argv.slice(2);
const col = JSON.parse(readFileSync(colPath, 'utf8')), vols = JSON.parse(readFileSync(volPath, 'utf8')).parts;
const tris = []; // [part, a, b, c]
for (const b of col.boxes) {
  const q = new Quaternion(...b.q), c = new Vector3(...b.c);
  const v = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(new Vector3(sx * b.h[0], sy * b.h[1], sz * b.h[2]).applyQuaternion(q).add(c));
  for (const [i, j, k] of [[0, 1, 3], [0, 3, 2], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 3, 7], [1, 7, 5]]) tris.push([b.part, v[i], v[j], v[k]]);
}
for (const m of col.meshes) for (let i = 0; i < m.indices.length; i += 3) {
  const p = (k) => new Vector3(m.vertices[m.indices[i + k] * 3], m.vertices[m.indices[i + k] * 3 + 1], m.vertices[m.indices[i + k] * 3 + 2]);
  tris.push([m.part, p(0), p(1), p(2)]);
}
const S = 1900, W = 560, H = 700; // px per metre
const X = (z) => (z + 0.215) * S + 20, Y = (y) => H - 30 - (y + 0.048) * S;
const panels = xs.split(',').map(Number).map((x0, pi) => {
  let out = `<g transform="translate(0,${pi * H})" clip-path="url(#clip)"><rect x="0" y="0" width="${W + 500}" height="${H}" fill="#fff" stroke="#999"/><text x="24" y="18" font-size="13">section at x = ${(x0 * 1000).toFixed(0)} mm (front of robot to the right; grid 50 mm)</text>`;
  for (let z = -0.2; z <= 0.3001; z += 0.05) out += `<line x1="${X(z)}" y1="24" x2="${X(z)}" y2="${H - 10}" stroke="#eee"/><text x="${X(z) - 8}" y="${H - 2}" font-size="8">${(z * 1000).toFixed(0)}</text>`;
  for (let y = -0.05; y <= 0.3; y += 0.05) out += `<line x1="10" y1="${Y(y)}" x2="${W + 480}" y2="${Y(y)}" stroke="#eee"/><text x="2" y="${Y(y)}" font-size="8">${(y * 1000).toFixed(0)}</text>`;
  out += `<line x1="0" y1="${Y(-0.048)}" x2="${W + 500}" y2="${Y(-0.048)}" stroke="#000" stroke-width="2"/>`;
  const colors = {};
  for (const [part, a, b, c] of tris) {
    const pts = [];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) if ((p.x - x0) * (q.x - x0) < 0) { const t = (x0 - p.x) / (q.x - p.x); pts.push([p.z + t * (q.z - p.z), p.y + t * (q.y - p.y)]); }
    if (pts.length === 2) { const hue = (colors[part] ??= (Object.keys(colors).length * 47) % 360); out += `<line x1="${X(pts[0][0])}" y1="${Y(pts[0][1])}" x2="${X(pts[1][0])}" y2="${Y(pts[1][1])}" stroke="hsl(${hue},70%,40%)" stroke-width="1.2"/>`; }
  }
  // round parts near this plane
  for (const p of vols) {
    const n = p.product ?? ''; const cx = (p.boxMin[0] + p.boxMax[0]) / 2, cy = (p.boxMin[1] + p.boxMax[1]) / 2, cz = (p.boxMin[2] + p.boxMax[2]) / 2;
    const r = { '3626-0014-0096': 0.048, '3624-0014-0096': 0.048, '3613-4008-0048': 0.024, '3618-4008-0016 (Stretched over 8 REX)': 0.0085, '2302-0014-0100': 0.05 }[n];
    if (r && (x0 >= p.boxMin[0] - 0.02 && x0 <= p.boxMax[0] + 0.02 || n.startsWith('3626') && Math.abs(cx) > 0.15 || n.startsWith('3624'))) out += `<circle cx="${X(cz)}" cy="${Y(cy)}" r="${r * S}" fill="none" stroke="${Math.abs(cx) > 0.15 ? '#bbb' : '#d00'}" stroke-width="1.5"/>`;
    if (n === '3613-0014-0072') out += `<rect x="${X(cz - 0.036)}" y="${Y(p.boxMax[1])}" width="${0.072 * S}" height="${(p.boxMax[1] - p.boxMin[1]) * S}" fill="none" stroke="#bbb"/>`;
  }
  out += `<circle cx="${X(0.31)}" cy="${Y(-0.048 + 0.0355)}" r="${0.0355 * S}" fill="#f2c80f88" stroke="#a80"/><text x="${X(0.29)}" y="${Y(0.04)}" font-size="9">POLLEN 71 mm</text>`;
  let ly = 40; for (const [part, hue] of Object.entries(colors)) { out += `<text x="${W + 300}" y="${ly}" font-size="9" fill="hsl(${hue},70%,35%)">${part.replace(/&/g, '')}</text>`; ly += 11; }
  return out + '</g>';
});
writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 500}" height="${H * panels.length}" font-family="sans-serif"><defs><clipPath id="clip"><rect x="0" y="0" width="${W + 500}" height="${H}"/></clipPath></defs>${panels.join('')}</svg>`);
console.log('wrote', outPath);
