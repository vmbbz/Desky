import { writeFile } from 'node:fs/promises';

import { app, BrowserWindow, session } from 'electron';

async function captureVisualTest(window: BrowserWindow, outputPath: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
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

  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
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
