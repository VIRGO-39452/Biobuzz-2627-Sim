// Rotating parts of the robot as a network of shafts joined by gear meshes, chains and gearboxes.
//
// Every shaft (a motor rotor, a gear on its shaft, an axle with its wheel, ...) has its own angle,
// speed and inertia. A coupling is a stiff spring across the play (backlash, chain slack) between two
// shafts: inside the play the shafts turn independently, at either end of it the teeth bear on each
// other. Meshes are far too stiff for explicit integration at 1 kHz, so each connected group of shafts
// is advanced with implicit Euler: a small linear solve per step that is stable for any stiffness.
//
// Coupling travel: x = ga * angleA + gb * angleB (metres at the pitch line for gears and chains,
// radians at the output for gearboxes). Force F = k * (x -/+ lash) when |x| > lash, else 0.
// Torque on A is -F * ga and on B is -F * gb.

export class ShaftNetwork {
  /**
   * shafts: [{ id, inertiaKgM2, viscousNmPerRadS?, frictionNm? }]
   * couplings: [{ id, a, b, ga, gb, stiffness, damping, lash, efficiency? }]
   */
  constructor(shafts, couplings) {
    const n = (this.n = shafts.length);
    this.ids = shafts.map((s) => s.id);
    this.index = new Map(this.ids.map((id, i) => [id, i]));
    this.angle = new Float64Array(n);
    this.omega = new Float64Array(n);
    this.J = Float64Array.from(shafts, (s) => s.inertiaKgM2);
    this.visc = Float64Array.from(shafts, (s) => s.viscousNmPerRadS ?? 0);
    this.fric = Float64Array.from(shafts, (s) => s.frictionNm ?? 0);
    // per-step inputs, cleared after every step
    this.torque = new Float64Array(n);  // constant torque over the step
    this.damp = new Float64Array(n);    // implicit term: torque = -damp * (omega' - ref)
    this.dampRef = new Float64Array(n); // sum of damp * ref
    this.couplings = couplings.map((c) => {
      const a = this.index.get(c.a), b = this.index.get(c.b);
      if (a == null || b == null) throw new Error(`coupling ${c.id}: unknown shaft ${a == null ? c.a : c.b}`);
      return { id: c.id, a, b, ga: c.ga, gb: c.gb, k: c.stiffness, c: c.damping, lash: c.lash, loss: 1 - (c.efficiency ?? 1), x0: 0, state: 0, force: 0 };
    });
    // connected groups, each solved on its own
    const group = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i) => { while (group[i] !== i) i = group[i] = group[group[i]]; return i; };
    for (const c of this.couplings) group[find(c.a)] = find(c.b);
    const byRoot = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); }
    this.groups = [...byRoot.values()].map((members) => {
      const local = new Map(members.map((g, l) => [g, l])), m = members.length;
      const cs = this.couplings.filter((c) => local.has(c.a)).map((c) => ({ c, la: local.get(c.a), lb: local.get(c.b) }));
      return { members, m, cs, A: new Float64Array(m * m), b: new Float64Array(m), w: new Float64Array(m) };
    });
    this.single = this.groups.filter((g) => g.m === 1).map((g) => g.members[0]);
    this.multi = this.groups.filter((g) => g.m > 1);
  }

  /** Bring every shaft to rest at angle zero with all play centred. */
  reset() {
    this.angle.fill(0); this.omega.fill(0);
    for (const c of this.couplings) { c.x0 = 0; c.state = 0; c.force = 0; }
  }

  /** Stop the shafts in one connected group (by any member id) without moving them. */
  stop(ids) { for (const id of ids) { const i = this.index.get(id); if (i != null) this.omega[i] = 0; } }

  addTorque(i, t) { this.torque[i] += t; }
  /** Implicit drag toward a reference speed: torque = -d * (omega' - ref). */
  addDamping(i, d, ref = 0) { this.damp[i] += d; this.dampRef[i] += d * ref; }

  step(dt) {
    const { J, visc, fric, torque, damp, dampRef, omega, angle } = this;
    // dry friction as an implicit drag that equals the friction torque once the shaft is moving
    const W0 = 0.2;
    for (const i of this.single) {
      const d = visc[i] + damp[i] + fric[i] / Math.max(Math.abs(omega[i]), W0);
      omega[i] = (J[i] * omega[i] + dt * (torque[i] + dampRef[i])) / (J[i] + dt * d);
    }
    for (const g of this.multi) {
      const { members, m, cs, A, b, w } = g;
      // which side of its play each coupling is on, predicted from the present motion
      for (const e of cs) {
        const c = e.c, x = c.ga * angle[c.a] + c.gb * angle[c.b] - c.x0, v = c.ga * omega[c.a] + c.gb * omega[c.b], xp = x + dt * v;
        e.x = x; c.state = xp > c.lash ? 1 : xp < -c.lash ? -1 : 0;
      }
      for (let pass = 0; pass < 3; pass++) {
        A.fill(0);
        for (let l = 0; l < m; l++) {
          const i = members[l];
          A[l * m + l] = J[i] + dt * (visc[i] + damp[i] + fric[i] / Math.max(Math.abs(omega[i]), W0));
          b[l] = J[i] * omega[i] + dt * (torque[i] + dampRef[i]);
        }
        for (const e of cs) {
          const c = e.c;
          if (c.loss > 0 && c.force !== 0) { // tooth and chain friction: a drag in proportion to the load carried last step
            const T = c.loss * Math.abs(c.force * c.gb), i = c.b;
            A[e.lb * m + e.lb] += (dt * T) / Math.max(Math.abs(omega[i]), W0);
          }
          if (!c.state) continue;
          const s = dt * dt * c.k + dt * c.c, r = dt * c.k * (e.x - c.state * c.lash);
          A[e.la * m + e.la] += s * c.ga * c.ga; A[e.lb * m + e.lb] += s * c.gb * c.gb;
          A[e.la * m + e.lb] += s * c.ga * c.gb; A[e.lb * m + e.la] += s * c.ga * c.gb;
          b[e.la] -= r * c.ga; b[e.lb] -= r * c.gb;
        }
        solve(A, b, w, m);
        // teeth can push but not pull, and shafts that cross their play this step must meet
        let changed = false;
        for (const e of cs) {
          const c = e.c, v = c.ga * w[e.la] + c.gb * w[e.lb], x1 = e.x + dt * v;
          if (c.state) {
            const F = c.k * (x1 - c.state * c.lash) + c.c * v;
            if (F * c.state < 0) { c.state = 0; c.force = 0; changed = true; } else c.force = F;
          } else {
            c.force = 0;
            if (x1 > c.lash) { c.state = 1; changed = true; } else if (x1 < -c.lash) { c.state = -1; changed = true; }
          }
        }
        if (!changed) break;
      }
      for (let l = 0; l < m; l++) omega[members[l]] = w[l];
    }
    for (let i = 0; i < this.n; i++) angle[i] += omega[i] * dt;
    torque.fill(0); damp.fill(0); dampRef.fill(0);
  }
}

