// PoC project analyzer: catalogs every file and extracts OpMode / hardware facts from Java source.
// Source-level detection here is regex based (a real parser comes in Phase 4); the authoritative
// OpMode list comes from reflection over the compiled classes.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

const CATEGORY = {
  '.java': 'java', '.kt': 'kotlin', '.gradle': 'gradle', '.kts': 'gradle', '.xml': 'xml', '.json': 'json',
  '.properties': 'config', '.yml': 'config', '.yaml': 'config', '.toml': 'config', '.pro': 'config',
  '.step': 'cad', '.stp': 'cad', '.stl': 'cad', '.obj': 'cad', '.glb': 'cad', '.gltf': 'cad',
  '.jar': 'library', '.aar': 'library', '.so': 'library',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image',
  '.md': 'doc', '.txt': 'doc', '.pdf': 'doc', '.blk': 'blocks', '.tflite': 'asset',
};
const SKIP_DIRS = new Set(['.git', '.gradle', '.idea', 'build', 'node_modules', '__MACOSX']);

export function walkProject(root) {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); continue; }
      if (name === '.DS_Store') continue;
      files.push({ path: relative(root, p).split(sep).join('/'), size: st.size, category: CATEGORY[extname(name).toLowerCase()] ?? 'other' });
    }
  })(root);
  return files;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
