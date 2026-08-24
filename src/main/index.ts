import { app, safeStorage } from 'electron';
import started from 'electron-squirrel-startup';
import { join, resolve } from 'node:path';

import {
  DeskyWindowManager,
  handleApplicationScheme,
  registerApplicationScheme,
} from './companion-window';
import { registerIpc } from './ipc';
import { DesktopStateStore } from './desktop-state-store';
import { OpenClawAdapterHost } from './openclaw/host';
import { SecureVault } from './openclaw/secure-vault';
import { AgentAdapterRegistry } from './adapters/registry';
import { OpenClawRuntime } from './adapters/openclaw-runtime';
import { getDistributionProfile } from './capabilities';

let windows: DeskyWindowManager | undefined;

if (started) {
  app.quit();
}

app.setName('Desky');
if (process.env.DESKY_VISUAL_TEST_USER_DATA) {
  app.setPath('userData', resolve(process.env.DESKY_VISUAL_TEST_USER_DATA));
}
registerApplicationScheme();

void app.whenReady().then(() => {
  handleApplicationScheme();
  const openClaw = new OpenClawAdapterHost(
    new SecureVault(join(app.getPath('userData'), 'secure-connections.json'), safeStorage),
    app.getVersion(),
    process.platform,
  );
  const adapters = new AgentAdapterRegistry(
    [new OpenClawRuntime(openClaw)],
    'openclaw',
    getDistributionProfile(),
  );
  const windowManager = new DeskyWindowManager(
    new DesktopStateStore(join(app.getPath('userData'), 'desktop-state.json')),
  );
  windows = windowManager;
  registerIpc(adapters, windowManager);
  windowManager.createInitialWindows();

  app.on('before-quit', () => {
    windows?.dispose();
    void adapters.dispose();
  });

  app.on('activate', () => {
    windowManager.openAmbient();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !windows?.hasRecoverySurface()) app.quit();
});
