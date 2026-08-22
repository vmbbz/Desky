import type { BrowserWindowConstructorOptions } from 'electron';

import type { SurfaceKind } from '../shared/runtime';

function secureWebPreferences(preload: string): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

export function createWindowOptions(
  surface: SurfaceKind,
  preload: string,
): BrowserWindowConstructorOptions {
  if (surface === 'ambient') {
    return {
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
      skipTaskbar: true,
      webPreferences: secureWebPreferences(preload),
    };
  }

  return {
    width: 760,
    height: 720,
    minWidth: 600,
    minHeight: 560,
    show: false,
    title: 'Desky Control Center',
    frame: true,
    transparent: false,
    backgroundColor: '#0a0e17',
    hasShadow: true,
    resizable: true,
    webPreferences: secureWebPreferences(preload),
  };
}
