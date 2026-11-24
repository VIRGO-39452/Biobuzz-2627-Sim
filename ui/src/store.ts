// Application state and the link to the local simulator server.
// High-rate physics snapshots live outside React (live.snap); panels that show them re-render on a 10 Hz tick.
import { useSyncExternalStore } from 'react';

export type LogEntry = { stream: string; text: string; file?: string; line?: number; at: number };
export type State = {
  connected: boolean; robot: any; assembly: any; field: any; fieldInfo: any; exampleAvailable: boolean;
  projects: any[]; settings: any; project: any; compile: any; compiling: boolean;
  opmode: any; telemetry: string[]; bindings: any[]; logs: LogEntry[];
  selectedOpMode: string | null; tab: 'field' | 'editor' | 'graph';
  file: { path: string; text: string; saved: string; line: number | null } | null;
  placeMode: string; tick: number;
};

const state: State = {
  connected: false, robot: null, assembly: null, field: null, fieldInfo: null, exampleAvailable: false,
  projects: [], settings: {}, project: null, compile: null, compiling: false,
  opmode: { state: 'idle' }, telemetry: [], bindings: [], logs: [],
  selectedOpMode: null, tab: 'field', file: null, placeMode: 'off', tick: 0,
};
export const live: { snap: any } = { snap: null };

const listeners = new Set<() => void>();
let version = 0, snapshotCache: State = { ...state };
function emit() { version++; snapshotCache = { ...state }; listeners.forEach((l) => l()); }
export function set(patch: Partial<State>) { Object.assign(state, patch); emit(); }
export const get = () => state;
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(snapshotCache));
}

export function log(stream: string, text: string, extra: Partial<LogEntry> = {}) {
  set({ logs: [...state.logs.slice(-499), { stream, text, at: Date.now(), ...extra }] });
}

let ws: WebSocket | null = null;
export function send(msg: any) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function pickOpMode(compile: any, current: string | null, preferred?: string) {
  if (!compile?.ok) return null;
  const ok = (c: string | null | undefined) => compile.opmodes.some((o: any) => o.class === c);
  if (ok(current)) return current;
  if (ok(preferred)) return preferred!;
  return compile.opmodes.find((o: any) => !o.disabled && o.supported)?.class ?? null;
}

function handle(m: any) {
  switch (m.type) {
    case 'hello':
      set({ connected: true, robot: m.robot, assembly: m.assembly, field: m.field, fieldInfo: m.fieldInfo, exampleAvailable: m.exampleAvailable, projects: m.projects, settings: m.settings ?? {},
        project: m.project, compile: m.compile, opmode: m.opmode, bindings: m.hardware, selectedOpMode: pickOpMode(m.compile, state.selectedOpMode, m.project?.settings?.selectedOpMode) });
      break;
    case 'projects': set({ projects: m.projects }); break;
    case 'settings': set({ settings: m.settings }); break;
    case 'project': {
      const switched = m.project?.id !== state.project?.id;
      set({ project: m.project, ...(switched ? { compile: null, file: null, tab: 'field', selectedOpMode: null, telemetry: [] } : {}) });
      break;
    }
    case 'compile': {
      const r = m.result, errs = r.diagnostics.filter((d: any) => d.severity === 'error').length;
      set({ compile: r, compiling: false, selectedOpMode: pickOpMode(r, state.selectedOpMode, state.project?.settings?.selectedOpMode) });
      log(r.ok ? 'ok' : 'error', `${r.ok ? 'Compiled' : 'Compilation failed'}: ${r.sources.length} source file(s), ${errs} error(s), ${r.diagnostics.length - errs} warning(s), ${r.ms} ms (${r.javac})`);
      for (const d of r.diagnostics) log(d.severity, `[${d.category}] ${d.message}`, { file: d.file ?? undefined, line: d.line ?? undefined });
      for (const e of r.loadErrors ?? []) log('warning', `Could not inspect class ${e.class}: ${e.error}`);
      break;
    }
    case 'opmode': set({ opmode: m.opmode }); break;
    case 'telemetry': set({ telemetry: m.lines }); break;
    case 'hardware': set({ bindings: m.bindings }); break;
    case 'log': log(m.entry.stream, m.entry.text); break;
    case 'sim': live.snap = m.snapshot; break;
    case 'file': set({ file: { path: m.path, text: m.text, saved: m.text, line: pendingLine }, tab: 'editor' }); pendingLine = null; break;
    case 'saved': set({ file: state.file && state.file.path === m.path ? { ...state.file, saved: state.file.text } : state.file, compiling: true }); log('ok', `Saved ${m.path}`); send({ type: 'compile' }); break;
    case 'error': set({ compiling: false }); log('error', `${m.action}: ${m.message}`); break;
  }
}

let pendingLine: number | null = null;
export function openFile(path: string, line: number | null = null) {
  if (state.file?.path === path) { set({ file: { ...state.file, line }, tab: 'editor' }); return; }
  pendingLine = line; send({ type: 'readFile', path });
}
export function compileNow() { set({ compiling: true }); send({ type: 'compile' }); }
export async function uploadZip(file: File) {
  log('sim', `Uploading ${file.name} (${file.size} bytes)…`);
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  const j = await r.json();
  if (j.ok) { log('ok', `Project saved: ${j.files} files scanned.`); compileNow(); } else log('error', `Upload failed: ${j.error}`);
}

export function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { set({ connected: false }); setTimeout(connect, 1000); };
}
setInterval(() => { state.tick++; emit(); }, 100);
