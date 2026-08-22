import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import {
  app,
  BrowserWindow,
  protocol,
  session,
  type WebContents,
} from 'electron';

import type { SurfaceKind, WindowAction } from '../shared/runtime';
import { createWindowOptions } from './window-options';

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

async function captureVisualTest(
  window: BrowserWindow,
  surface: SurfaceKind,
  outputPath: string,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const diagnostic = await window.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    surface: document.body?.dataset.deskySurface ?? 'unknown',
    bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
    rootChildren: document.querySelector('#root')?.childElementCount ?? -1
  })`) as unknown;
  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
  await writeFile(`${outputPath}.json`, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  app.quit();
}

function rendererUrl(surface: SurfaceKind): string {
  const base = app.isPackaged
    ? `${applicationScheme}://app/main_window/index.html`
    : MAIN_WINDOW_WEBPACK_ENTRY;
  const url = new URL(base);
  url.searchParams.set('surface', surface);
  return url.toString();
}

export class DeskyWindowManager {
  private ambient?: BrowserWindow;

  private controlCenter?: BrowserWindow;

  private readonly surfaces = new Map<number, SurfaceKind>();

  createInitialWindows(): void {
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    this.openAmbient();
    if (process.env.DESKY_VISUAL_TEST_SURFACE === 'control-center') {
      this.openControlCenter();
    }
  }

  openAmbient(): BrowserWindow {
    if (this.ambient && !this.ambient.isDestroyed()) {
      this.ambient.showInactive();
      return this.ambient;
    }
    const window = this.createWindow('ambient');
    this.ambient = window;
    window.on('closed', () => {
      if (this.ambient === window) this.ambient = undefined;
    });
    return window;
  }

  openControlCenter(): BrowserWindow {
    if (this.controlCenter && !this.controlCenter.isDestroyed()) {
      this.controlCenter.show();
      this.controlCenter.focus();
      return this.controlCenter;
    }
    const window = this.createWindow('control-center');
    this.controlCenter = window;
    window.on('closed', () => {
      if (this.controlCenter === window) this.controlCenter = undefined;
    });
    return window;
  }

  surfaceFor(contents: WebContents): SurfaceKind {
    return this.surfaces.get(contents.id) ?? 'control-center';
  }

  performAction(contents: WebContents, action: WindowAction): void {
    if (action === 'open-control-center') {
      this.openControlCenter();
      return;
    }
    if (action === 'show-ambient') {
      this.openAmbient();
      return;
    }
    const window = BrowserWindow.fromWebContents(contents);
    if (!window) return;
    if (action === 'close') window.close();
    if (action === 'minimize') window.minimize();
  }

  private createWindow(surface: SurfaceKind): BrowserWindow {
    const window = new BrowserWindow(
      createWindowOptions(surface, MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY),
    );
    const contentsId = window.webContents.id;
    this.surfaces.set(contentsId, surface);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('destroyed', () => this.surfaces.delete(contentsId));
    void window.loadURL(rendererUrl(surface));
    window.once('ready-to-show', () => {
      if (surface === 'ambient') window.showInactive();
      else window.show();
      const visualTestPath = process.env.DESKY_VISUAL_TEST_PATH;
      const visualTestSurface = process.env.DESKY_VISUAL_TEST_SURFACE ?? 'ambient';
      if (visualTestPath && visualTestSurface === surface) {
        void captureVisualTest(window, surface, visualTestPath);
      }
    });
    if (process.env.DESKY_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
    return window;
  }
}
