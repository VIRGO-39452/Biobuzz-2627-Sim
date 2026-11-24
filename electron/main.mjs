// Desktop shell: starts the local simulator server inside this process and shows the dashboard in a window.
// Nothing leaves the machine: the server listens on 127.0.0.1 only, on a port chosen at startup.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { startServer } from '../server/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const smokeRun = process.argv.includes('--smoke-run'); // also load the bundled example, compile it and run an OpMode
const smoke = smokeRun || process.argv.includes('--smoke'); // start, check the dashboard came up, print a report, quit
let server = null, win = null;

async function main() {
  if (!existsSync(join(here, '..', 'ui', 'dist', 'index.html'))) {
    dialog.showErrorBox('FTC BIOBUZZ Simulator', 'The dashboard has not been built yet. Run "npm run build" in the project folder, then start the app again.');
    app.exit(1); return;
  }
  // Saved projects live in the app's own data folder, so they survive updates to the simulator itself.
  server = await startServer({ port: 0, workDir: join(app.getPath('userData'), 'workspaces') });
  win = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1000, minHeight: 640, backgroundColor: '#14171c', show: !smoke, title: 'FTC BIOBUZZ Simulator',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false);
  const origin = `http://127.0.0.1:${server.port}`;
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) e.preventDefault(); }); // the window only ever shows the local dashboard
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open an FTC Android Studio project folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  await win.loadURL(origin);
  if (smoke) {
    await new Promise((r) => setTimeout(r, 6000));
    const report = await win.webContents.executeJavaScript(`({ title: document.title, header: document.querySelector('header h1')?.textContent, status: document.querySelector('header .note')?.textContent,
      desktop: !!window.ftcsim?.desktop, folderButton: [...document.querySelectorAll('header button')].some((b) => b.textContent.includes('Open project folder')),
      viewerLoaded: !!window.viewer3d?.info?.loaded, panels: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim().slice(0, 24)) })`);
    if (smokeRun) {
      report.run = await win.webContents.executeJavaScript(`(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms)), btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
        const state = () => document.querySelector('.state')?.textContent.trim();
        btn('Load goBILDA example').click();
        for (let i = 0; i < 100 && !document.querySelector('h2 .ok, h2 .bad'); i++) await w(200);
        const compiled = document.querySelector('h2 .ok, h2 .bad')?.textContent;
        btn('INIT').click(); for (let i = 0; i < 50 && !/^INIT/.test(state()); i++) await w(200);
        const init = state(), telemetryAtInit = document.querySelector('.telemetry').textContent.trim();
        btn('PLAY').click(); await w(600);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true })); await w(900);
        const running = state(), telemetry = document.querySelector('.telemetry').textContent.trim(), position = document.querySelector('.kv span:nth-child(2)').textContent;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true }));
        btn('STOP').click(); await w(800);
        return { compiled, init, telemetryAtInit, running, telemetry, position, stopped: state(), firstLog: document.querySelector('.console div')?.textContent.slice(0, 90) };
      })()`);
    }
    console.log('SMOKE ' + JSON.stringify(report));
    app.quit();
  }
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { server?.close().catch(() => {}); });
