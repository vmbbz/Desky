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
import { createProfileRuntimes } from './adapters/profile-runtimes';
import { getDistributionProfile } from './capabilities';
import { CodexWorkspaceGrantBroker } from './codex/workspace-grants';
import { installBoundedApplicationShutdown } from './bounded-shutdown';

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
  const connectionsVault = new SecureVault(
    join(app.getPath('userData'), 'secure-connections.json'),
    safeStorage,
  );
  const openClaw = new OpenClawAdapterHost(
    connectionsVault,
    app.getVersion(),
    process.platform,
  );
  const distributionProfile = getDistributionProfile();
  const codexWorkspaceGrants = new CodexWorkspaceGrantBroker({
    protectedWritableRoots: [app.getPath('home')],
  });
  const runtimes = createProfileRuntimes({
    appVersion: app.getVersion(),
    openClaw,
    vault: connectionsVault,
    workspaceGrants: codexWorkspaceGrants,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    visualTestExercise: process.env.DESKY_VISUAL_TEST_EXERCISE,
  });
  const adapters = new AgentAdapterRegistry(
    runtimes,
    'openclaw',
    distributionProfile,
  );
  const windowManager = new DeskyWindowManager(
    new DesktopStateStore(join(app.getPath('userData'), 'desktop-state.json')),
  );
  windows = windowManager;
  registerIpc(adapters, windowManager, codexWorkspaceGrants);
  windowManager.createInitialWindows();

  installBoundedApplicationShutdown(app, async () => {
    windows?.dispose();
    codexWorkspaceGrants.clear();
    await adapters.dispose();
  });

  app.on('activate', () => {
    windowManager.openAmbient();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !windows?.hasRecoverySurface()) app.quit();
});
