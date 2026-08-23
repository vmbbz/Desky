import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import {
  app,
  BrowserWindow,
  protocol,
  screen,
  session,
  type Display,
  type WebContents,
} from 'electron';

import type {
  AmbientDragCommand,
  AmbientPointerRegion,
  AmbientSurfaceState,
  DesktopRectangle,
  SurfaceKind,
  WindowAction,
} from '../shared/runtime';
import { DesktopControls } from './desktop-controls';
import {
  clampBoundsToDisplays,
  defaultAmbientBounds,
  deriveAmbientEdgeLayout,
  displayArrangementKey,
  resolveArrangementBounds,
  type DisplayGeometry,
} from './desktop-placement';
import {
  recordPlacement,
  type DesktopState,
  type DesktopStateStore,
} from './desktop-state-store';
import { createWindowOptions } from './window-options';

const applicationScheme = 'desky';
const ambientSize = { width: 420, height: 580 };
export const ambientStateChannel = 'desky:ambient-state';
export const ambientPointerRegionChannel = 'desky:ambient-pointer-region';
export const ambientDragChannel = 'desky:ambient-drag';
export const ambientAvatarYawChannel = 'desky:ambient-avatar-yaw';

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
  const initialWindowBounds = window.getBounds();
  let motionPreferenceError: string | null = null;
  const visualMotionPreference = process.env.DESKY_VISUAL_TEST_MOTION_PREFERENCE;
  if (visualMotionPreference === 'system' || visualMotionPreference === 'full' || visualMotionPreference === 'reduced') {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        try {
          await window.desky.setMotionPreference(${JSON.stringify(visualMotionPreference)});
          return null;
        } catch (error) {
          return String(error);
        }
      })()`);
      if (typeof result === 'string' && result.length > 0) motionPreferenceError = result;
    } catch (error) {
      motionPreferenceError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const requestedWaitMs = Number.parseInt(process.env.DESKY_VISUAL_TEST_WAIT_MS ?? '', 10);
  const waitMs = Number.isSafeInteger(requestedWaitMs)
    ? Math.max(0, Math.min(requestedWaitMs, 60_000))
    : 8_000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'draft') {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      document.querySelector('.ambient-launcher button')?.click();
      await wait(120);
      const input = document.querySelector('#ambient-prompt');
      if (input instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'A draft that must survive collapse');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(120);
        document.querySelector('.ambient-launcher button')?.click();
        await wait(120);
      }
    })()`);
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'jump') {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const avatar = document.querySelector('.ambient-avatar-hitbox');
      avatar?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await wait(500);
    })()`);
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'manipulation') {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const avatar = document.querySelector('.ambient-avatar-hitbox');
      if (!(avatar instanceof HTMLButtonElement)) throw new Error('Avatar hit target is unavailable');
      avatar.setPointerCapture = () => undefined;
      avatar.hasPointerCapture = () => false;
      const bounds = avatar.getBoundingClientRect();
      const dispatch = (type, screenX, screenY, clientX, clientY, shiftKey = false) => {
        avatar.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 7,
          screenX,
          screenY,
          clientX,
          clientY,
          shiftKey,
        }));
      };
      dispatch('pointerdown', 100, 100, bounds.left + 2, bounds.top + 2);
      dispatch('pointermove', 148, 132, bounds.left + 50, bounds.top + 34);
      dispatch('pointerup', 148, 132, bounds.left + 50, bounds.top + 34);
      dispatch('pointerdown', 200, 200, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      dispatch('pointermove', 312, 200, bounds.left + bounds.width / 2 + 112, bounds.top + bounds.height / 2);
      dispatch('pointerup', 312, 200, bounds.left + bounds.width / 2 + 112, bounds.top + bounds.height / 2);
      await wait(180);
    })()`);
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'idle-cycle') {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const observed = [];
      let previous = '';
      const deadline = performance.now() + 50_000;
      while (performance.now() < deadline) {
        const stage = document.querySelector('.avatar-stage');
        const canvas = stage?.querySelector('canvas');
        const program = canvas?.dataset.motionActiveProgram ?? '';
        if (program && !previous) observed.push(program);
        previous = program;
        if (stage instanceof HTMLElement) stage.dataset.observedPrograms = observed.join(',');
        if (observed.length >= 3 && observed.at(-1) === 'celebration-fist-pump') {
          await wait(1_000);
          break;
        }
        await wait(50);
      }
    })()`);
  }
  const rendererDiagnostic = await window.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    surface: document.body?.dataset.deskySurface ?? 'unknown',
    bodyText: document.body?.innerText?.slice(0, 1000) ?? '',
    rootChildren: document.querySelector('#root')?.childElementCount ?? -1,
    documentFocused: document.hasFocus(),
    bubblePlacement: document.querySelector('.ambient-companion')?.dataset.bubblePlacement ?? null,
    horizontalPlacement: document.querySelector('.ambient-companion')?.dataset.horizontalPlacement ?? null,
    interactiveRegions: document.querySelectorAll('[data-desky-interactive="true"]').length,
    recoveryAvailable: document.querySelector('.ambient-companion')?.dataset.recoveryAvailable ?? null,
    bubbleVisible: document.querySelector('.ambient-companion')?.dataset.bubbleVisible ?? null,
    composerExpanded: document.querySelector('.ambient-companion')?.dataset.composerExpanded ?? null,
    draftValue: document.querySelector('#ambient-prompt')?.value ?? null,
    launcherLabel: document.querySelector('.ambient-launcher button')?.textContent?.trim() ?? null,
    avatarState: document.querySelector('.avatar-stage')?.dataset.avatarState ?? null,
    avatarTextureCount: document.querySelector('.avatar-stage')?.dataset.avatarTextureCount ?? null,
    motionFrame: document.querySelector('.avatar-stage canvas')?.dataset.motionFrame ?? null,
    motionElapsed: document.querySelector('.avatar-stage canvas')?.dataset.motionElapsed ?? null,
    motionMode: document.querySelector('.avatar-stage canvas')?.dataset.motionMode ?? null,
    motionStateClip: document.querySelector('.avatar-stage canvas')?.dataset.motionStateClip ?? null,
    motionActiveProgram: document.querySelector('.avatar-stage canvas')?.dataset.motionActiveProgram ?? null,
    motionActiveCue: document.querySelector('.avatar-stage canvas')?.dataset.motionActiveCue ?? null,
    motionPendingCues: document.querySelector('.avatar-stage canvas')?.dataset.motionPendingCues ?? null,
    motionReduced: document.querySelector('.avatar-stage canvas')?.dataset.motionReduced ?? null,
    motionClipError: document.querySelector('.avatar-stage canvas')?.dataset.motionClipError ?? null,
    motionObservedPrograms: document.querySelector('.avatar-stage')?.dataset.observedPrograms ?? null,
    motionPreferenceError: ${JSON.stringify(motionPreferenceError)},
    avatarYawDegrees: document.querySelector('.ambient-companion')?.dataset.avatarYawDegrees ?? null
  })`) as Record<string, unknown>;
  const diagnostic = {
    ...rendererDiagnostic,
    initialWindowBounds,
    nativeWindowBounds: window.getBounds(),
  };
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
  const visualTestState = process.env.DESKY_VISUAL_TEST_STATE;
  if (visualTestState) url.searchParams.set('visualState', visualTestState);
  return url.toString();
}

