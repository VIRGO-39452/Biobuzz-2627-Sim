// Mass and rotational inertia of CAD solids about an axis-aligned axle, integrated over the mesh
// volume (signed tetrahedra) with assumed material densities. All results are estimates.
import { Vector3 } from 'three';
import { readGlb, accessorData, walk, localMatrix } from './glb.mjs';
import { partMassKg } from './materials.mjs';

const STEEL = 7850;

/** Returns measure(refs, pivot, axis): refs are top-level part names or "part/sub/part" paths. */
export function inertiaTool(glbPath) {
  const glb = readGlb(glbPath), g = glb.gltf, byPath = new Map(), stack = [];
  walk(g, (i, node, world, parent, depth) => { if (depth === 0) return; stack.length = depth - 1; stack.push(node.name); byPath.set(stack.join('/'), { i, world: world.clone() }); });
  return function measure(refs, pivot, axis) {
    const ax = axis[0] ? 0 : axis[1] ? 1 : 2, others = [0, 1, 2].filter((k) => k !== ax);
    let I = 0, M = 0; const detail = [];
    for (const ref of refs) {
      const hit = byPath.get(ref);
      if (!hit) throw new Error(`CAD part not found: ${ref}`);
      let vol = 0, second = 0;
      const visit = (ni, m) => {
        const n = g.nodes[ni];
        if (n.mesh != null) for (const p of g.meshes[n.mesh].primitives) {
          const pos = accessorData(glb, p.attributes.POSITION), idx = accessorData(glb, p.indices), P = [], v = new Vector3();
          for (let k = 0; k < pos.length; k += 3) { v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(m); P.push([v.x - pivot[0], v.y - pivot[1], v.z - pivot[2]]); }
          for (let k = 0; k < idx.length; k += 3) {
            const A = P[idx[k]], B = P[idx[k + 1]], C = P[idx[k + 2]];
            const V = (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
            const sq = (a) => A[a] * A[a] + B[a] * B[a] + C[a] * C[a] + A[a] * B[a] + A[a] * C[a] + B[a] * C[a];
            vol += V; second += (V / 10) * (sq(others[0]) + sq(others[1]));
          }
        }
        for (const c of n.children ?? []) visit(c, m.clone().multiply(localMatrix(g.nodes[c])));
      };
      visit(hit.i, hit.world);
      const sign = Math.sign(vol) || 1; vol *= sign; second *= sign;
      // sub-parts of bought-in assemblies (motor and servo output shafts) are steel; whole parts follow the material table
      const density = ref.includes('/') ? STEEL : (partMassKg(ref, vol)?.massKg ?? 0) / vol;
      I += density * second; M += density * vol;
      detail.push(`${ref.split('/').pop()}: ${(density * vol * 1000).toFixed(1)} g`);
    }
    return { inertiaKgM2: I, massKg: M, detail };
  };
}
