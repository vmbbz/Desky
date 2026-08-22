import { app, BrowserWindow, safeStorage } from 'electron';
import started from 'electron-squirrel-startup';
import { join } from 'node:path';

import {
  DeskyWindowManager,
  handleApplicationScheme,
  registerApplicationScheme,
} from './companion-window';
import { registerIpc } from './ipc';
import { OpenClawAdapterHost } from './openclaw/host';
import { SecureVault } from './openclaw/secure-vault';

if (started) {
  app.quit();
}

app.setName('Desky');
registerApplicationScheme();

void app.whenReady().then(() => {
  handleApplicationScheme();
  const openClaw = new OpenClawAdapterHost(
    new SecureVault(join(app.getPath('userData'), 'secure-connections.json'), safeStorage),
    app.getVersion(),
    process.platform,
  );
  const windows = new DeskyWindowManager();
  registerIpc(openClaw, windows);
  windows.createInitialWindows();

  app.on('before-quit', () => {
    void openClaw.disconnect();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.openAmbient();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
