import type { BrowserWindowConstructorOptions } from 'electron';

import type { DesktopRectangle, SurfaceKind } from '../shared/runtime';

function secureWebPreferences(preload: string): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    focusOnNavigation: false,
  };
}

export function createWindowOptions(
  surface: SurfaceKind,
  preload: string,
  ambientBounds?: DesktopRectangle,
): BrowserWindowConstructorOptions {
  if (surface === 'ambient') {
    return {
      width: ambientBounds?.width ?? 420,
      height: ambientBounds?.height ?? 580,
      x: ambientBounds?.x,
      y: ambientBounds?.y,
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
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
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
    title: 'Deskii Control Center',
    frame: true,
    transparent: false,
    backgroundColor: '#0a0e17',
    hasShadow: true,
    resizable: true,
    webPreferences: secureWebPreferences(preload),
  };
}