export class DeskyWindowManager {
  private ambient?: BrowserWindow;

  private controlCenter?: BrowserWindow;

  private desktopState: DesktopState;

  private readonly desktopControls: DesktopControls;

  private fullClickThrough = false;

  private pointerRegion: AmbientPointerRegion = 'transparent';

  private moveSaveTimer?: NodeJS.Timeout;

  private ambientDrag?: {
    contentsId: number;
    pointerX: number;
    pointerY: number;
    startBounds: DesktopRectangle;
  };

  private activeDisplayArrangement?: string;

  private readonly surfaces = new Map<number, SurfaceKind>();

  constructor(private readonly stateStore: DesktopStateStore) {
    this.desktopState = stateStore.load();
    this.desktopControls = new DesktopControls({
      getState: () => ({
        alwaysOnTop: this.desktopState.alwaysOnTop,
        fullClickThrough: this.fullClickThrough,
      }),
      hideAmbient: () => this.hideAmbient(),
      openAmbient: () => { this.openAmbient(); },
      openControlCenter: () => { this.openControlCenter(); },
      resetPlacement: () => this.resetAmbientPosition(),
      toggleAlwaysOnTop: () => this.toggleAlwaysOnTop(),
      toggleFullClickThrough: () => this.toggleFullClickThrough(),
    });
  }