function stripComments(src) { // keep length and newlines so offsets stay valid
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

export function analyzeJava(path, source) {
  const code = stripComments(source);
  const info = { path, package: null, imports: [], types: [], methods: [], uses: [], opmode: null, hardware: [], gamepadRefs: 0, telemetryCalls: 0 };
  info.package = /\bpackage\s+([\w.]+)\s*;/.exec(code)?.[1] ?? null;
  for (const m of code.matchAll(/\bimport\s+(static\s+)?([\w.*]+)\s*;/g)) info.imports.push(m[2]);
  for (const m of code.matchAll(/\b(public\s+)?(?:(?:abstract|final|static)\s+)*(class|interface|enum)\s+(\w+)(?:\s+extends\s+([\w.]+))?/g)) {
    info.types.push({ name: m[3], kind: m[2], isPublic: !!m[1], extends: m[4] ?? null, line: lineOf(code, m.index) });
  }
  const ann = /@(TeleOp|Autonomous)\b\s*(\(([^)]*)\))?/.exec(code);
  if (ann) {
    const args = ann[3] ?? '';
    const primary = info.types.find((t) => t.isPublic) ?? info.types[0];
    info.opmode = {
      flavor: ann[1],
      name: /name\s*=\s*"([^"]*)"/.exec(args)?.[1] ?? primary?.name ?? null,
      group: /group\s*=\s*"([^"]*)"/.exec(args)?.[1] ?? '',
      disabled: /@Disabled\b/.test(code),
      className: primary ? (info.package ? `${info.package}.${primary.name}` : primary.name) : null,
      base: primary?.extends ?? null,
      line: lineOf(code, ann.index),
    };
  }
  const typed = /hardwareMap\s*\.\s*get\s*\(\s*([\w.]+)\s*\.\s*class\s*,\s*"([^"]+)"\s*\)/g;
  for (const m of code.matchAll(typed)) info.hardware.push({ name: m[2], type: m[1].split('.').pop(), line: lineOf(code, m.index) });
  const mapped = /hardwareMap\s*\.\s*(dcMotor|servo|crservo)\s*\.\s*get\s*\(\s*"([^"]+)"\s*\)/g;
  const mapType = { dcMotor: 'DcMotor', servo: 'Servo', crservo: 'CRServo' };
  for (const m of code.matchAll(mapped)) info.hardware.push({ name: m[2], type: mapType[m[1]], line: lineOf(code, m.index) });
  for (const h of info.hardware) {
    const lineText = code.split('\n')[h.line - 1];
    h.variable = /([\w.]+)\s*=\s*hardwareMap/.exec(lineText)?.[1] ?? null;
  }
  // method declarations: optional modifiers, a return type without spaces, a name, a parameter list, then "{"
  for (const m of code.matchAll(/\b(?:(?:public|protected|private|static|final|abstract|synchronized)\s+)*[\w<>\[\],.?]+\s+(\w+)\s*\([^;{}()]*\)\s*(?:throws\s+[\w.,\s]+?)?\{/g)) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try', 'new', 'return'].includes(m[1]) && !/^\s*(?:new|return|else)\b/.test(m[0])) info.methods.push({ name: m[1], line: lineOf(code, m.index + m[0].lastIndexOf(m[1] + '(') >= m.index ? m.index + m[0].indexOf(m[1] + '(') : m.index) });
  }
  info.gamepadRefs = (code.match(/\bgamepad[12]\s*\./g) ?? []).length;
  info.telemetryCalls = (code.match(/\btelemetry\s*\.\s*\w+\s*\(/g) ?? []).length;
  return info;
}

const KIND_OF_TYPE = { DcMotor: 'motor', DcMotorEx: 'motor', DcMotorSimple: 'motor', CRServo: 'crservo', Servo: 'servo',
  IMU: 'imu', VoltageSensor: 'voltage', DistanceSensor: 'distance', Rev2mDistanceSensor: 'distance', TouchSensor: 'touch', RevTouchSensor: 'touch',
  ColorSensor: 'color', NormalizedColorSensor: 'color', ColorRangeSensor: 'color', RevColorSensorV3: 'color', DigitalChannel: 'digital', AnalogInput: 'analog' };
const SENSOR_KINDS = new Set(['imu', 'voltage', 'distance', 'touch', 'color', 'digital', 'analog']);

export function analyzeProject(root, robot, aliases = {}) {
  const files = walkProject(root);
  const java = [];
  for (const f of files) {
    if (f.category !== 'java') continue;
    java.push(analyzeJava(f.path, readFileSync(join(root, f.path), 'utf8')));
  }
  // dependency graph: which project classes each file refers to
  const owner = new Map();
  for (const j of java) for (const t of j.types) if (!owner.has(t.name)) owner.set(t.name, j.path);
  for (const j of java) {
    const code = stripComments(readFileSync(join(root, j.path), 'utf8')).replace(/"(?:[^"\\\n]|\\.)*"/g, '""'), mine = new Set(j.types.map((t) => t.name));
    for (const [name, path] of owner) if (!mine.has(name) && path !== j.path && new RegExp(`\\b${name}\\b`).test(code)) j.uses.push({ type: name, file: path });
  }
  const hardware = new Map();
  for (const j of java) {
    for (const h of j.hardware) {
      const kind = KIND_OF_TYPE[h.type] ?? null;
      const mapped = aliases[h.name] ?? h.name;
      const cfg = robot.devices[mapped];
      let status, component = null;
      if (!kind) status = 'unsupported type (not simulated yet)';
      else if (!cfg) status = SENSOR_KINDS.has(kind) ? 'unresolved: this sensor is not on the robot model (set its value by hand, or add it to the robot configuration)' : 'unresolved: no such device on the robot model';
      else if (cfg.kind !== kind) status = `type mismatch: robot model has a ${cfg.kind}`;
      else { status = 'connected'; component = cfg.label + (mapped !== h.name ? ` (mapped to ${mapped})` : ''); }
      const entry = hardware.get(h.name) ?? { name: h.name, types: [], kind, status, component, refs: [] };
      if (!entry.types.includes(h.type)) entry.types.push(h.type);
      entry.refs.push({ file: j.path, line: h.line, variable: h.variable });
      hardware.set(h.name, entry);
    }
  }
  return {
    files,
    java,
    opmodes: java.filter((j) => j.opmode).map((j) => ({ ...j.opmode, file: j.path, package: j.package, hardware: [...new Set(j.hardware.map((h) => h.name))] })),
    hardware: [...hardware.values()],
  };
}
