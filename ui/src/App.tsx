import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { compileNow, get, live, log, openFile, send, set, uploadZip, useStore } from './store';
import { Editor, save } from './Editor';
import { Viewport } from './Viewport';
import { AXES, BUTTONS, DEFAULT_BINDINGS, anyButton, assignController, bindings, captureNextKey, connectedPads, keyLabel, keysDown, onControllerSetupNeeded, padName, pads, saveBindings, slots, suspendInput, swapControllers } from './gamepads';

const f = (v: number | null | undefined, d = 2) => (v ?? 0).toFixed(d);

// ------------------------------------------------------------------ top bar and projects
function TopBar() {
  const connected = useStore((s) => s.connected), projects = useStore((s) => s.projects), project = useStore((s) => s.project);
  const compiling = useStore((s) => s.compiling), example = useStore((s) => s.exampleAvailable), opState = useStore((s) => s.opmode.state);
  const input = useRef<HTMLInputElement>(null), busy = ['starting', 'init', 'running'].includes(opState);
  const pickFolder = async () => { const p = await window.ftcsim!.pickFolder(); if (p) { send({ type: 'openFolder', path: p }); setTimeout(compileNow, 300); } };
  return (
    <header>
      <h1>FTC BIOBUZZ Simulator</h1>
      <select value={project?.id ?? ''} disabled={busy} title={busy ? 'Stop the OpMode to switch projects' : 'Saved projects'} onChange={(e) => e.target.value && send({ type: 'openProject', id: e.target.value })}>
        {!project && <option value="">{projects.length ? 'Choose a saved project…' : 'No project yet'}</option>}
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {new Date(p.loadedAt).toLocaleDateString()}</option>)}
      </select>
      {project && <button disabled={busy} title="Delete this saved project from the simulator" onClick={() => { if (confirm(`Remove "${project.name}" from the simulator? Your original files are not touched.`)) send({ type: 'removeProject', id: project.id }); }}>Remove</button>}
      <span className="spacer" />
      <span className={'note ' + (connected ? '' : 'bad')}>{connected ? 'running locally' : 'simulator not reachable, retrying…'}</span>
      <input ref={input} type="file" accept=".zip" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadZip(file); e.target.value = ''; }} />
      <button disabled={busy} onClick={() => input.current!.click()}>Upload project ZIP</button>
      {window.ftcsim && <button disabled={busy} onClick={pickFolder}>Open project folder…</button>}
      {example && <button disabled={busy} onClick={() => { send({ type: 'loadExample' }); setTimeout(compileNow, 200); }}>Load goBILDA example</button>}
      <button className="primary" disabled={!project || compiling} onClick={compileNow}>{compiling ? 'Compiling…' : 'Compile'}</button>
    </header>
  );
}

