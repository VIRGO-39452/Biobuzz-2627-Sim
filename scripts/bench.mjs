// Speed benchmark: simulated seconds per wall second in three situations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulator } from '../server/sim.mjs';
import { ROOT } from '../server/jdk.mjs';
const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
const time = (label, setup, secs = 4) => {
  const sim = new Simulator(robot); setup(sim);
  for (let i = 0; i < 300; i++) sim.step(0.001);
  const t0 = performance.now(); for (let i = 0; i < secs * 1000; i++) sim.step(0.001); const ms = performance.now() - t0;
  console.log(label.padEnd(44), `${(ms / secs / 1000 * 1000).toFixed(1)} us/step  ${(secs * 1000 / ms).toFixed(1)}x real time`);
  sim.dispose();
};
const drive = (sim) => { sim.setMotorCommand('left_drive', { power: 0.5 }); sim.setMotorCommand('right_drive', { power: -0.3 }); };
time('driving, empty field', drive);
time('driving, match staging', (sim) => { sim.stageElements('match'); drive(sim); });
time('idle, match staging', (sim) => { sim.stageElements('match'); });
time('4 balls in hopper, windmill + launcher', (sim) => { for (let i = 0; i < 4; i++) sim.spawnInHopper('pollen'); sim.setCRServo('windmill', -1); sim.setMotorCommand('launcher', { mode: 'RUN_USING_ENCODER', velTicks: 1250, pidf: [40, 0, 0, 12.5] }); sim.setMotorCommand('intake', { power: 1 }); });
