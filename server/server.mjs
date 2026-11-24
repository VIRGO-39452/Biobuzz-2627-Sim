// Local-only HTTP + WebSocket front for a simulator Session. Binds to 127.0.0.1.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Session } from './session.mjs';
import { ROOT } from './jdk.mjs';

const MIME = { '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const EXAMPLE_DIR = join(ROOT, 'examples', 'gobilda-starterbot');

export async function startServer({ port = 5317, workDir = join(ROOT, 'workspaces', 'current'), startPose = null } = {}) {
  const robot = JSON.parse(readFileSync(join(ROOT, 'robots', 'biobuzz-starterbot.json'), 'utf8'));
  const assemblyFile = robot.assembly ? join(ROOT, 'robots', robot.assembly) : null;
  const loadAssembly = () => {
    if (!assemblyFile || !existsSync(assemblyFile)) return null;
    const a = JSON.parse(readFileSync(assemblyFile, 'utf8'));
    return { ...a, modelAvailable: existsSync(join(ROOT, a.model.url.replace(/^\//, ''))) };
  };
  const session = new Session({ workDir, robot, startPose });
  const webDir = join(ROOT, 'ui', 'dist'); // built by `npm run build:ui`
  const localHost = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h ?? '');

  const server = createServer((req, res) => {
    if (!localHost(req.headers.host)) { res.writeHead(403).end('local use only'); return; }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (req.headers.origin && !localHost(new URL(req.headers.origin).host)) { res.writeHead(403).end(); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const project = session.loadZip(Buffer.concat(chunks), url.searchParams.get('name') ?? 'project.zip');
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, files: project.files.length }));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    // static roots: the dashboard, converted CAD assets, robot configs and the three.js library
    const mounts = [['/assets/', join(ROOT, 'assets')], ['/robots/', join(ROOT, 'robots')], ['/', webDir]];
    const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const [prefix, dir] = mounts.find(([p]) => path.startsWith(p));
    const file = resolve(dir, path.slice(prefix.length));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(path === '/index.html' ? 'The dashboard has not been built yet. Run: npm run build:ui' : 'not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => localHost(req.headers.host) && (!req.headers.origin || localHost(new URL(req.headers.origin).host)) });
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
  session.on('project', (project) => broadcast({ type: 'project', project }));
  session.on('projects', (projects) => broadcast({ type: 'projects', projects }));
  session.on('compile', (result) => broadcast({ type: 'compile', result }));
  session.on('opmode', (opmode) => broadcast({ type: 'opmode', opmode }));
  session.on('telemetry', (lines) => broadcast({ type: 'telemetry', lines }));
  session.on('hardware', (bindings) => broadcast({ type: 'hardware', bindings }));
  session.on('log', (entry) => broadcast({ type: 'log', entry: { ...entry, at: Date.now() } }));
  session.on('sim', (snapshot) => broadcast({ type: 'sim', snapshot }));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', robot: { id: robot.id, name: robot.name, notes: robot.notes, chassis: robot.chassis, field: robot.field, devices: robot.devices }, assembly: loadAssembly(), field: session.sim.field,
      fieldInfo: session.sim.fieldShapes ? { bounds: session.sim.fieldShapes.bounds, elementNodes: session.sim.fieldShapes.nodes.elements, hives: session.sim.fieldShapes.hives.map((h) => ({ id: h.id, node: h.node, pivot: h.pivot, axis: h.axis })) } : null,
      projects: session.listProjects(), settings: session.getSettings(), project: session.project, compile: session.compileResult, opmode: session.opmode, hardware: session.hardwareBindings(), exampleAvailable: existsSync(EXAMPLE_DIR) }));
    ws.on('message', async (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      try {
        switch (m.type) {
          case 'gamepad': session.setGamepad(m.id, m.state); break;
          case 'compile': await session.compile(); break;
          case 'init': await session.init(m.opmode); break;
          case 'start': session.start(); break;
          case 'stop': { const r = await session.stop(); broadcast({ type: 'log', entry: { stream: 'sim', at: Date.now(), text: `STOP: OpMode ${r.state} in ${r.ms} ms${r.forced ? ' (JVM force-terminated)' : ''}` } }); break; }
          case 'reset': await session.reset(); break;
          case 'elements': session.elements(m); break;
          case 'setSensor': session.setSensor(m.name, m.values ?? null); break;
          case 'loadExample': session.loadDir(EXAMPLE_DIR, 'goBILDA BIOBUZZ StarterBot example code'); break;
          case 'removeProject': session.removeProject(m.id); break;
          case 'openProject': session.openProject(m.id); break;
          case 'openFolder': session.loadDir(String(m.path)); break; // sent by the desktop app after its folder picker
          case 'setHardwareAlias': session.setHardwareAlias(m.name, m.device ?? null); break;
          case 'saveProjectSettings': session.saveProjectSettings(m.settings ?? {}); break;
          case 'saveSettings': ws.send(JSON.stringify({ type: 'settings', settings: session.saveSettings(m.settings ?? {}) })); break;
          case 'readFile': ws.send(JSON.stringify({ type: 'file', path: m.path, text: session.readFile(m.path) })); break;
          case 'saveFile': session.saveFile(m.path, m.text); ws.send(JSON.stringify({ type: 'saved', path: m.path })); break;
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', action: m.type, message: e.message }));
      }
    });
  });

  await new Promise((res, rej) => { server.once('error', rej); server.listen(port, '127.0.0.1', res); });
  return { server, session, port: server.address().port, close: async () => { await session.dispose(); for (const c of wss.clients) c.terminate(); await new Promise((r) => server.close(r)); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer({ port: Number(process.env.PORT) || 5317 });
  console.log(`FTC BIOBUZZ simulator PoC running at http://localhost:${s.port}`);
}
