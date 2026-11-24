import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Home of the JDK used to compile and run uploaded code: FTCSIM_JAVA_HOME, then ./jdk, then the packaged runtime. */
export function jdkHome() {
  const candidates = [
    process.env.FTCSIM_JAVA_HOME,
    join(ROOT, 'jdk', 'Contents', 'Home'),
    join(ROOT, 'jdk'),
    join(ROOT, 'build', 'jre'), // trimmed runtime shipped inside the packaged app (which has no ./jdk)
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, 'bin', 'javac')) || existsSync(join(c, 'bin', 'javac.exe'))) return c;
  }
  throw new Error('No JDK found. Put a JDK 17 in ./jdk or set FTCSIM_JAVA_HOME.');
}

export function jdkBin(tool) {
  return join(jdkHome(), 'bin', tool);
}