  createInitialWindows(): void {
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    this.desktopControls.start();
    this.activeDisplayArrangement = displayArrangementKey(this.displayGeometries());
    screen.on('display-added', this.handleDisplayChange);
    screen.on('display-removed', this.handleDisplayChange);
    screen.on('display-metrics-changed', this.handleDisplayChange);
    const ambient = this.openAmbient();
    if (process.env.DESKY_VISUAL_TEST_EDGE === 'top-left') {
      const primary = screen.getPrimaryDisplay().workArea;
      ambient.setBounds({
        x: primary.x + 12,
        y: primary.y + 12,
        ...ambientSize,
      }, false);
    }
    if (process.env.DESKY_VISUAL_TEST_SURFACE === 'control-center') {
      this.openControlCenter();
    }
    const behaviorTestPath = process.env.DESKY_DESKTOP_BEHAVIOR_TEST_PATH;
    if (behaviorTestPath) {
      const controlCenter = this.openControlCenter();
      void this.captureDesktopBehavior(ambient, controlCenter, behaviorTestPath);
    }
  }

  openAmbient(): BrowserWindow {
    if (this.ambient && !this.ambient.isDestroyed()) {
      this.showAmbientWindow(this.ambient);
      return this.ambient;
    }
    const window = this.createWindow('ambient');
    this.ambient = window;
    window.on('closed', () => {
      this.ambientDrag = undefined;
      if (this.ambient === window) this.ambient = undefined;
      this.publishAmbientState();
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

  getAmbientState(): AmbientSurfaceState {
    const displays = this.displayGeometries();
    const arrangement = displayArrangementKey(displays);
    const bounds = this.ambient && !this.ambient.isDestroyed()
      ? this.ambient.getBounds()
      : this.restoredAmbientBounds(displays, arrangement);
    const clamped = clampBoundsToDisplays(bounds, displays);
    const edgeLayout = deriveAmbientEdgeLayout(clamped.bounds, clamped.display.workArea);
    return {
      alwaysOnTop: this.desktopState.alwaysOnTop,
      avatarYawDegrees: this.desktopState.avatarYawDegrees,
      bounds: clamped.bounds,
      bubblePlacement: edgeLayout.bubblePlacement,
      displayKey: arrangement,
      fullClickThrough: this.fullClickThrough,
      horizontalPlacement: edgeLayout.horizontalPlacement,
      recoveryAvailable: this.desktopControls.hasRecoverySurface,
      recoveryShortcut: this.desktopControls.recoveryShortcut,
      recoveryShortcutRegistered: this.desktopControls.isShortcutRegistered,
      trayAvailable: this.desktopControls.isTrayAvailable,
      visible: Boolean(
        this.ambient
        && !this.ambient.isDestroyed()
        && this.ambient.isVisible(),
      ),
      workArea: clamped.display.workArea,
    };
  }

  setPointerRegion(contents: WebContents, region: AmbientPointerRegion): void {
    if (this.surfaceFor(contents) !== 'ambient') return;
    if (this.ambientDrag?.contentsId === contents.id) return;
    this.pointerRegion = region;
    this.applyPointerPolicy();
  }

  dragAmbient(contents: WebContents, command: AmbientDragCommand): void {
    if (this.surfaceFor(contents) !== 'ambient'
      || !this.ambient
      || this.ambient.isDestroyed()) return;
    if (command.phase === 'start') {
      this.ambientDrag = {
        contentsId: contents.id,
        pointerX: command.pointerX,
        pointerY: command.pointerY,
        startBounds: this.ambient.getBounds(),
      };
      this.pointerRegion = 'interactive';
      this.applyPointerPolicy();
      return;
    }
    const drag = this.ambientDrag;
    if (!drag || drag.contentsId !== contents.id) return;
    const candidate = {
      ...drag.startBounds,
      x: drag.startBounds.x + Math.round(command.pointerX - drag.pointerX),
      y: drag.startBounds.y + Math.round(command.pointerY - drag.pointerY),
    };
    const clamped = clampBoundsToDisplays(candidate, this.displayGeometries()).bounds;
    this.ambient.setBounds(clamped, false);
    if (command.phase === 'end') {
      this.ambientDrag = undefined;
      this.persistAmbientPlacement();
      this.publishAmbientState();
    }
  }

  setAvatarYaw(contents: WebContents, value: number): void {
    if (this.surfaceFor(contents) !== 'ambient' || !Number.isFinite(value)) return;
    const normalized = ((value + 180) % 360 + 360) % 360 - 180;
    this.desktopState = {
      ...this.desktopState,
      avatarYawDegrees: Math.round(normalized * 10) / 10,
    };
    this.stateStore.save(this.desktopState);
    this.publishAmbientState();
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
    if (action === 'hide-ambient') {
      this.hideAmbient();
      return;
    }
    if (action === 'reset-ambient-position') {
      this.resetAmbientPosition();
      return;
    }
    if (action === 'toggle-always-on-top') {
      this.toggleAlwaysOnTop();
      return;
    }
    if (action === 'toggle-full-click-through') {
      this.toggleFullClickThrough();
      return;
    }
    const window = BrowserWindow.fromWebContents(contents);
    if (!window) return;
    if (action === 'close') window.close();
    if (action === 'minimize') window.minimize();
  }

  hasRecoverySurface(): boolean {
    return this.desktopControls.hasRecoverySurface;
  }

  dispose(): void {
    if (this.moveSaveTimer) clearTimeout(this.moveSaveTimer);
    this.ambientDrag = undefined;
    this.persistAmbientPlacement();
    screen.removeListener('display-added', this.handleDisplayChange);
    screen.removeListener('display-removed', this.handleDisplayChange);
    screen.removeListener('display-metrics-changed', this.handleDisplayChange);
    this.desktopControls.dispose();
  }

  private createWindow(surface: SurfaceKind): BrowserWindow {
    const initialBounds = surface === 'ambient'
      ? this.restoredAmbientBounds(this.displayGeometries())
      : undefined;
    const window = new BrowserWindow(
      createWindowOptions(surface, MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, initialBounds),
    );
    const contentsId = window.webContents.id;
    this.surfaces.set(contentsId, surface);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('destroyed', () => this.surfaces.delete(contentsId));
    if (surface === 'ambient') {
      window.setAlwaysOnTop(this.desktopState.alwaysOnTop);
      window.on('minimize', () => {
        setImmediate(() => {
          if (this.ambient === window && !window.isDestroyed()) this.showAmbientWindow(window);
        });
      });
      window.on('move', () => this.schedulePlacementSave());
      window.on('show', () => this.publishAmbientState());
      window.on('hide', () => this.publishAmbientState());
      window.webContents.on('context-menu', () => {
        this.desktopControls.openContextMenu(window);
      });
    }
    void window.loadURL(rendererUrl(surface));
    window.once('ready-to-show', () => {
      if (surface === 'ambient') {
        this.applyPointerPolicy();
        this.showAmbientWindow(window);
      }
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

  private readonly handleDisplayChange = (): void => {
    const displays = this.displayGeometries();
    const nextArrangement = displayArrangementKey(displays);
    const storedPlacement = this.desktopState.placements[nextArrangement];
    if (this.ambient && !this.ambient.isDestroyed()
      && this.activeDisplayArrangement !== nextArrangement
      && storedPlacement) {
      this.ambient.setBounds(
        resolveArrangementBounds(this.ambient.getBounds(), displays, storedPlacement),
        false,
      );
    } else {
      this.clampAmbientToWorkArea(displays);
    }
    this.activeDisplayArrangement = nextArrangement;
    this.persistAmbientPlacement(displays, nextArrangement);
    this.publishAmbientState();
  };

  private displayGeometries(): DisplayGeometry[] {
    return screen.getAllDisplays().map((display: Display) => ({
      id: String(display.id),
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    }));
  }

  private restoredAmbientBounds(
    displays: DisplayGeometry[],
    arrangement = displayArrangementKey(displays),
  ): DesktopRectangle {
    const placement = this.desktopState.placements[arrangement];
    if (placement) {
      return clampBoundsToDisplays({ ...ambientSize, x: placement.x, y: placement.y }, displays).bounds;
    }
    const primaryId = String(screen.getPrimaryDisplay().id);
    const primary = displays.find((display) => display.id === primaryId) ?? displays[0];
    if (!primary) throw new Error('Desky requires at least one active display');
    return defaultAmbientBounds(ambientSize, primary);
  }

  private schedulePlacementSave(): void {
    if (this.moveSaveTimer) clearTimeout(this.moveSaveTimer);
    this.moveSaveTimer = setTimeout(() => {
      this.moveSaveTimer = undefined;
      this.clampAmbientToWorkArea();
      this.persistAmbientPlacement();
      this.publishAmbientState();
    }, 200);
  }

  private persistAmbientPlacement(
    displays = this.displayGeometries(),
    arrangement = displayArrangementKey(displays),
  ): void {
    if (!this.ambient || this.ambient.isDestroyed()) return;
    const clamped = clampBoundsToDisplays(this.ambient.getBounds(), displays).bounds;
    this.desktopState = recordPlacement(this.desktopState, arrangement, clamped);
    this.activeDisplayArrangement = arrangement;
    this.stateStore.save(this.desktopState);
  }

  private clampAmbientToWorkArea(displays = this.displayGeometries()): void {
    if (!this.ambient || this.ambient.isDestroyed()) return;
    const current = this.ambient.getBounds();
    const clamped = clampBoundsToDisplays(current, displays).bounds;
    if (current.x !== clamped.x || current.y !== clamped.y) {
      this.ambient.setBounds(clamped, false);
    }
  }

  private resetAmbientPosition(): void {
    const window = this.openAmbient();
    const displays = this.displayGeometries();
    const primaryId = String(screen.getPrimaryDisplay().id);
    const primary = displays.find((display) => display.id === primaryId) ?? displays[0];
    if (!primary) return;
    window.setBounds(defaultAmbientBounds(ambientSize, primary), false);
    this.persistAmbientPlacement();
    this.publishAmbientState();
  }

  private showAmbientWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    this.clampAmbientToWorkArea();
    window.setAlwaysOnTop(this.desktopState.alwaysOnTop);
    window.showInactive();
    if (this.desktopState.alwaysOnTop) window.moveTop();
    this.applyPointerPolicy();
    this.publishAmbientState();
  }

  private hideAmbient(): void {
    if (this.ambient && !this.ambient.isDestroyed()) this.ambient.hide();
    this.publishAmbientState();
  }

  private toggleAlwaysOnTop(): void {
    this.desktopState = {
      ...this.desktopState,
      alwaysOnTop: !this.desktopState.alwaysOnTop,
    };
    this.stateStore.save(this.desktopState);
    if (this.ambient && !this.ambient.isDestroyed()) {
      this.ambient.setAlwaysOnTop(this.desktopState.alwaysOnTop);
    }
    this.desktopControls.refreshMenu();
    this.publishAmbientState();
  }

  private toggleFullClickThrough(): void {
    if (!this.fullClickThrough && !this.desktopControls.hasRecoverySurface) {
      this.openControlCenter();
      return;
    }
    this.fullClickThrough = !this.fullClickThrough;
    this.pointerRegion = 'transparent';
    this.applyPointerPolicy();
    this.desktopControls.refreshMenu();
    this.publishAmbientState();
  }

  private applyPointerPolicy(): void {
    if (!this.ambient || this.ambient.isDestroyed()) return;
    if (this.fullClickThrough) {
      this.ambient.setIgnoreMouseEvents(true);
      return;
    }
    this.ambient.setIgnoreMouseEvents(this.pointerRegion === 'transparent', { forward: true });
  }

  private publishAmbientState(): void {
    const state = this.getAmbientState();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ambientStateChannel, state);
    }
  }

  private async captureDesktopBehavior(
    ambient: BrowserWindow,
    controlCenter: BrowserWindow,
    outputPath: string,
  ): Promise<void> {
    const waitForLoad = async (window: BrowserWindow) => {
      if (!window.webContents.isLoadingMainFrame()) return;
      await new Promise<void>((resolve) => {
        window.webContents.once('did-finish-load', () => resolve());
      });
    };
    await Promise.all([waitForLoad(ambient), waitForLoad(controlCenter)]);
    controlCenter.show();
    controlCenter.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const focusedBefore = BrowserWindow.getFocusedWindow()?.id ?? null;

    ambient.hide();
    this.openAmbient();
    this.publishAmbientState();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const focusedAfterInactiveShow = BrowserWindow.getFocusedWindow()?.id ?? null;

    ambient.minimize();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ambientRecoveredFromMinimize = !ambient.isMinimized() && ambient.isVisible();
    const focusedAfterMinimizeRecovery = BrowserWindow.getFocusedWindow()?.id ?? null;

    const workArea = screen.getPrimaryDisplay().workArea;
    ambient.setBounds({
      x: workArea.x - ambientSize.width - 500,
      y: workArea.y - ambientSize.height - 500,
      ...ambientSize,
    }, false);
    this.clampAmbientToWorkArea();
    const clampedBounds = ambient.getBounds();
    const focusedAfterClamp = BrowserWindow.getFocusedWindow()?.id ?? null;

    this.toggleFullClickThrough();
    const fullClickThroughEnabled = this.getAmbientState().fullClickThrough;
    this.toggleFullClickThrough();
    const fullClickThroughRecovered = !this.getAmbientState().fullClickThrough;
    const ambientDocumentFocused = await ambient.webContents.executeJavaScript('document.hasFocus()') as boolean;
    const controlDocumentFocused = await controlCenter.webContents.executeJavaScript('document.hasFocus()') as boolean;

    await writeFile(outputPath, `${JSON.stringify({
      ambientDocumentFocused,
      clampedBounds,
      controlDocumentFocused,
      controlWindowId: controlCenter.id,
      focusPreservedAfterClamp: focusedAfterClamp === controlCenter.id,
      focusPreservedAfterInactiveShow: focusedAfterInactiveShow === controlCenter.id,
      focusPreservedAfterMinimizeRecovery: focusedAfterMinimizeRecovery === controlCenter.id,
      focusedBeforeWasControlCenter: focusedBefore === controlCenter.id,
      fullClickThroughEnabled,
      fullClickThroughRecovered,
      recoveryAvailable: this.desktopControls.hasRecoverySurface,
      ambientRecoveredFromMinimize,
      shortcutRegistered: this.desktopControls.isShortcutRegistered,
      trayAvailable: this.desktopControls.isTrayAvailable,
      workArea,
    }, null, 2)}\n`, 'utf8');
    app.quit();
  }
}
