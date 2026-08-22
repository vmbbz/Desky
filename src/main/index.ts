import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createCompanionWindow } from './companion-window';
import { registerIpc } from './ipc';

if (started) {
  app.quit();
}

app.setName('Desky');

void app.whenReady().then(() => {
  registerIpc();
  createCompanionWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createCompanionWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
