// One simulator session: an uploaded project, its compiled classes, the physics world and
// (while an OpMode is active) the sandboxed JVM that executes the team's real code.
import { EventEmitter } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, sep, basename } from 'node:path';
import AdmZip from 'adm-zip';
import { analyzeProject } from './analyzer.mjs';
import { Simulator } from './sim.mjs';
import { jdkBin, jdkHome, ROOT } from './jdk.mjs';

const execFileP = promisify(execFile);
const RUNTIME_JAR = join(ROOT, 'build', 'ftc-sim-runtime.jar');
const PHYSICS_DT = 0.001;
const BUTTONS = ['a', 'b', 'x', 'y', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'left_bumper', 'right_bumper',
  'left_stick_button', 'right_stick_button', 'back', 'start', 'guide'];
const emptyPad = () => ({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 0 });

function categorize(message, detail = '') {
  if (/cannot find symbol/.test(message) && /location: package (com\.qualcomm|org\.firstinspires\.ftc\.robotcore)/.test(detail)) return 'ftc-sdk-class-not-simulated';
  if (/package android[\w.]* does not exist/.test(message)) return 'unsupported-android-api';
  if (/package (com\.qualcomm|org\.firstinspires)[\w.]* does not exist/.test(message)) return 'ftc-sdk-class-not-simulated';
  if (/package [\w.]+ does not exist/.test(message)) return 'missing-dependency';
  if (/cannot find symbol/.test(message)) return 'unknown-symbol';
  if (/should be declared in a file named/.test(message)) return 'file-name';
  if (/expected|illegal start|unclosed|reached end of file|not a statement/.test(message)) return 'syntax';
  if (/incompatible types|cannot be applied|cannot be converted|might not have been initialized/.test(message)) return 'type';
  return 'other';
}

