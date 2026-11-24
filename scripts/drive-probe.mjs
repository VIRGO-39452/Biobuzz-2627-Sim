// Drive probe: straight-line acceleration, top speed, coast-down, spin in place, and gear-train play.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
robot.field = { ...robot.field, sizeM: 40 };
const sim = new Simulator(robot);
const run = (s) => { for (let i = 0; i < s * 1000; i++) sim.step(0.001); };
const sh = (id) => sim.net.omega[sim.net.index.get(id)];
const rep = (l) => console.log(l.padEnd(26), `x ${sim.pose.x.toFixed(3)} y ${sim.pose.y.toFixed(3)} hdg ${(sim.pose.heading * 57.3).toFixed(1)}  v ${sim.vel.v.toFixed(3)} m/s  yaw ${sim.vel.omega.toFixed(2)} rad/s | rear ${sh('left_rear_axle').toFixed(2)} mid ${sh('left_middle_axle').toFixed(2)} front ${sh('left_front_axle').toFixed(2)} rotor/19.2 ${(sh('left_drive_rotor') / 19.2).toFixed(2)} | amps ${sim.battery.amps.toFixed(2)} tps ${(sim.devices.get('left_drive')?.omega * 537.7 / 6.283).toFixed(0)}`);
sim.setMotorCommand('left_drive', { power: 1 }); sim.setMotorCommand('right_drive', { power: -1 });
for (const t of [0.1, 0.2, 0.5, 1, 2]) { run(t - sim.time); rep(`full power t=${t}`); }
sim.setMotorCommand('left_drive', { power: 0 }); sim.setMotorCommand('right_drive', { power: 0 });
run(0.3); rep('brake 0.3 s'); run(1); rep('brake 1.3 s');
sim.setMotorCommand('left_drive', { power: 0.5 }); sim.setMotorCommand('right_drive', { power: 0.5 });
run(2); rep('spin 0.5');
sim.setMotorCommand('left_drive', { power: 0, zpb: 'FLOAT' }); sim.setMotorCommand('right_drive', { power: 0, zpb: 'FLOAT' });
run(2); rep('float 2 s');
const i = sim.net.index.get('left_rear_axle'), r = sim.net.index.get('left_drive_rotor');
console.log('at rest: max |shaft speed|', Math.max(...sim.net.omega.map(Math.abs)).toExponential(2), 'couplings', sim.net.couplings.map((c) => `${c.id}:${c.state}`).join(' '));
