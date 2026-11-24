// 3D viewport: renders the converted official CAD and poses its moving parts from simulator state.
// Nothing here animates on its own: every wheel, gear, rotor and servo angle is the angle of a simulated shaft in
// the physics snapshot (carried forward at that shaft's own speed between snapshots, so fast parts turn smoothly).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createViewer(canvas, { assembly, robot, field, fieldInfo, onStatus }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1.5, 4, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 0.15;
  controls.maxDistance = 12;

  // ---- field: floor tiles and perimeter wall (generic 12 ft field; season elements are not modelled yet)
  const size = robot.field.sizeM;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(size, 6, 0x6b7280, 0x565c66);
  grid.position.y = 0.001;
  scene.add(grid);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.22, roughness: 0.4, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
  const wallH = field?.wallHeightM ?? 0.3, t = 0.02, placeholders = [grid];
  for (const [x, z, w, d] of [[0, size / 2 + t / 2, size + 2 * t, t], [0, -size / 2 - t / 2, size + 2 * t, t], [size / 2 + t / 2, 0, t, size], [-size / 2 - t / 2, 0, t, size]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    wall.position.set(x, wallH / 2, z);
    scene.add(wall); placeholders.push(wall);
  }

  // ---- field markings from the season configuration (zones are tape; unsimulated structures are floor outlines only)
  for (const z of field?.zones ?? []) {
    const w = z.max[0] - z.min[0], d = z.max[1] - z.min[1];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.55 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((z.min[0] + z.max[0]) / 2, 0.002, (z.min[1] + z.max[1]) / 2);
    scene.add(m); placeholders.push(m);
  }
  const outlineMat = new THREE.LineDashedMaterial({ color: 0xb0b8c4, dashSize: 0.04, gapSize: 0.03 });
  for (const st of field?.structures ?? []) {
    if (st.simulated || (!st.footprint && !st.position)) continue; // only unsimulated structures get a floor outline
    let pts;
    if (st.footprint) { const { center: [cx, cz], sizeX, sizeZ } = st.footprint; pts = [[cx - sizeX / 2, cz - sizeZ / 2], [cx + sizeX / 2, cz - sizeZ / 2], [cx + sizeX / 2, cz + sizeZ / 2], [cx - sizeX / 2, cz + sizeZ / 2], [cx - sizeX / 2, cz - sizeZ / 2]]; }
    else pts = Array.from({ length: 25 }, (_, i) => [st.position[0] + 0.07 * Math.cos((i / 24) * 2 * Math.PI), st.position[1] + 0.07 * Math.sin((i / 24) * 2 * Math.PI)]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.003, z))), outlineMat);
    line.computeLineDistances();
    scene.add(line);
  }

  // ---- official field CAD: tiles, perimeter, tape, FLOWERS, HIVE frame, and the two HIVES posed from physics
  const hivePivots = new Map();
  if (field?.model && fieldInfo) {
    new GLTFLoader().load(field.model, (gltf) => {
      const fieldRoot = new THREE.Group();
      fieldRoot.rotation.y = Math.PI; // CAD frame to simulator frame
      fieldRoot.add(gltf.scene);
      scene.add(fieldRoot);
      fieldRoot.updateMatrixWorld(true);
      const top = gltf.scene.children.length === 1 ? gltf.scene.children[0].children.slice() : gltf.scene.children.slice();
      for (const o of top) {
        const name = o.userData?.name ?? '';
        if (fieldInfo.elementNodes.includes(name)) { o.visible = false; continue; } // POLLEN and NECTAR are simulated bodies, drawn separately
        const hive = fieldInfo.hives.find((h) => h.node === name);
        if (hive) {
          const pivot = new THREE.Group();
          pivot.position.set(...hive.pivot);
          scene.add(pivot); pivot.updateMatrixWorld(true);
          pivot.attach(o);
          hivePivots.set(hive.id, { pivot, axis: new THREE.Vector3(...hive.axis) });
        }
      }
      gltf.scene.traverse((o) => { if (o.isMesh) { const m = o.material.clone(); m.metalness = 0.1; m.roughness = 0.7; o.material = m; } });
      for (const p of placeholders) p.visible = false;
      floor.visible = false; // still used for click picking
    }, undefined, (err) => onStatus?.(`Could not load the field model: ${err.message ?? err}`, info));
  }

  // ---- game elements: one sphere per simulated body, posed from the physics snapshot
  const elementMeshes = new Map();
  const elementAssets = new Map();
  const elementAsset = (type) => {
    if (elementAssets.has(type)) return elementAssets.get(type);
    const spec = field.elements[type];
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = spec.color; g.fillRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 29, 128, 6); g.fillRect(30, 0, 4, 64); g.fillRect(94, 0, 4, 64); // seams, so rolling is visible
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const asset = { geo: new THREE.SphereGeometry(spec.diameterM / 2, 28, 18), mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 }) };
    elementAssets.set(type, asset);
    return asset;
  };
  function syncElements(list) {
    const seen = new Set();
    for (const e of list ?? []) {
      seen.add(e.id);
      let m = elementMeshes.get(e.id);
      if (!m) { const a = elementAsset(e.type); m = new THREE.Mesh(a.geo, a.mat); m.userData.elementId = e.id; scene.add(m); elementMeshes.set(e.id, m); }
      m.position.set(...e.p); m.quaternion.set(...e.q);
    }
    for (const [id, m] of elementMeshes) if (!seen.has(id)) { scene.remove(m); elementMeshes.delete(id); }
  }
  const raycaster = new THREE.Raycaster();
  const ndc = (ev) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); };
  /** What is under the pointer: a game element id, and/or the point on the floor. */
  function pick(ev) {
    raycaster.setFromCamera(ndc(ev), camera);
    const hitEl = raycaster.intersectObjects([...elementMeshes.values()], false)[0];
    const hitFloor = raycaster.intersectObject(floor, false)[0];
    return { elementId: hitEl?.object.userData.elementId ?? null, floor: hitFloor ? { x: hitFloor.point.x, z: hitFloor.point.z } : null };
  }

  // ---- robot
  const robotRoot = new THREE.Group(); // origin: centre of the middle axle; +X left, +Y up, +Z front
  robotRoot.position.y = -assembly.measured.groundYM;
  scene.add(robotRoot);
  const movers = [];
  const byHardware = new Map();
  const info = { loaded: false, missing: [], parts: 0 };
  const highlightMat = new THREE.MeshStandardMaterial({ color: 0xf2b705, emissive: 0xf2b705, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.2 });

  new GLTFLoader().load(assembly.model.url, (gltf) => {
    robotRoot.add(gltf.scene);
    robotRoot.updateMatrixWorld(true);
    const parts = new Map();
    gltf.scene.traverse((o) => {
      const name = o.userData?.name;
      if (name && o.parent?.userData?.name === assembly.model.root && !parts.has(name)) parts.set(name, o);
    });
    info.parts = parts.size;
    // "part/sub/part" names a piece inside a bought-in assembly: a motor's output shaft, its rotor shaft, a servo's spline
    const find = (ref) => {
      if (!ref.includes('/')) return parts.get(ref);
      const [top, ...rest] = ref.split('/');
      let o = parts.get(top);
      for (const name of rest) { let hit = null; o?.traverse((c) => { if (!hit && c !== o && c.userData?.name === name) hit = c; }); o = hit; }
      return o;
    };
    // render-only surface finish (the CAD carries colours, not materials)
    const finished = new Map();
    const rules = assembly.appearance ?? { byColor: [], byPart: [] };
    const finish = (mat, part) => {
      const key = mat.uuid + '|' + (part?.match ?? '');
      if (finished.has(key)) return finished.get(key);
      const m = mat.clone();
      const { r, g, b } = m.color, lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
      const rule = part ?? rules.byColor.find((x) => x.when === (sat > 0.12 ? 'colored' : lum > 0.25 ? 'light' : 'dark'));
      if (rule) { m.metalness = rule.metalness; m.roughness = rule.roughness; }
      if (part?.color) m.color.setRGB(...part.color);
      if (part?.opacity != null) { m.transparent = true; m.opacity = part.opacity; m.depthWrite = false; }
      finished.set(key, m);
      return m;
    };
    for (const [name, obj] of parts) {
      const part = rules.byPart.find((x) => new RegExp(x.match).test(name));
      obj.traverse((o) => { if (o.isMesh) o.material = finish(o.material, part); });
    }
    const pivots = new Map(), staticChildren = [];
    for (const c of assembly.components) {
      const objs = [];
      for (const n of c.nodes) { const o = find(n); if (o) objs.push(o); else info.missing.push(`${c.id}: ${n}`); }
      const hw = c.drive?.hardware ?? c.hardware;
      if (hw) { if (!byHardware.has(hw)) byHardware.set(hw, []); byHardware.get(hw).push(...objs); }
      if (!c.movable) { if (c.parent && c.parent !== 'chassis') staticChildren.push([c.parent, objs]); continue; }
      const pivot = new THREE.Group();
      pivot.position.set(...c.joint.pivot);
      robotRoot.add(pivot);
      pivot.updateMatrixWorld(true);
      for (const o of objs) pivot.attach(o); // keeps each part exactly where the CAD put it
      pivots.set(c.id, pivot);
      movers.push({ id: c.id, parent: c.parent, pivot, axis: new THREE.Vector3(...c.joint.axis).normalize(), shaft: c.drive.shaft ?? null, joint: c.drive.joint ?? null, ratio: c.drive.ratio });
    }
    // parts that ride on another moving part (the Gecko shaft, gear and motor on the floating intake arm)
    for (const m of movers) if (m.parent && m.parent !== 'chassis' && pivots.has(m.parent)) pivots.get(m.parent).attach(m.pivot);
    for (const [parent, objs] of staticChildren) if (pivots.has(parent)) for (const o of objs) pivots.get(parent).attach(o);
    info.loaded = true;
    onStatus?.(info.missing.length ? `CAD loaded, but ${info.missing.length} configured part(s) were not found in the model` : null, info);
  }, (e) => onStatus?.(`Loading official CAD… ${e.total ? Math.round((e.loaded / e.total) * 100) + '%' : ''}`, info),
  (err) => onStatus?.(`Could not load CAD model: ${err.message ?? err}`, info));

  // ---- camera presets
  let follow = true;
  const lastRobot = new THREE.Vector3();
  const yaw = () => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(robotRoot.quaternion); return Math.atan2(f.x, f.z); };
  const rel = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw()).add(new THREE.Vector3(robotRoot.position.x, 0, robotRoot.position.z));
  function setView(name) {
    camera.up.set(0, 1, 0);
    const p = robotRoot.position;
    const look = new THREE.Vector3(p.x, 0.12, p.z);
    follow = true;
    if (name === 'orbit') camera.position.copy(rel(-0.55, 0.42, 0.7));
    else if (name === 'front') { camera.position.copy(rel(0, 0.22, 1.25)); }
    else if (name === 'side') { camera.position.copy(rel(1.25, 0.22, 0)); }
    else if (name === 'rear') { camera.position.copy(rel(0, 0.3, -1.25)); }
    else if (name === 'top') { follow = false; look.set(0, 0, 0); camera.position.set(0, 5.4, 0.0001); camera.up.set(0, 0, 1); }
    else if (name === 'driver') { follow = false; look.set(0, 0, 0); camera.position.set(0, 1.55, -size / 2 - 0.9); }
    else if (name === 'free') { follow = false; return; }
    controls.target.copy(look);
    controls.update();
  }

  let lastSnap = null, lastAt = 0;
  function update(snap) {
    if (snap) {
      if (snap !== lastSnap) { lastSnap = snap; lastAt = performance.now(); }
      const since = Math.min((performance.now() - lastAt) / 1000, 0.1); // seconds since this snapshot arrived
      syncElements(snap.elements);
      for (const h of snap.hives ?? []) { const hp = hivePivots.get(h.id); if (hp) hp.pivot.quaternion.setFromAxisAngle(hp.axis, h.angle); }
      // simulator frame: x forward, y left, heading counter-clockwise from above
      if (snap.pose3d) { // full rigid-body pose from the physics engine (model origin = centre of the middle axle)
        robotRoot.position.set(...snap.pose3d.p);
        robotRoot.quaternion.set(...snap.pose3d.q);
      } else {
        robotRoot.position.x = snap.pose.y;
        robotRoot.position.z = snap.pose.x;
        robotRoot.rotation.y = snap.pose.heading;
      }
      for (const m of movers) {
        const sh = m.shaft ? snap.shafts?.[m.shaft] : null; // [angle, speed] of the simulated shaft this part turns on
        const value = m.joint ? snap.joints?.[m.joint] ?? 0 : sh ? sh[0] + sh[1] * since : 0;
        m.pivot.quaternion.setFromAxisAngle(m.axis, value * m.ratio);
      }
    }
    if (follow) {
      const delta = new THREE.Vector3(robotRoot.position.x - lastRobot.x, 0, robotRoot.position.z - lastRobot.z);
      camera.position.add(delta);
      controls.target.add(delta);
    }
    lastRobot.copy(robotRoot.position);
    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }

  // ---- debug overlay: the simplified shapes physics actually uses (CAD pose; the intake arm overlay does not swing)
  let shapesGroup = null;
  async function showShapes(on) {
    if (!on) { if (shapesGroup) shapesGroup.visible = false; return; }
    if (!shapesGroup) {
      shapesGroup = new THREE.Group(); robotRoot.add(shapesGroup);
      const col = await (await fetch(assembly.collisionShapes)).json();
      const lm = (c) => new THREE.LineBasicMaterial({ color: c });
      for (const b of col.boxes) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2)), lm(0x00d0ff)); l.position.set(...b.c); l.quaternion.set(...b.q); shapesGroup.add(l); }
      for (const m of col.meshes) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3)); g.setIndex(m.indices); shapesGroup.add(new THREE.LineSegments(new THREE.WireframeGeometry(g), lm(0x39d353))); }
      for (const m of assembly.mechanisms ?? []) {
        if (m.kind === 'roller') { const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(m.radius, m.radius, m.width, 20)), lm(0xff5c5c)); l.position.set(...m.center); l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...m.axis)); shapesGroup.add(l); }
        else for (const b of m.blades) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2)), lm(0xff5c5c)); l.position.set(...b.center); shapesGroup.add(l); }
      }
    }
    shapesGroup.visible = true;
  }

  let highlighted = [], highlightedName = null;
  function highlight(hardware) {
    if (hardware === highlightedName) return;
    highlightedName = hardware;
    for (const [mesh, mat] of highlighted) mesh.material = mat;
    highlighted = [];
    for (const o of byHardware.get(hardware) ?? []) o.traverse((m) => { if (m.isMesh) { highlighted.push([m, m.material]); m.material = highlightMat; } });
  }

  lastRobot.copy(robotRoot.position);
  resize();
  setView('orbit');
  return { update, resize, setView, highlight, showShapes, info, movers, pick, elementCount: () => elementMeshes.size,
    /** Draw calls and triangles of the last frame. */
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }),
    /** For tests and debugging: current rotation angle (rad) of a moving component about its joint axis. */
    angleOf(id) { const m = movers.find((x) => x.id === id); if (!m) return null; const q = m.pivot.quaternion; return 2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(m.axis), q.w); } };
}