// ------------------------------------------------------------------ explorer
function Explorer() {
  const project = useStore((s) => s.project), open = useStore((s) => s.file?.path);
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    if (!project || !q.trim()) return null;
    const n = q.trim().toLowerCase(), out: { kind: string; label: string; file: string; line?: number }[] = [];
    for (const file of project.files) if (file.path.toLowerCase().includes(n)) out.push({ kind: 'file', label: file.path.split('/').pop(), file: file.path });
    for (const j of project.java) {
      for (const t of j.types) if (t.name.toLowerCase().includes(n)) out.push({ kind: t.kind, label: t.name, file: j.path, line: t.line });
      for (const m of j.methods) if (m.name.toLowerCase().includes(n)) out.push({ kind: 'method', label: `${m.name}()`, file: j.path, line: m.line });
    }
    for (const h of project.hardware) if (h.name.toLowerCase().includes(n)) for (const r of h.refs) out.push({ kind: 'hardware', label: `"${h.name}" (${h.types.join('/')})`, file: r.file, line: r.line });
    return out.slice(0, 200);
  }, [project, q]);
  const tree = useMemo(() => {
    const rows: { depth: number; name: string; path?: string; category?: string }[] = [], seen = new Set<string>();
    for (const file of project?.files ?? []) {
      const parts = file.path.split('/');
      for (let i = 0; i < parts.length - 1; i++) { const dir = parts.slice(0, i + 1).join('/'); if (!seen.has(dir)) { seen.add(dir); rows.push({ depth: i, name: parts[i] + '/' }); } }
      rows.push({ depth: parts.length - 1, name: parts[parts.length - 1], path: file.path, category: file.category });
    }
    return rows;
  }, [project]);
  return (
    <section className="explorer">
      <h2>Project <span className="right">{project ? `${project.files.length} files · ${project.java.length} Java` : ''}</span></h2>
      <input className="search" placeholder="Search files, classes, methods, hardware" value={q} onChange={(e) => setQ(e.target.value)} disabled={!project} />
      <div className="scroll">
        {!project && <div className="drop">Drop an FTC Android Studio project (.zip) anywhere, or use the buttons above.</div>}
        {hits ? (hits.length ? hits.map((h, i) => <div key={i} className="row" title={h.file} onClick={() => openFile(h.file, h.line ?? null)}><span className={'kind ' + h.kind}>{h.kind}</span>{h.label}<span className="dim"> {h.file.split('/').pop()}{h.line ? ':' + h.line : ''}</span></div>) : <div className="pad note">Nothing matches.</div>)
          : tree.map((r, i) => r.path
            ? <div key={i} className={'row ' + (r.path === open ? 'sel' : '')} style={{ paddingLeft: 10 + r.depth * 10 }} title={r.path} onClick={() => openFile(r.path!)}>{r.name}<span className="dim"> {r.category !== 'java' ? r.category : ''}</span></div>
            : <div key={i} className="row dir" style={{ paddingLeft: 10 + r.depth * 10 }}>{r.name}</div>)}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ dependency view
function Graph() {
  const project = useStore((s) => s.project);
  if (!project) return <div className="empty">Open a project to see how its classes depend on each other.</div>;
  const byPath = new Map<string, any>(project.java.map((j: any) => [j.path, j]));
  const usedBy = new Map<string, string[]>();
  for (const j of project.java) for (const u of j.uses) usedBy.set(u.file, [...(usedBy.get(u.file) ?? []), j.path]);
  const node = (path: string, trail: string[], depth: number): any => {
    const j = byPath.get(path), hw = j.hardware.map((h: any) => h.name);
    return (
      <div key={trail.join('>') + path} style={{ marginLeft: depth ? 18 : 0 }} className="gnode">
        <div className="row" onClick={() => openFile(path)}>
          {depth > 0 && <span className="dim">└ </span>}<b>{path.split('/').pop()}</b>
          {j.opmode && <span className={'badge ' + (j.opmode.flavor === 'TeleOp' ? 'tele' : 'auto')}>{j.opmode.flavor}</span>}
          {hw.length > 0 && <span className="dim"> hardware: {[...new Set(hw)].join(', ')}</span>}
          <span className="dim"> · {j.methods.length} methods</span>
        </div>
        {trail.includes(path) ? <div className="dim" style={{ marginLeft: 18 }}>(cycle)</div> : j.uses.filter((u: any, i: number, a: any[]) => a.findIndex((x) => x.file === u.file) === i).map((u: any) => node(u.file, [...trail, path], depth + 1))}
      </div>
    );
  };
  const roots = project.java.filter((j: any) => j.opmode || !usedBy.has(j.path));
  return <div className="scroll pad graph"><div className="note">Each OpMode and the project classes it reaches. Click a file to open it.</div>{roots.map((j: any) => node(j.path, [], 0))}</div>;
}

// ------------------------------------------------------------------ OpModes
function OpModes() {
  const compile = useStore((s) => s.compile), project = useStore((s) => s.project), opmode = useStore((s) => s.opmode), selected = useStore((s) => s.selectedOpMode);
  useStore((s) => s.tick);
  const st = opmode.state, active = ['starting', 'init', 'running'].includes(st);
  const sel = compile?.ok ? compile.opmodes.find((o: any) => o.class === selected) : null;
  const choose = (cls: string) => { set({ selectedOpMode: cls }); send({ type: 'saveProjectSettings', settings: { selectedOpMode: cls } }); };
  const runtime = opmode.startedAt ? (((st === 'running' ? Date.now() : opmode.endedAt ?? Date.now()) - opmode.startedAt) / 1000).toFixed(1) + ' s' : '';
  return (
    <div className="block">
      <h2>OpModes <span className="right">{!compile ? 'not compiled' : compile.ok ? <span className="ok">compiled</span> : <span className="bad">compile failed</span>}</span></h2>
      {!compile && (project?.opmodes ?? []).map((o: any) => <div key={o.className} className="opmode"><span className={'badge ' + (o.flavor === 'TeleOp' ? 'tele' : 'auto')}>{o.flavor}</span>{o.name}<small>found in source; compile to run</small></div>)}
      {!compile && !project?.opmodes?.length && <div className="pad note">{project ? 'No @TeleOp or @Autonomous classes found in the source.' : 'Open a project, then compile it.'}</div>}
      {compile && !compile.ok && <div className="pad note">Fix the errors listed under Problems, then compile again.</div>}
      {compile?.ok && compile.opmodes.map((o: any) => (
        <div key={o.class} className={'opmode ' + (o.class === selected ? 'sel' : '')} onClick={() => !active && choose(o.class)}>
          <span className={'badge ' + (o.flavor === 'TeleOp' ? 'tele' : 'auto')}>{o.flavor}</span><span>{o.name}</span>
          {o.disabled && <span className="badge warn">@Disabled</span>}{!o.supported && <span className="badge warn">unsupported</span>}{o.warnings.length > 0 && <span className="badge warn">hardware</span>}
          <small>{o.base}</small>
        </div>))}
      {compile?.ok && !compile.opmodes.length && <div className="pad note">No @TeleOp or @Autonomous classes were found in the compiled project.</div>}
      <div className="controls">
        <button className="init" disabled={!sel || sel.disabled || !sel.supported || active} onClick={() => send({ type: 'init', opmode: selected })}>INIT</button>
        <button className="play" disabled={st !== 'init'} onClick={() => send({ type: 'start' })}>PLAY</button>
        <button className="stop" disabled={!active} onClick={() => send({ type: 'stop' })}>STOP</button>
        <button onClick={() => send({ type: 'reset' })}>RESET</button>
        <span className={'state ' + st}>{st.toUpperCase()} {runtime}</span>
      </div>
      {sel && <div className="pad note">
        <b>{sel.name}</b> · <a onClick={() => sel.file && openFile(sel.file, sel.line)}>{sel.file?.split('/').pop() ?? sel.class}</a> · {sel.package || 'default package'}{sel.group ? ` · group "${sel.group}"` : ''}<br />
        Hardware: {sel.hardware.join(', ') || 'none detected'}
        {sel.disabled && <div className="warn">Marked @Disabled in source; remove the annotation to run it.</div>}
        {[...sel.blockers, ...sel.warnings].map((w: string, i: number) => <div key={i} className="warn">{w}</div>)}
        {active && opmode.sandbox && <div>Runs in: {opmode.sandbox}</div>}
        {opmode.error && <div className="bad">{String(opmode.error).split('\n')[0]}</div>}
      </div>}
    </div>
  );
}

// ------------------------------------------------------------------ game elements, telemetry, robot state
function Elements() {
  const field = useStore((s) => s.field), placeMode = useStore((s) => s.placeMode);
  useStore((s) => s.tick);
  const snap = live.snap, els = snap?.elements ?? [];
  if (!field) return null;
  return (
    <div className="block">
      <h2>Game elements <span className="right">{els.length ? `${els.length} on field · ${(snap.carried ?? []).length} in robot` : 'none on field'}</span></h2>
      <div className="controls wrap">
        <button title={`Official staging (${field.staging.source}). Not staged: ${field.staging.notStaged.join('; ')}`} onClick={() => send({ type: 'elements', action: 'stage' })}>Stage match setup</button>
        <button onClick={() => send({ type: 'elements', action: 'reset' })}>Reset positions</button>
        <button onClick={() => send({ type: 'elements', action: 'clear' })}>Clear</button>
        <label className="note">Click field to <select value={placeMode} onChange={(e) => set({ placeMode: e.target.value })}>
          <option value="off">do nothing</option>
          {Object.entries<any>(field.elements).map(([id, e]) => <option key={id} value={id}>place {e.label}</option>)}
          <option value="remove">remove an element</option></select></label>
      </div>
      <div className="pad note">{(snap?.hives ?? []).map((h: any) => `${h.id.replace('hive_', '')} HIVE ${h.tipped ? 'tipped' : 'as staged'}`).join(' · ')}</div>
    </div>
  );
}

function Telemetry() {
  const lines = useStore((s) => s.telemetry);
  return <div className="block"><h2>Driver Station telemetry <span className="right">from telemetry.update()</span></h2><pre className="telemetry">{lines.join('\n') || ' '}</pre></div>;
}

function RobotState() {
  useStore((s) => s.tick);
  const s = live.snap;
  if (!s) return null;
  const loads = (side: string) => (s.wheels ?? []).filter((w: any) => w.id.startsWith(side)).map((w: any) => f(w.loadN, 0).padStart(3)).join(' ');
  return (
    <div className="block">
      <h2>Robot state <span className="right">simulator</span></h2>
      <div className="kv pad mono">
        <span>position</span><span>x {f(s.pose.x, 3)} m, y {f(s.pose.y, 3)} m{s.atWall ? '  (at wall)' : ''}</span>
        <span>heading</span><span>{f((s.pose.heading * 180) / Math.PI, 1)}°</span>
        <span>velocity</span><span>{f(s.vel.v)} m/s, {f((s.vel.omega * 180) / Math.PI, 0)}°/s</span>
        <span>acceleration</span><span>{f(s.vel.accel)} m/s²</span>
        <span>pitch / roll</span><span>{f(s.tilt?.pitchDeg)}° / {f(s.tilt?.rollDeg)}°</span>
        <span>wheel loads</span><span>L {loads('left')} · R {loads('right')} N</span>
        <span>intake arm</span><span>{f(((s.joints?.intake_arm ?? 0) * 180) / Math.PI, 1)}° lift</span>
        <span>battery</span><span>{f(s.battery.volts)} V, {f(s.battery.amps, 1)} A</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sensors
const deg = (r: number) => f((r * 180) / Math.PI, 1) + '°';
function sensorText(d: any) {
  const v = d.values ?? [];
  switch (d.kind) {
    case 'imu': return `yaw ${deg(v[0] ?? 0)}  pitch ${deg(v[1] ?? 0)}  roll ${deg(v[2] ?? 0)}`;
    case 'voltage': return `${f(v[0])} V`;
    case 'distance': return v[0] >= 0 ? `${f(v[0] * 100, 1)} cm` : 'nothing in range';
    case 'color': return `r ${f(v[0])} g ${f(v[1])} b ${f(v[2])}${v[4] >= 0 ? `  at ${f(v[4] * 100, 1)} cm` : '  nothing near'}`;
    case 'touch': return v[0] > 0.5 ? 'pressed' : 'released';
    case 'digital': return v[0] > 0.5 ? 'high (true)' : 'low (false)';
    case 'analog': return `${f(v[0])} V`;
    default: return v.map((x: number) => f(x)).join(', ');
  }
}
/** Hand-set a sensor's reading. Sensors with a simulated source can be returned to it. */
function SensorInput({ name, d }: { name: string; d: any }) {
  const field = useStore((s) => s.field);
  const setV = (values: number[] | null) => send({ type: 'setSensor', name, values });
  const auto = d.simulated ? <button title="Return to the simulated reading" disabled={!d.manual} onClick={() => setV(null)}>auto</button> : null;
  const v = d.values ?? [];
  if (d.kind === 'imu' || d.kind === 'voltage') return <span className="dim">simulated</span>;
  if (d.kind === 'touch') return <><label><input type="checkbox" checked={v[0] > 0.5} onChange={(e) => setV([e.target.checked ? 1 : 0])} /> pressed</label> {auto}</>;
  if (d.kind === 'digital') return <><label><input type="checkbox" checked={v[0] > 0.5} onChange={(e) => setV([e.target.checked ? 1 : 0])} /> high</label> {auto}</>;
  if (d.kind === 'distance') return <><input className="numin" type="number" min={0} step={1} placeholder="cm" defaultValue={d.manual && v[0] >= 0 ? Math.round(v[0] * 100) : ''} onChange={(e) => setV(e.target.value === '' ? (d.simulated ? null : [-1]) : [Number(e.target.value) / 100])} /> cm {auto}</>;
  if (d.kind === 'analog') return <><input className="numin" type="number" min={0} max={3.3} step={0.1} placeholder="V" onChange={(e) => setV([Number(e.target.value) || 0])} /> V</>;
  if (d.kind === 'color') return <><select defaultValue="" onChange={(e) => { const el = (field?.elements ?? {})[e.target.value]; if (!el) return setV(d.simulated ? null : [0.03, 0.03, 0.03, 0.05, -1]); const c = [1, 3, 5].map((i) => parseInt(el.color.slice(i, i + 2), 16) / 255); setV([c[0], c[1], c[2], 1, 0.01]); }}>
    <option value="">{d.simulated ? 'auto' : 'sees nothing'}</option>{Object.entries<any>(field?.elements ?? {}).map(([id, e]) => <option key={id} value={id}>sees {e.label}</option>)}</select></>;
  return null;
}

/** Robot-device picker for one hardware name. Defined at module level (not inside the panel) and memoised,
 *  so the 10 Hz live refresh doesn't recreate it and close it while it is open. */
const Mapper = memo(function Mapper({ name, kind }: { name: string; kind: string | null }) {
  const robot = useStore((s) => s.robot), value = useStore((s) => s.project?.settings?.hardwareAliases?.[name] ?? '');
  return (
    <select value={value} title="Which StarterBot part this name means. Takes effect at the next INIT." onChange={(e) => send({ type: 'setHardwareAlias', name, device: e.target.value || null })}>
      <option value="">{robot?.devices[name] ? 'same name' : 'not assigned'}</option>
      {Object.entries<any>(robot?.devices ?? {}).filter(([, d]) => !kind || d.kind === kind || (kind === 'servo' && d.kind === 'crservo')).map(([id]) => <option key={id} value={id}>{id}</option>)}
    </select>);
});

// ------------------------------------------------------------------ hardware (with manual mapping)
function Hardware() {
  const project = useStore((s) => s.project), robot = useStore((s) => s.robot), assembly = useStore((s) => s.assembly), opState = useStore((s) => s.opmode.state);
  useStore((s) => s.tick);
  const devices = live.snap?.devices ?? {}, names = Object.keys(devices), active = ['starting', 'init', 'running'].includes(opState);
  const cad = (device: string | null) => (device ? (assembly?.components ?? []).filter((c: any) => (c.drive?.hardware ?? c.hardware) === device).length : 0);
  const aliases = project?.settings?.hardwareAliases ?? {};
  return (
    <>
      <h2>Hardware <span className="right">{names.length ? 'live' : 'detected in source'}</span></h2>
      {names.some((n) => !devices[n].resolved) && <div className="pad note warn">Orange names are not on the StarterBot model, so nothing moves for them. Choose the matching part under <b>robot device</b>, then STOP and INIT again.</div>}
      <div className="scroll" onMouseLeave={() => window.viewer3d?.highlight(null)}>
        {names.length > 0 && <div className="hwwrap"><table><thead><tr><th>device</th><th>robot device</th><th>mode</th><th>duty</th><th>velocity</th><th>encoder</th><th>A</th><th>CAD</th></tr></thead><tbody>
          {names.map((n) => { const d = devices[n], dot = <span className={'dot ' + (d.resolved ? '' : 'badbg')} title={d.resolved ? d.label : 'Not on the robot model: runs as a detached device'} />;
            return (
              <tr key={n} onMouseEnter={() => window.viewer3d?.highlight(d.device)}>
                <td>{dot}{n}</td>
                <td><Mapper name={n} kind={d.kind} /></td>
                {d.kind === 'motor' ? <><td>{d.mode.replace('RUN_', '').replace('_ENCODER', '_ENC')}</td><td className="num">{f(d.appliedDuty)}</td>
                  <td className="num">{f(d.velocityTps, 0)}{d.targetVelTps != null ? ' → ' + f(d.targetVelTps, 0) : ''}</td><td className="num">{f(d.positionTicks, 0)}{d.targetPosTicks != null ? ' → ' + f(d.targetPosTicks, 0) : ''}</td><td className="num">{f(d.currentA, 1)}</td></>
                  : d.kind === 'crservo' ? <><td>CR servo</td><td className="num">{f(d.commandedPower)}</td><td className="num">{f(d.rpm, 0)} rpm</td><td /><td /></>
                    : d.sensor ? <><td>{d.kind}{d.manual ? ' (hand-set)' : ''}</td><td colSpan={2} className="mono">{sensorText(d)}</td><td colSpan={2}><SensorInput name={n} d={d} /></td></>
                      : <><td>servo</td><td className="num">{d.target == null ? '—' : f(d.target)}</td><td className="num">at {f(d.position)}</td><td /><td /></>}
                <td className="num">{cad(d.device) || '—'}</td>
              </tr>); })}
        </tbody></table></div>}
        {(project?.hardware ?? []).length > 0 && <div className="hwwrap"><table><thead><tr><th>name in code</th><th>robot device</th><th>status</th></tr></thead><tbody>
          {project.hardware.map((h: any) => (
            <tr key={h.name} onMouseEnter={() => window.viewer3d?.highlight(aliases[h.name] ?? h.name)}>
              <td title={`${h.types.join('/')} · ${h.refs.map((r: any) => r.file.split('/').pop() + ':' + r.line).join(', ')}`}><span className={'dot ' + (h.status === 'connected' ? '' : 'badbg')} /><a onClick={() => openFile(h.refs[0].file, h.refs[0].line)}>{h.name}</a></td>
              <td><Mapper name={h.name} kind={h.kind ?? null} /></td>
              <td className={h.status === 'connected' ? '' : 'warn'} title={h.component ?? h.status}>{h.status === 'connected' ? 'connected' : 'unresolved'}</td>
            </tr>))}
        </tbody></table></div>}
        {!names.length && !(project?.hardware ?? []).length && <div className="pad note">Hardware appears here once a project is open.</div>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ console and problems
function Console() {
  const logs = useStore((s) => s.logs), compile = useStore((s) => s.compile);
  const [tab, setTab] = useState<'console' | 'problems'>('console'), end = useRef<HTMLDivElement>(null);
  const problems = compile?.diagnostics ?? [], errors = problems.filter((d: any) => d.severity === 'error').length;
  useEffect(() => { end.current?.scrollIntoView(); }, [logs.length, tab]);
  useEffect(() => { if (compile && !compile.ok) setTab('problems'); }, [compile]);
  return (
    <div className="pane">
      <h2><a className={tab === 'console' ? 'tab on' : 'tab'} onClick={() => setTab('console')}>Console</a>
        <a className={tab === 'problems' ? 'tab on' : 'tab'} onClick={() => setTab('problems')}>Problems {problems.length ? `(${errors} errors, ${problems.length - errors} warnings)` : ''}</a>
        <span className="right"><button onClick={() => set({ logs: [] })}>Clear</button></span></h2>
      <div className="scroll mono console">
        {tab === 'console' ? logs.map((l, i) => <div key={i} className={l.stream}>{l.file && <a onClick={() => openFile(l.file!, l.line ?? null)}>{l.file}:{l.line} </a>}{l.text}</div>)
          : problems.length ? <table><thead><tr><th>file</th><th>line</th><th>category</th><th>message</th></tr></thead><tbody>
            {problems.map((d: any, i: number) => <tr key={i} className={d.severity}><td>{d.file ? <a onClick={() => openFile(d.file, d.line)}>{d.file.split('/').pop()}</a> : ''}</td><td className="num">{d.line ?? ''}</td><td>{d.category}</td><td className="wrapcell">{d.message}</td></tr>)}
          </tbody></table> : <div className="note">{compile ? 'No problems.' : 'Compile the project to see errors and warnings here.'}</div>}
        <div ref={end} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ gamepads
function Pad({ id }: { id: 1 | 2 }) {
  useStore((s) => s.tick);
  const p = pads[id], on = Object.entries(p.buttons).filter(([, v]) => v).map(([n]) => n);
  const stick = (x: number, y: number) => <svg width="34" height="34" viewBox="-17 -17 34 34"><circle r="15" className="ring" /><circle cx={x * 10} cy={y * 10} r="5" className={x || y ? 'knob active' : 'knob'} /></svg>;
  const bar = (v: number) => <svg width="10" height="34"><rect x="1" y="1" width="8" height="32" className="ring" /><rect x="1" y={33 - v * 32} width="8" height={v * 32} className="knob active" /></svg>;
  return (
    <div className="padview">
      <div className="padtitle">Gamepad {id} <span className="dim">{p.source}</span></div>
      <div className="sticks">{bar(p.lt)}{stick(p.lx, p.ly)}{stick(p.rx, p.ry)}{bar(p.rt)}
        <div className="btns">{['a', 'b', 'x', 'y', 'left_bumper', 'right_bumper', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'back', 'start'].map((b) => <span key={b} className={on.includes(b) ? 'key on' : 'key'}>{b.replace('left_bumper', 'LB').replace('right_bumper', 'RB').replace('dpad_', '').toUpperCase().slice(0, 5)}</span>)}</div>
      </div>
      <div className="mono dim">L {f(p.lx)} {f(p.ly)} · R {f(p.rx)} {f(p.ry)} · LT {f(p.lt)} RT {f(p.rt)}</div>
    </div>
  );
}

/** Three steps: press a button on driver 1's controller, then on driver 2's, then check that sticks and buttons respond. */
function ControllerSetup({ onClose }: { onClose: () => void }) {
  useStore((s) => s.tick);
  const [step, setStep] = useState<'pad1' | 'pad2' | 'test'>('pad1');
  const released = useRef(false); // a button held while the step opens does not count
  useEffect(() => { suspendInput(true); return () => suspendInput(false); }, []);
  useEffect(() => {
    if (step === 'test') return;
    released.current = false;
    const t = setInterval(() => {
      const list = connectedPads().filter((g) => step === 'pad1' || g.index !== slots[1]);
      if (!released.current) { released.current = !list.some(anyButton); return; }
      const hit = list.find(anyButton);
      if (!hit) return;
      if (step === 'pad1') { assignController(2, null); assignController(1, hit.index); setStep('pad2'); } else { assignController(2, hit.index); setStep('test'); }
    }, 40);
    return () => clearInterval(t);
  }, [step]);
  const list = connectedPads(), nameOf = (p: 1 | 2) => { const g = list.find((x) => x.index === slots[p]); return g ? padName(g) : 'keyboard'; };
  const n = step === 'pad1' ? 1 : step === 'pad2' ? 2 : 3;
  return (
    <div className="modal">
      <div className="dialog setup">
        <h2>Controller setup <span className="dim">step {n} of 3</span> <span className="right"><button onClick={onClose}>Close</button></span></h2>
        {step !== 'test' ? <>
          <div className="setupbig">Press any button on the controller for <b>gamepad {n}</b>{n === 1 ? ' (driver 1)' : ' (driver 2)'}.</div>
          <div className="pad note">{list.length ? <>Detected: {list.map((g) => `${padName(g)}${g.index === slots[1] ? ' (gamepad 1)' : ''}`).join(' · ')}</> : 'No controller detected yet. Plug it in (USB or Bluetooth) and press a button on it: a controller only shows up after its first button press.'}</div>
          <div className="controls">
            {step === 'pad1'
              ? <button onClick={() => { assignController(1, null); setStep('pad2'); }}>Keep gamepad 1 on the keyboard</button>
              : <button onClick={() => { assignController(2, null); setStep('test'); }}>{list.length > 1 ? 'Skip: no controller for gamepad 2' : 'Skip: I only have one controller'}</button>}
          </div>
        </> : <>
          <div className="pad note">Move the sticks and press the buttons: each gamepad below should respond to its own controller. The robot ignores them until you close this dialog.</div>
          <div className="padtitle pad">Gamepad 1 is {nameOf(1)} · Gamepad 2 is {nameOf(2)}</div>
          <Pad id={1} /><Pad id={2} />
          <div className="controls"><button className="primary" onClick={onClose}>Done</button> <button onClick={swapControllers}>Swap 1 and 2</button> <button onClick={() => setStep('pad1')}>Start over</button></div>
        </>}
        <div className="pad note dim">Your choice is remembered, so next time the controllers connect straight away. As on a real Driver Station, Start + A makes a controller gamepad 1 and Start + B makes it gamepad 2 at any time. Keyboard keys keep working alongside.</div>
      </div>
    </div>
  );
}

function Controls({ onClose }: { onClose: () => void }) {
  useStore((s) => s.settings); useStore((s) => s.tick);
  const [waiting, setWaiting] = useState<string | null>(null);
  const bind = (pad: 1 | 2, action: string) => { setWaiting(`${pad}:${action}`); captureNextKey((code) => { setWaiting(null); const b = { ...bindings(pad) }; if (code === 'Escape') return; if (code === 'Backspace' || code === 'Delete') delete b[action]; else b[action] = code; saveBindings(pad, b); }); };
  const cell = (pad: 1 | 2, action: string) => <td><button className={waiting === `${pad}:${action}` ? 'on' : ''} onClick={() => bind(pad, action)}>{waiting === `${pad}:${action}` ? 'press a key…' : keyLabel(bindings(pad)[action])}</button></td>;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && (captureNextKey(null), onClose())}>
      <div className="dialog">
        <h2>Controls <span className="right"><button onClick={() => { captureNextKey(null); onClose(); }}>Close</button></span></h2>
        <div className="pad note">Click a cell, then press the key to use. Backspace clears a binding; Escape cancels. Mappings are saved on this computer.</div>
        <div className="pad note">These are the keyboard keys. For USB or Bluetooth controllers use the Controllers button in the Gamepads panel.</div>
        <div className="scroll"><table><thead><tr><th>control</th><th>Gamepad 1 key</th><th>Gamepad 2 key</th></tr></thead><tbody>
          {AXES.map(([a, label]) => <tr key={a}><td>{label}</td>{cell(1, a)}{cell(2, a)}</tr>)}
          {BUTTONS.map((b) => <tr key={b}><td>{b}</td>{cell(1, b)}{cell(2, b)}</tr>)}
        </tbody></table></div>
        <div className="controls"><button onClick={() => { saveBindings(1, DEFAULT_BINDINGS[1]); setTimeout(() => saveBindings(2, DEFAULT_BINDINGS[2]), 50); }}>Restore defaults</button></div>
      </div>
    </div>
  );
}

function Gamepads() {
  const [open, setOpen] = useState(false), [setup, setSetup] = useState(false);
  useEffect(() => { onControllerSetupNeeded(() => setSetup(true)); return () => onControllerSetupNeeded(null); }, []);
  return (
    <div className="pane pads">
      <h2>Gamepads <span className="right"><button onClick={() => setSetup(true)} title="Choose which controller is gamepad 1 and gamepad 2">Controllers…</button> <button onClick={() => setOpen(true)} title="Keyboard keys for each gamepad">Keys…</button></span></h2>
      <div className="scroll"><Pad id={1} /><Pad id={2} /></div>
      {open && <Controls onClose={() => setOpen(false)} />}
      {setup && <ControllerSetup onClose={() => setSetup(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ layout
export function App() {
  const tab = useStore((s) => s.tab), file = useStore((s) => s.file);
  const dirty = !!file && file.text !== file.saved;
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); document.body.classList.add('dragging'); };
    const leave = () => document.body.classList.remove('dragging');
    const drop = (e: DragEvent) => { e.preventDefault(); leave(); const fl = e.dataTransfer?.files[0]; if (!fl) return; if (/\.zip$/i.test(fl.name)) uploadZip(fl); else log('error', `${fl.name} is not a .zip archive. Zip the project folder and drop that.`); };
    addEventListener('dragover', over); addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, []);
  return (
    <div className="app">
      <TopBar />
      <Explorer />
      <section className="center">
        <h2 className="tabs">
          <a className={tab === 'field' ? 'tab on' : 'tab'} onClick={() => set({ tab: 'field' })}>Field</a>
          {file && <a className={tab === 'editor' ? 'tab on' : 'tab'} onClick={() => set({ tab: 'editor' })} title={file.path}>{file.path.split('/').pop()}{dirty ? ' •' : ''}</a>}
          <a className={tab === 'graph' ? 'tab on' : 'tab'} onClick={() => set({ tab: 'graph' })}>Dependencies</a>
          <span className="right">{tab === 'editor' && file && <><button className="primary" disabled={!dirty} onClick={save} title="Ctrl/Cmd+S">Save &amp; recompile</button> <button onClick={() => set({ file: null, tab: 'field' })}>Close</button></>}</span>
        </h2>
        <div className="stack">
          <Viewport visible={tab === 'field'} />
          {file && <div className="fill" style={{ display: tab === 'editor' ? undefined : 'none' }}><Editor /></div>}
          {tab === 'graph' && <div className="fill"><Graph /></div>}
        </div>
      </section>
      <section className="right-col"><OpModes /><Elements /><Telemetry /><RobotState /><Hardware /></section>
      <section className="bottom"><Console /><Gamepads /></section>
    </div>
  );
}
