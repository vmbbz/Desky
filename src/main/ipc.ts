import { app, BrowserWindow, ipcMain } from 'electron';

import type { WindowAction } from '../shared/runtime';
import { getDistributionProfile } from './capabilities';

const runtimeInfoChannel = 'desky:runtime-info';
const windowActionChannel = 'desky:window-action';

function isWindowAction(value: unknown): value is WindowAction {
  return value === 'close' || value === 'minimize';
}

export function registerIpc(): void {
  ipcMain.handle(runtimeInfoChannel, () => ({
    distributionProfile: getDistributionProfile(),
    platform: process.platform,
    version: app.getVersion(),
  }));

  ipcMain.on(windowActionChannel, (event, action: unknown) => {
    if (!isWindowAction(action)) return;

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    if (action === 'close') window.close();
    if (action === 'minimize') window.minimize();
  });
}

export const ipcChannels = {
  runtimeInfo: runtimeInfoChannel,
  windowAction: windowActionChannel,
} as const;
