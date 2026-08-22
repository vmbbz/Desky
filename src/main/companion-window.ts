import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import { app, BrowserWindow, protocol, session } from 'electron';

const applicationScheme = 'desky';

export function registerApplicationScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: applicationScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  }]);
}

export function handleApplicationScheme(): void {
  const rendererRoot = join(app.getAppPath(), '.webpack', 'renderer');
  void protocol.handle(applicationScheme, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const relativePath = normalize(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    const target = join(rendererRoot, relativePath || 'index.html');
    if (target !== rendererRoot && !target.startsWith(`${rendererRoot}${sep}`)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const contents = await readFile(target);
      const contentType = extname(target) === '.html'
        ? 'text/html; charset=utf-8'
        : extname(target) === '.js'
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream';
      return new Response(new Uint8Array(contents), {
        headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function captureVisualTest(window: BrowserWindow, outputPath: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const diagnostic = await window.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
    rootChildren: document.querySelector('#root')?.childElementCount ?? -1
  })`) as unknown;
  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
  await writeFile(`${outputPath}.json`, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  app.quit();
}

export function createCompanionWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 580,
    minWidth: 420,
    minHeight: 580,
    maxWidth: 420,
    maxHeight: 580,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  void window.loadURL(app.isPackaged ? `${applicationScheme}://app/main_window/index.html` : MAIN_WINDOW_WEBPACK_ENTRY);
  window.once('ready-to-show', () => {
    window.show();
    const visualTestPath = process.env.DESKY_VISUAL_TEST_PATH;
    if (visualTestPath) void captureVisualTest(window, visualTestPath);
  });

  if (process.env.DESKY_OPEN_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}
