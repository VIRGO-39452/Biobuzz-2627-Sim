// Builds a trimmed Java runtime for the packaged app with jlink: just enough to run javac and the OpMode JVM.
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/jdk.mjs';

const full = [process.env.FTCSIM_JAVA_HOME, join(ROOT, 'jdk', 'Contents', 'Home'), join(ROOT, 'jdk')].filter(Boolean).find((d) => existsSync(join(d, 'bin', 'jlink')));
if (!full) throw new Error('A full JDK 17 is needed in ./jdk (or FTCSIM_JAVA_HOME) to build the packaged runtime.');
const out = join(ROOT, 'build', 'jre');
rmSync(out, { recursive: true, force: true });
execFileSync(join(full, 'bin', 'jlink'), ['--add-modules', 'java.base,java.logging,java.desktop,java.xml,java.sql,java.management,java.naming,jdk.compiler,jdk.unsupported,jdk.zipfs',
  '--strip-debug', '--no-man-pages', '--no-header-files', '--compress', '2', '--output', out], { stdio: 'inherit' });
const version = execFileSync(join(out, 'bin', 'java'), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
execFileSync(join(out, 'bin', 'javac'), ['-version'], { stdio: 'inherit' });
console.log('packaged runtime at', out, version);
