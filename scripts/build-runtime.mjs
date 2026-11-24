// Compiles the FTC SDK-compatible simulation runtime into build/ftc-sim-runtime.jar
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jdkBin } from '../server/jdk.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'runtime', 'src');
const out = join(root, 'build', 'runtime-classes');
const jar = join(root, 'build', 'ftc-sim-runtime.jar');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.java')) acc.push(p);
  }
  return acc;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = walk(src);
execFileSync(jdkBin('javac'), ['--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-d', out, ...files], { stdio: 'inherit' });
execFileSync(jdkBin('jar'), ['cf', jar, '-C', out, '.'], { stdio: 'inherit' });
console.log(`built ${jar} from ${files.length} sources`);