export class Session extends EventEmitter {
  constructor({ workDir, robot, startPose = null }) {
    super();
    this.workDir = resolve(workDir);
    this.projectId = null; // projects are kept under <workDir>/projects/<id>/ and survive restarts
    this.robot = robot;
    this.sim = new Simulator(robot);
    const st = this.sim.fieldShapes ? this.sim.field.robotStart : null; // the app starts the robot clear of the HIVE; bare simulators start at the origin
    if (startPose) this.sim.resetPose(startPose);
    else if (st) this.sim.resetPose({ x: st.x, y: st.y, heading: (st.headingDeg * Math.PI) / 180 });
    this.project = null;
    this.compileResult = null;
    this.opmode = { state: 'idle', className: null, error: null, startedAt: null, sandbox: null };
    this.pads = [emptyPad(), emptyPad()];
    this.proc = null;
    mkdirSync(this.workDir, { recursive: true });
    mkdirSync(join(this.workDir, 'projects'), { recursive: true });
    const last = this.#readJson(join(this.workDir, 'state.json'), {}).currentProject;
    if (last && existsSync(join(this.workDir, 'projects', last, 'project.json'))) { this.projectId = last; this.analyze(); } // reopen the last project
    this.lastWall = performance.now();
    this.acc = 0;
    this.tick = 0;
    this.timer = setInterval(() => this.#loop(), 4);
  }

  // ------------------------------------------------------------------ project
  loadZip(buffer, name = 'project.zip') {
    const zip = new AdmZip(buffer);
    this.#replaceProject(() => {
      for (const e of zip.getEntries()) {
        const target = resolve(this.projectDir, e.entryName);
        if (target !== this.projectDir && !target.startsWith(this.projectDir + sep)) {
          throw new Error(`Archive entry escapes the project folder: ${e.entryName}`);
        }
        if (e.isDirectory) { mkdirSync(target, { recursive: true }); continue; }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, e.getData());
      }
    }, name);
    return this.project;
  }

  loadDir(dir, name = basename(dir)) {
    this.#replaceProject(() => cpSync(dir, this.projectDir, { recursive: true }), name);
    return this.project;
  }

  get projectRoot() { if (!this.projectId) throw new Error('No project is open.'); return join(this.workDir, 'projects', this.projectId); }
  get projectDir() { return join(this.projectRoot, 'project'); }
  get stageDir() { return join(this.projectRoot, 'stage'); }
  get classesDir() { return join(this.projectRoot, 'classes'); }
  #readJson(file, fallback) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } }
  #meta() { return this.#readJson(join(this.projectRoot, 'project.json'), { id: this.projectId, name: this.projectId, settings: {} }); }
  #saveMeta(meta) { writeFileSync(join(this.projectRoot, 'project.json'), JSON.stringify(meta, null, 2)); }
  #remember() { writeFileSync(join(this.workDir, 'state.json'), JSON.stringify({ currentProject: this.projectId })); this.emit('projects', this.listProjects()); }

  /** Every project saved on this machine, newest first. */
  listProjects() {
    const dir = join(this.workDir, 'projects');
    return readdirSync(dir).map((id) => this.#readJson(join(dir, id, 'project.json'), null)).filter(Boolean)
      .map((m) => ({ id: m.id, name: m.name, loadedAt: m.loadedAt, current: m.id === this.projectId })).sort((a, b) => (a.loadedAt < b.loadedAt ? 1 : -1));
  }

  /** Each upload becomes its own saved project. */
  #replaceProject(fill, name) {
    if (this.proc) throw new Error('Stop the running OpMode before loading another project.');
    const slug = name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
    this.projectId = `${slug}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    mkdirSync(this.projectDir, { recursive: true });
    try { fill(); } catch (e) { rmSync(this.projectRoot, { recursive: true, force: true }); this.projectId = null; throw e; }
    this.#saveMeta({ id: this.projectId, name: name.replace(/\.zip$/i, ''), loadedAt: new Date().toISOString(), settings: { hardwareAliases: {} } });
    this.compileResult = null;
    this.analyze();
    this.#remember();
  }

  openProject(id) {
    if (this.proc) throw new Error('Stop the running OpMode before switching projects.');
    if (!existsSync(join(this.workDir, 'projects', id, 'project.json'))) throw new Error(`No saved project "${id}".`);
    this.projectId = id;
    this.compileResult = null;
    this.analyze();
    this.#remember();
    return this.project;
  }

  removeProject(id = this.projectId) {
    if (this.proc) throw new Error('Stop the running OpMode first.');
    if (!id) return;
    const root = resolve(this.workDir, 'projects', id);
    if (!root.startsWith(join(this.workDir, 'projects') + sep)) throw new Error('Bad project id.');
    rmSync(root, { recursive: true, force: true });
    if (id === this.projectId) { this.projectId = null; this.project = null; this.compileResult = null; this.emit('project', null); }
    this.#remember();
  }

  analyze() {
    const meta = this.#meta();
    this.project = { ...meta, ...analyzeProject(this.projectDir, this.robot, meta.settings?.hardwareAliases ?? {}) };
    this.emit('project', this.project);
    return this.project;
  }

  /** Per-project settings (kept with the project): manual hardware mapping, last selected OpMode. */
  saveProjectSettings(patch) {
    const meta = this.#meta();
    meta.settings = { ...meta.settings, ...patch };
    this.#saveMeta(meta);
    this.analyze();
  }

  /** Map a hardware name used in the code onto a device of the robot model (or clear the mapping with null). */
  setHardwareAlias(codeName, robotDevice) {
    if (robotDevice && !this.robot.devices[robotDevice]) throw new Error(`The robot model has no device "${robotDevice}".`);
    const aliases = { ...(this.#meta().settings?.hardwareAliases ?? {}) };
    if (robotDevice) aliases[codeName] = robotDevice; else delete aliases[codeName];
    this.saveProjectSettings({ hardwareAliases: aliases });
  }

  /** App-wide settings (control mappings, view preferences), stored beside the projects. */
  getSettings() { return this.#readJson(join(this.workDir, 'settings.json'), {}); }
  saveSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    writeFileSync(join(this.workDir, 'settings.json'), JSON.stringify(next, null, 2));
    return next;
  }

  #safePath(rel) {
    const p = resolve(this.projectDir, rel);
    if (!p.startsWith(this.projectDir + sep)) throw new Error('Path is outside the project.');
    return p;
  }

  readFile(rel) { return readFileSync(this.#safePath(rel), 'utf8'); }

  saveFile(rel, text) {
    writeFileSync(this.#safePath(rel), text);
    this.analyze();
  }

  // ------------------------------------------------------------------ compile
  /** Which Java sources belong to the team's code (the SDK's own app module is never compiled). */
  #sources() {
    const all = this.project.java.map((j) => j.path).filter((p) => !/(^|\/)(FtcRobotController|build)\//.test(p));
    const inTeamCode = all.filter((p) => /(^|\/)TeamCode\/src\/main\/java\//.test(p));
    return inTeamCode.length ? inTeamCode : all;
  }

  async compile() {
    if (!this.project) throw new Error('No project loaded.');
    if (this.proc) await this.stop();
    const started = performance.now();
    this.analyze();
    rmSync(this.stageDir, { recursive: true, force: true });
    rmSync(this.classesDir, { recursive: true, force: true });
    mkdirSync(this.stageDir, { recursive: true });
    mkdirSync(this.classesDir, { recursive: true });

    const diagnostics = [];
    const stagedToOriginal = new Map();
    const sources = this.#sources();
    const args = [];
    for (const rel of sources) {
      const info = this.project.java.find((j) => j.path === rel);
      const fileBase = basename(rel, '.java');
      const pub = info.types.find((t) => t.isPublic && t.line && info.types.indexOf(t) >= 0 && t.name.toLowerCase() === fileBase.toLowerCase());
      let staged = rel;
      if (pub && pub.name !== fileBase) {
        staged = rel.slice(0, rel.length - basename(rel).length) + pub.name + '.java';
        diagnostics.push({ file: rel, line: pub.line, severity: 'warning', category: 'file-name',
          message: `public class ${pub.name} is declared in ${basename(rel)}; Java requires the file to be named ${pub.name}.java. ` +
            'The simulator compiled it under the correct name, but Android Studio will reject this file until it is renamed.' });
      }
      stagedToOriginal.set(staged, rel);
      const target = join(this.stageDir, staged);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(this.projectDir, rel), target);
      args.push(`"${staged.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    writeFileSync(join(this.projectRoot, 'sources.txt'), args.join('\n'));

    let ok = false, raw = '';
    if (sources.length === 0) {
      diagnostics.push({ file: null, line: null, severity: 'error', category: 'no-sources', message: 'The project contains no Java source files to compile.' });
    } else {
      try {
        const r = await execFileP(jdkBin('javac'), ['--release', '8', '-Xlint:-options', '-proc:none', '-encoding', 'UTF-8', '-Xmaxerrs', '200',
          '-cp', RUNTIME_JAR, '-d', this.classesDir, '@' + join(this.projectRoot, 'sources.txt')], { cwd: this.stageDir, maxBuffer: 16 << 20 });
        raw = r.stderr; ok = true;
      } catch (e) {
        if (e.stderr === undefined) throw e;
        raw = e.stderr;
      }
      let current = null;
      for (const line of raw.split('\n')) {
        const m = /^(.+?\.java):(\d+): (error|warning): (.*)$/.exec(line);
        if (m) {
          current = { file: stagedToOriginal.get(m[1].split(sep).join('/')) ?? m[1], line: Number(m[2]), severity: m[3], message: m[4], category: categorize(m[4]), detail: '' };
          diagnostics.push(current);
        } else if (current && line.trim() && !/^\d+ (error|warning)s?$/.test(line.trim()) && !/^Note: /.test(line)) {
          current.detail += (current.detail ? '\n' : '') + line;
          if (/^\s+symbol:/.test(line) || /^\s+location:/.test(line)) current.message += ' — ' + line.trim();
        }
      }
    }

    for (const d of diagnostics) if (d.detail) d.category = categorize(d.message, d.detail);
    let opmodes = [], loadErrors = [];
    if (ok) {
      const r = await execFileP(jdkBin('java'), ['-cp', RUNTIME_JAR, 'ftcsim.runtime.Main', '--list', this.classesDir], { maxBuffer: 16 << 20 });
      const msg = r.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.t === 'opmodes');
      loadErrors = msg?.loadErrors ?? [];
      opmodes = (msg?.list ?? []).map((o) => {
        const src = this.project.opmodes.find((s) => s.className === o.class);
        const hardware = this.project.hardware.filter((h) => src?.hardware.includes(h.name));
        const blockers = hardware.filter((h) => h.status.startsWith('unsupported')).map((h) => `${h.name}: ${h.status}`);
        const warnings = hardware.filter((h) => h.status !== 'connected' && !h.status.startsWith('unsupported')).map((h) => `${h.name}: ${h.status}`);
        if (o.problem) blockers.push(o.problem);
        return { ...o, file: src?.file ?? null, line: src?.line ?? null, package: o.class.includes('.') ? o.class.slice(0, o.class.lastIndexOf('.')) : '',
          hardware: src?.hardware ?? [], supported: blockers.length === 0, blockers, warnings };
      });
    }
    this.compileResult = { ok, diagnostics, opmodes, loadErrors, sources, raw, ms: Math.round(performance.now() - started),
      javac: 'javac --release 8, bundled JDK' };
    this.emit('compile', this.compileResult);
    return this.compileResult;
  }

  // ------------------------------------------------------------------ run
  #sandboxArgs() {
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec') || process.env.FTCSIM_NO_SANDBOX) return null;
    const q = (p) => JSON.stringify(realpathSync(p));
    const profile = [
      '(version 1)', '(allow default)',
      '(deny network*)',
      '(deny file-write*)',
      '(allow file-write* (literal "/dev/null") (literal "/dev/dtracehelper"))',
      `(deny file-read-data (subpath ${q(process.env.HOME ?? '/Users')}))`,
      `(allow file-read-data (subpath ${q(jdkHome())}) (subpath ${q(this.classesDir)}) (literal ${q(RUNTIME_JAR)}))`,
    ].join('\n');
    const file = join(this.projectRoot, 'opmode.sb');
    writeFileSync(file, profile);
    return ['/usr/bin/sandbox-exec', '-f', file];
  }

  #setState(patch) {
    this.opmode = { ...this.opmode, ...patch };
    this.emit('opmode', this.opmode);
  }

  hardwareBindings() {
    return [...this.sim.devices.values()].map((d) => ({ name: d.name, kind: d.kind, resolved: d.resolved, component: d.label, mismatch: d.mismatch ?? null, mappedTo: d.device }));
  }

  async init(className) {
    if (!this.compileResult?.ok) throw new Error('Compile the project successfully before INIT.');
    const meta = this.compileResult.opmodes.find((o) => o.class === className);
    if (!meta) throw new Error(`No OpMode class ${className} in the compiled project.`);
    if (this.proc) await this.stop();
    this.sim.clearDevices();
    this.sim.aliases = this.project.settings?.hardwareAliases ?? {};
    this.sim.stopMotion();
    this.emit('telemetry', []);

    const specs = [];
    const names = [...Object.keys(this.robot.devices).map((n) => [n, n]), ...Object.entries(this.sim.aliases)]; // [name in code, device on the robot]
    for (const [name, device] of names) {
      const cfg = this.robot.devices[device];
      if (cfg?.kind !== 'motor') continue;
      const m = this.robot.motorModels[cfg.model];
      specs.push(`${name}\t${m.ticksPerRev}\t${(m.freeRpm / 60) * m.ticksPerRev}`);
    }
    const dm = this.robot.motorModels[this.robot.unresolvedDefaults.motorModel];
    specs.push(`*\t${dm.ticksPerRev}\t${(dm.freeRpm / 60) * dm.ticksPerRev}`);
    const specFile = join(this.classesDir, 'ftcsim-motors.tsv');
    writeFileSync(specFile, specs.join('\n') + '\n');
    const java = [jdkBin('java'), '-XX:-UsePerfData', '-Xmx256m', '-Xshare:auto', '-cp', RUNTIME_JAR, 'ftcsim.runtime.Main', this.classesDir, className, specFile];
    const sandbox = this.#sandboxArgs();
    const cmd = sandbox ? [...sandbox, ...java] : java;
    const proc = spawn(cmd[0], cmd.slice(1), { cwd: this.classesDir, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    this.proc = proc;
    proc.final = null;
    this.#setState({ state: 'starting', className, name: meta.name, error: null, startedAt: null, endedAt: null,
      sandbox: sandbox ? 'separate JVM process + macOS sandbox (no network, no file writes, no reads of your home folder)' : 'separate JVM process only (no OS sandbox on this platform)' });

    createInterface({ input: proc.stdout }).on('line', (line) => this.#onMessage(proc, line));
    createInterface({ input: proc.stderr }).on('line', (text) => this.emit('log', { stream: 'jvm', text }));
    proc.stdin.on('error', () => {});
    proc.exited = new Promise((res) => proc.on('exit', (code, signal) => {
      if (this.proc === proc) this.proc = null;
      this.sim.zeroAll();
      const forced = signal === 'SIGKILL' || code === 3;
      let state = proc.final?.state ?? (forced ? 'killed' : code === 0 ? 'stopped' : 'error');
      if (state === 'stuck') state = 'killed';
      const error = proc.final?.error ?? (state === 'error' ? `OpMode JVM exited unexpectedly (code ${code}, signal ${signal})` : null);
      if (forced && !proc.final) this.emit('log', { stream: 'sim', text: 'OpMode JVM was force-terminated.' });
      this.#setState({ state, error, endedAt: Date.now(), forced });
      res({ state, error, forced, code, signal });
    }));
    proc.on('error', (e) => this.emit('log', { stream: 'sim', text: `Failed to start JVM: ${e.message}` }));
    // wait until the OpMode reports init (or dies)
    await new Promise((res) => {
      const done = () => { this.off('opmode', check); res(); };
      const check = (o) => { if (o.state !== 'starting') done(); };
      this.on('opmode', check);
    });
    return this.opmode;
  }

  #onMessage(proc, line) {
    let m;
    try { m = JSON.parse(line); } catch { this.emit('log', { stream: 'jvm', text: line }); return; }
    switch (m.t) {
      case 'hw': this.sim.ensureDevice(m.name, m.kind); this.emit('hardware', this.hardwareBindings());
        { const dev = this.sim.devices.get(m.name); if (!dev.resolved) this.emit('log', { stream: 'warning', text: dev.sensor
          ? `Sensor "${m.name}" (${m.requested}) is not on the robot model. It reads a fixed default until you map it to a robot device or set its value by hand in the Hardware panel.`
          : `Hardware "${m.name}" (${m.requested}) is not on the robot model. It runs as a detached device; map it to a robot device in the Hardware panel.` }); }
        break;
      case 'motor': this.sim.setMotorCommand(m.name, { mode: m.mode, power: m.power, velTicks: m.velTicks, targetPos: m.targetPos, zpb: m.zpb, pidf: m.pidf, posP: m.posP, dir: m.dir }); break;
      case 'crservo': this.sim.setCRServo(m.name, m.power); break;
      case 'imu': if (m.resetYaw) this.sim.resetImuYaw(m.name); break;
      case 'digital': { const d = this.sim.devices.get(m.name); if (d) d.output = m.state ? 1 : 0; break; }
      case 'servo': this.sim.setServo(m.name, m.pos); break;
      case 'telemetry': this.emit('telemetry', m.lines); break;
      case 'log': this.emit('log', { stream: m.stream, text: m.text }); break;
      case 'unsupported': this.emit('log', { stream: 'error', text: `Unsupported hardware type ${m.cls} requested for "${m.name}".` }); break;
      case 'state':
        if (m.state === 'init') this.#setState({ state: 'init' });
        else if (m.state === 'running') this.#setState({ state: 'running', startedAt: Date.now() });
        else { proc.final = { state: m.state, error: m.error };
          if (m.error) this.emit('log', { stream: 'error', text: m.error }); }
        break;
      default: this.emit('log', { stream: 'jvm', text: line });
    }
  }

  start() {
    if (!this.proc || this.opmode.state !== 'init') throw new Error('Press INIT before PLAY.');
    this.#pushState(this.proc, true);
    this.proc.stdin.write('START\n');
  }

  /** Ask the OpMode to stop; force-kill the JVM if it has not exited shortly after. Always resolves. */
  async stop() {
    const proc = this.proc;
    if (!proc) return { state: this.opmode.state, forced: false, ms: 0 };
    const t0 = performance.now();
    try { proc.stdin.write('STOP\n'); } catch { /* already gone */ }
    const killer = setTimeout(() => proc.kill('SIGKILL'), 1500);
    const result = await proc.exited;
    clearTimeout(killer);
    return { ...result, ms: Math.round(performance.now() - t0) };
  }

  async reset() {
    await this.stop();
    this.sim.clearDevices();
    this.sim.resetPose();
    this.sim.resetElements();
    this.#setState({ state: 'idle', className: null, error: null, startedAt: null, endedAt: null });
    this.emit('telemetry', []);
    this.emit('hardware', []);
  }

  /** Game element commands from the UI. */
  elements(m) {
    const sim = this.sim;
    switch (m.action) {
      case 'stage': return sim.stageElements(m.preset ?? 'match');
      case 'clear': return sim.clearElements();
      case 'reset': return sim.resetElements();
      case 'remove': return sim.removeElement(m.id);
      case 'spawn': return sim.spawnElement(m.elementType, { x: Number(m.x), z: Number(m.z), y: m.drop ? 0.3 : null });
      default: throw new Error(`Unknown element action "${m.action}"`);
    }
  }

  /** Hand-set a sensor reading from the dashboard (null clears it). */
  setSensor(name, values) { this.sim.setSensorManual(name, values); }

  setGamepad(id, s) {
    let buttons = 0;
    BUTTONS.forEach((b, i) => { if (s.buttons?.[b]) buttons |= 1 << i; });
    const c = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
    this.pads[id === 2 ? 1 : 0] = { lx: c(s.lx), ly: c(s.ly), rx: c(s.rx), ry: c(s.ry), lt: Math.max(0, c(s.lt)), rt: Math.max(0, c(s.rt)), buttons };
    if (this.proc) this.#pushPads(this.proc);
  }

  #pushPads(proc) {
    let out = '';
    this.pads.forEach((p, i) => { out += `GP ${i + 1} ${p.lx} ${p.ly} ${p.rx} ${p.ry} ${p.lt} ${p.rt} ${p.buttons}\n`; });
    proc.stdin.write(out);
  }

  #pushState(proc, withPads) {
    if (!proc.stdin.writable) return;
    let out = `V ${this.sim.battery.volts.toFixed(3)}\n`;
    for (const [name, pos, vel, cur] of this.sim.motorReadings()) out += `M ${pos.toFixed(2)} ${vel.toFixed(2)} ${cur.toFixed(3)} ${name}\n`;
    for (const [name, values] of this.sim.sensorReadings()) out += `S ${values.length} ${values.map((v) => v.toFixed(5)).join(' ')} ${name}\n`;
    proc.stdin.write(out);
    if (withPads) this.#pushPads(proc);
  }

  #launchFaultText(fault) {
    const d = [...this.sim.devices.values()].find((x) => x.role === 'flywheel');
    const tps = d ? Math.round(d.omega * d.k.ticksPerRad) : 0;
    if (!d) {
      const motors = [...this.sim.devices.values()].filter((x) => x.kind === 'motor' && !x.resolved).map((x) => `"${x.name}"`);
      return `A ball reached the launcher, but no motor in the running OpMode is connected to the launcher flywheel, so it is not turning. ${motors.length ? `Not yet mapped: ${motors.join(', ')}. ` : ''}In the Hardware panel set the launcher motor's "robot device" to launcher, then STOP and INIT.`;
    }
    if (fault.kind === 'reversed') return `A ball reached the launcher, but the flywheel ("${d.name}") is spinning backwards (${tps} ticks/s), which pushes the ball back toward the intake. On the StarterBot a positive power or velocity throws the ball; check for setDirection(REVERSE) or a negative power/velocity on this motor.`;
    if (fault.kind === 'stopped') return `A ball reached the launcher, but the flywheel ("${d.name}") is not spinning (${tps} ticks/s), so the ball is not thrown. Spin the launcher up before running the windmill; goBILDA's TeleOp waits for 1200 ticks/s.`;
    return `A ball reached the launcher while the flywheel ("${d.name}") was only at ${tps} ticks/s, too slow to throw it clear. Let it reach speed before feeding; goBILDA's TeleOp waits for 1200 ticks/s.`;
  }

  #loop() {
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - this.lastWall) / 1000, 0.05);
    this.lastWall = now;
    while (this.acc >= PHYSICS_DT) { this.sim.step(PHYSICS_DT); this.acc -= PHYSICS_DT; }
    this.tick++;
    if (this.proc && this.tick % 2 === 0) this.#pushState(this.proc, this.tick % 24 === 0); // sensors ~125 Hz
    if (this.tick % 4 === 0) this.emit('sim', this.sim.snapshot()); // ~60 Hz to the UI
    const fault = this.sim.launchFault;
    if (fault) { // say why a ball that reached the launcher was not thrown (at most once every 4 s)
      this.sim.launchFault = null;
      if (now - (this.lastFaultAt ?? -1e9) > 4000) { this.lastFaultAt = now; this.emit('log', { stream: 'warning', text: this.#launchFaultText(fault) }); }
    }
  }

  async dispose() {
    clearInterval(this.timer);
    if (this.proc) { this.proc.kill('SIGKILL'); await this.proc.exited; }
    this.sim.dispose();
  }
}