/** Solve A w = b for a small symmetric positive-definite matrix (Gaussian elimination, in place). */
function solve(A, b, w, m) {
  for (let k = 0; k < m; k++) {
    const p = A[k * m + k];
    for (let r = k + 1; r < m; r++) {
      const f = A[r * m + k] / p;
      if (f === 0) continue;
      for (let c = k; c < m; c++) A[r * m + c] -= f * A[k * m + c];
      b[r] -= f * b[k];
    }
  }
  for (let k = m - 1; k >= 0; k--) {
    let s = b[k];
    for (let c = k + 1; c < m; c++) s -= A[k * m + c] * w[c];
    w[k] = s / A[k * m + k];
  }
}

/** Turn the assembly's physical coupling descriptions into travel coefficients, stiffness and play. */
export function buildNetwork(drivetrain) {
  const couplings = drivetrain.couplings.map((c) => {
    if (c.type === 'gear') { // external spur gears turn opposite ways
      const ra = (c.moduleMm * c.teethA) / 2000, rb = (c.moduleMm * c.teethB) / 2000;
      return { ...c, ga: ra, gb: rb, stiffness: c.stiffnessNPerM, damping: c.dampingNsPerM, lash: c.backlashM / 2 };
    }
    if (c.type === 'chain') { // sprockets on one chain turn the same way
      const r = (t) => c.pitchMm / 2000 / Math.sin(Math.PI / t);
      return { ...c, ga: r(c.teethA), gb: -r(c.teethB), stiffness: c.stiffnessNPerM, damping: c.dampingNsPerM, lash: c.slackM / 2 };
    }
    if (c.type === 'gearbox') // a = rotor, b = output shaft, same direction; travel in radians at the output
      return { ...c, ga: 1 / c.ratio, gb: -1, stiffness: c.stiffnessNmPerRad, damping: c.dampingNmsPerRad, lash: c.backlashRad / 2 };
    throw new Error(`unknown coupling type "${c.type}"`);
  });
  return new ShaftNetwork(drivetrain.shafts, couplings);
}
