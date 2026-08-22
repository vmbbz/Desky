import {
  app,
  globalShortcut,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';

const recoveryShortcut = 'CommandOrControl+Shift+D';
const trayIconPng = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAITcAACE3ATNYn3oAAAIRSURBVFhH7VavUwJBFCbSoEl0hmK0aaQQbEZpNgjM6Mie2rQR+RMsztAw2qwGggV2bQTZuzERjed8O3dy+3a53YOj+c18Afbte9/u+3FbqfxjS7Dl7HgQiVZK/KY2peJhsaiypbgMQjFmIf8JQhHbyELxEiznvavFR5362BpwGEgR0WAOrpjk1xBO/XkDp2CheLc4L0Au7iJxSH07gU1M8oXpcCuuUCc0xkaok5cXPOXqRn4e0VgGVLHtfO124lDO4kTh0I0pu6N2XK037Ky147OpucfCEY35B5w+r9pzBaRsD+OuZW9KtDD7njVobAXVbpZNNgEnk8zadBg3awdrEf1nYy/hkMZWCKR4tRi7BVARznRwQWMnPb95wjkFhCLu9Ne30By9GetZGh1x+8VPqRGlS4BWI640yPm5JgB/GEY5AWwCgknPWwC6TRfgKEDQJSC77kpBIMWjJmCw5BeGUU4Am4BsDdjWs2SS3+sCItGiRpS5ArQu6MUdy/4scWBNAIYDNaLcKCCbe7q2gSh6TYAS4fgG+ExCZ+5BKSIaWwGFYRj7CnCMYJ38icZWQBpcw6gM5r4f8bWiG8ok3ow0pgZVjDlfxF2I2zVGsA2o0H2kwmi9PMC4VBF08vkgGU4rw1kB4hCFTk6RDKgxdexDFJxXzn2A1kH/ehQobmxc6BleFKpI8XjF4EqI33sNui/8AqdDYbHvIEQiAAAAAElFTkSuQmCC';

export interface DesktopControlState {
  alwaysOnTop: boolean;
  fullClickThrough: boolean;
}

export interface DesktopControlActions {
  getState: () => DesktopControlState;
  hideAmbient: () => void;
  openAmbient: () => void;
  openControlCenter: () => void;
  resetPlacement: () => void;
  toggleAlwaysOnTop: () => void;
  toggleFullClickThrough: () => void;
}

export class DesktopControls {
  private tray?: Tray;

  private shortcutRegistered = false;

  constructor(private readonly actions: DesktopControlActions) {}

  start(): void {
    try {
      this.shortcutRegistered = globalShortcut.register(
        recoveryShortcut,
        this.actions.toggleFullClickThrough,
      );
    } catch {
      this.shortcutRegistered = false;
    }
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${trayIconPng}`)
      .resize({ width: process.platform === 'darwin' ? 18 : 16 });
    if (!icon.isEmpty()) {
      try {
        this.tray = new Tray(icon);
        this.tray.setToolTip('Desky desktop companion');
        this.tray.on('click', this.actions.openAmbient);
      } catch {
        this.tray = undefined;
      }
    }
    this.refreshMenu();
  }

  get recoveryShortcut(): string {
    return recoveryShortcut;
  }

  get isShortcutRegistered(): boolean {
    return this.shortcutRegistered;
  }

  get hasRecoverySurface(): boolean {
    return Boolean(this.tray && !this.tray.isDestroyed()) || this.shortcutRegistered;
  }

  get isTrayAvailable(): boolean {
    return Boolean(this.tray && !this.tray.isDestroyed());
  }

  openContextMenu(window: BrowserWindow): void {
    this.buildMenu().popup({ window });
  }

  refreshMenu(): void {
    this.tray?.setContextMenu(this.buildMenu());
  }

  dispose(): void {
    if (this.shortcutRegistered) globalShortcut.unregister(recoveryShortcut);
    this.shortcutRegistered = false;
    this.tray?.destroy();
    this.tray = undefined;
  }

  private buildMenu(): Menu {
    const state = this.actions.getState();
    const template: MenuItemConstructorOptions[] = [
      { label: 'Show Desky', click: this.actions.openAmbient },
      { label: 'Open Control Center', click: this.actions.openControlCenter },
      { type: 'separator' },
      {
        label: 'Click through everything',
        type: 'checkbox',
        checked: state.fullClickThrough,
        click: this.actions.toggleFullClickThrough,
      },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: state.alwaysOnTop,
        click: this.actions.toggleAlwaysOnTop,
      },
      { label: 'Reset companion position', click: this.actions.resetPlacement },
      { label: 'Hide companion', click: this.actions.hideAmbient },
      { type: 'separator' },
      { label: 'Quit Desky', click: () => app.quit() },
    ];
    return Menu.buildFromTemplate(template);
  }
}
