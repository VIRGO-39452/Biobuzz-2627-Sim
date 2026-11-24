// Minimal GLB reader for analysis: JSON chunk, node world matrices and world-space bounding boxes.
import { openSync, readSync, closeSync } from 'node:fs';
import { Matrix4, Vector3, Quaternion, Box3 } from 'three';

export function readGlbJson(path) {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(20);
  readSync(fd, head, 0, 20, 0);
  if (head.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const len = head.readUInt32LE(12);
  const buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, 20);
  closeSync(fd);
  return JSON.parse(buf.toString('utf8'));
}

export function localMatrix(node) {
  const m = new Matrix4();
  if (node.matrix) return m.fromArray(node.matrix);
  return m.compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
}

/** Depth-first walk giving every node its world matrix. cb(nodeIndex, node, world, parentIndex, depth) */
export function walk(gltf, cb) {
  const visit = (i, parentWorld, parent, depth) => {
    const node = gltf.nodes[i];
    const world = parentWorld.clone().multiply(localMatrix(node));
    cb(i, node, world, parent, depth);
    for (const c of node.children ?? []) visit(c, world, i, depth + 1);
  };
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visit(r, new Matrix4(), -1, 0);
}

export function meshStats(gltf, meshIndex, world, box) {
  let tris = 0;
  for (const p of gltf.meshes[meshIndex].primitives) {
    const acc = gltf.accessors[p.attributes.POSITION];
    const [x0, y0, z0] = acc.min, [x1, y1, z1] = acc.max;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) box.expandByPoint(new Vector3(x, y, z).applyMatrix4(world));
    tris += (p.indices != null ? gltf.accessors[p.indices].count : acc.count) / 3;
  }
  return tris;
}

/** World bbox + triangle count of a node's whole subtree. */
export function subtree(gltf, index, world) {
  const box = new Box3();
  let tris = 0;
  const visit = (i, w) => {
    const n = gltf.nodes[i];
    if (n.mesh != null) tris += meshStats(gltf, n.mesh, w, box);
    for (const c of n.children ?? []) visit(c, w.clone().multiply(localMatrix(gltf.nodes[c])));
  };
  visit(index, world);
  return { box, tris };
}

/** Full GLB read (JSON + binary chunk) for tools that need vertex data. */
export function readGlb(path) {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(20);
  readSync(fd, head, 0, 20, 0);
  const jsonLen = head.readUInt32LE(12);
  const jb = Buffer.alloc(jsonLen);
  readSync(fd, jb, 0, jsonLen, 20);
  const bh = Buffer.alloc(8);
  readSync(fd, bh, 0, 8, 20 + jsonLen);
  const binLen = bh.readUInt32LE(0);
  const bin = Buffer.alloc(binLen);
  readSync(fd, bin, 0, binLen, 28 + jsonLen);
  closeSync(fd);
  return { gltf: JSON.parse(jb.toString('utf8')), bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
/** Accessor contents as a typed array (copies; handles byteStride). */
export function accessorData({ gltf, bin }, index) {
  const acc = gltf.accessors[index], view = gltf.bufferViews[acc.bufferView];
  const n = COMPONENTS[acc.type], Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[acc.componentType];
  const size = Type.BYTES_PER_ELEMENT, stride = view.byteStride ?? n * size, base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Type(acc.count * n), dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5126: (o) => dv.getFloat32(o, true), 5125: (o) => dv.getUint32(o, true), 5123: (o) => dv.getUint16(o, true), 5121: (o) => dv.getUint8(o) }[acc.componentType];
  for (let i = 0; i < acc.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get(base + i * stride + k * size);
  return out;
}
