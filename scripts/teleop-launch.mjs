// End-to-end launch through the real Java TeleOp: goBILDA's example code, right bumper held, POLLEN in the hopper.
// Usage: node scripts/teleop-launch.mjs [balls=2] [intakeFirst=0|1]
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../server/session.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = new Session({ workDir: mkdtempSync(join(tmpdir(), 'ftcsim-tl-')), robot, startPose: { x: -0.9, y: 0.9, heading: 0 } }); // open floor, facing the far wall
s.on('log', (e) => { if (e.stream === 'error') console.log('LOG', e.text); });
s.loadDir(join(ROOT, 'research/code/3200-2627-0003_example-code/Java'), 'example');
const c = await s.compile(); if (!c.ok) { console.log(c.diagnostics); process.exit(1); }
await s.init('org.firstinspires.ftc.teamcode.BioBuzzStarterbotTeleop'); await sleep(500);
const n = +(process.argv[2] ?? 2), sim = s.sim;
if (process.argv[3] === '1') { // pick balls up from the floor with the intake, like a driver would
  s.start(); await sleep(300);
  for (let i = 0; i < n; i++) { const p = sim.body.translation(), f = { x: Math.sin(sim.pose.heading), z: Math.cos(sim.pose.heading) }; sim.spawnElement(process.argv[4] ?? 'pollen', { x: p.x + f.x * (0.4 + 0.09 * i), z: p.z + f.z * (0.4 + 0.09 * i) }); }
  s.setGamepad(1, { ly: -0.35, rt: 1, buttons: {} }); await sleep(1400);
  s.setGamepad(1, { ly: 0, rt: 1, buttons: {} }); await sleep(1200);
  s.setGamepad(1, { buttons: {} }); await sleep(500);
} else { for (let i = 0; i < n; i++) { sim.spawnInHopper('pollen'); await sleep(500); } s.start(); await sleep(300); }
console.log('carried before launch:', sim.carried().length, 'devices', [...sim.devices.values()].map((d) => `${d.name}${d.resolved ? '' : '(unbound)'}`).join(' '));
s.setGamepad(1, { buttons: { right_bumper: true } });
const out = new Set(), seen = [];
for (let t = 0; t < 80; t++) {
  await sleep(100);
  const L = sim.devices.get('launcher'), W = sim.devices.get('windmill'), I = sim.devices.get('intake');
  const q = sim.body.rotation(), p = sim.body.translation();
  const rows = [...sim.elements.values()].map((e) => { const b = e.body.translation(), v = e.body.linvel(), dx = b.x - p.x, dz = b.z - p.z, h = sim.pose.heading; const lz = dx * Math.sin(h) + dz * Math.cos(h), lx = dx * Math.cos(h) - dz * Math.sin(h); if (b.y > 0.6 && !out.has(e.id)) { out.add(e.id); seen.push(`${e.id} launched at ${(t / 10).toFixed(1)} s`); } return `[x${(lx * 1000).toFixed(0)} y${((b.y - 0.048) * 1000).toFixed(0)} z${(lz * 1000).toFixed(0)} v${Math.hypot(v.x, v.y, v.z).toFixed(1)}]`; });
  if (t % 5 === 0) console.log(`t=${(t / 10).toFixed(1)} launcher tps ${(L.omega * 28 / 6.283).toFixed(0)} cmd ${L.cmd.mode} vel ${L.cmd.velTicks} | windmill power ${W.power} rpm ${(W.omega * 9.55).toFixed(0)} | intake power ${I.cmd.power.toFixed(2)} | balls ${rows.join(' ')} | mech ${sim.mechanisms.filter((m) => m.contacts).map((m) => m.id.replace('intake_', '')).join(',')}`);
}
console.log(seen.join('; ') || 'NOTHING LAUNCHED', '| still carried', sim.carried().length);
await s.dispose(); process.exit(0);
