import { describe, expect, it } from 'vitest';

import { createWindowOptions } from '../src/main/window-options';
import { surfaceKinds, windowActions } from '../src/shared/runtime';

describe('desktop surface contract', () => {
  it('keeps the ambient companion transparent, bounded, and outside the taskbar', () => {
    expect(createWindowOptions('ambient', 'preload.js')).toMatchObject({
      width: 420,
      height: 580,
      minWidth: 420,
      maxWidth: 420,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: 'preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        focusOnNavigation: false,
      },
    });
  });

  it('keeps the control center standard, resizable, and non-privileged', () => {
    expect(createWindowOptions('control-center', 'preload.js')).toMatchObject({
      width: 760,
      height: 720,
      minWidth: 600,
      minHeight: 560,
      frame: true,
      transparent: false,
      resizable: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        focusOnNavigation: false,
      },
    });
    expect(createWindowOptions('control-center', 'preload.js').alwaysOnTop).not.toBe(true);
  });

  it('pins the surface identities and semantic escape routes', () => {
    expect(surfaceKinds).toEqual(['ambient', 'control-center']);
    expect(windowActions).toContain('open-control-center');
    expect(windowActions).toContain('show-ambient');
    expect(windowActions).toContain('toggle-full-click-through');
    expect(windowActions).toContain('reset-ambient-position');
  });

  it('applies a restored ambient position before the window becomes visible', () => {
    expect(createWindowOptions('ambient', 'preload.js', {
      x: 1420,
      y: 420,
      width: 420,
      height: 580,
    })).toMatchObject({ x: 1420, y: 420, width: 420, height: 580, show: false });
  });
});
