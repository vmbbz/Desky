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
const trayIconColorPng = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAAAAAAAAQCEeRdzAAAG4klEQVR4nJVXaWxc1RX+7vLmjT3OMBgnMZAArSA/UhpTLCBS/pBgJBDiB0GpkEAq2SokRAISQhCJxSUUBZAaQcuSsCZIEa3gBwjVRLQUBEmblgANIVLBDUmw4zixnfGMZ3t3qc7b5s14xqJXepo39757zznf+c5yGZKDMXDOpdFa0V8uBDqy87LWQuDHDNv4yvxfq8r5fCGa50LE59OQddmMWWtBi5f8ou/yazeu/fWly6++tjN3bq+1VloLZulUC9g2T9OaDX+9wpkzJ7777NO9+3a98tLpo8PHGGPcAoYWZUK4r/9t2x7fesPmux+UblpUS2VopdsKbBBs2q93ze9dcNEVV/Uvv2PdpqGntz708Y7fPwfGOAATIeCjtfHVF14eWLtx/eTkGMx0UTPGOakXHWRMe0Gx9SH+yTVjarY8XTRcyMwtT2x/Np3NdX/wzNZBLoSQXApplFbX3bVhw6q169efGR/xhJQOF1LEh9CZFuCcgTuBIjRpWrjE82x9T8QFwlxwYYy1+bGTeuDeLY8d/+Jf+4/8ZWivL9zNZNyb7r93cKaYt0QSa9ksCxkDCpMVHB8O+RRZHgkyFilX4sKfZsGEaIlOiCb3KlWsvPuB3/oK0PTPB1YN9PzkkgsKE1OGc8GbhZPFghscG87jv4cKSLk8Fp4IIGht0ZEVmN+bhdJ15JIoERTVmRn0Lu3rv3DZlX2+Aov7Lu9nTJAVZPws6wlqrhR6HYavw/+mSQPihssZcsygUtOQnM5LKJHgjtFGu6kOsfCynwUKOOmOc+nAduSqKY1FzGDNshyWznPqQR4zmEEZi+4OgSsv7sSecY0JxZHiLCBuC65EciW9GGNjps/yvU8sD0u7u7Awl8Ga3p45MhGHKkxiIFPCnilAOSl/f5s8AWsMixNRa+sZSp7CRY7E0lw23NTk/ETmE5xDiTQWp6ZxY9bDe3kOV8o6CRuE018WJKJgIsH8yHckTGms7M35kFtjwIltbYeF4zgoguOKjEFBVfG3IoObiIooaUV2yDoCIQcisgC+X9PGYH4qsCISTt+yJkX8uZgTQM0CS9Ian5z1oFlQSlq5QbaDP4JbKQ0dsibIchZMSFitYiV84X7S5LBeLVCCATXa7yk4MmAtGZdUoI5AAnoTlLAGJWJbfeEOZgrTyMzLAaYWCBcS2qN3QLpuiAal+mB/awIGczKyLII+yp9R/LNozhgw0YF//H0fNm1+CHfcfivu2bQJxpuB1VU88eR2DA19iLf/+CrmdaZgCImksFZIo4ULGhib4EPk45GRURw4sB9r77zNP1QQy5mLb745gm+/HYY2Gow5CW401pNmWbLBBQnByc2+T4nJpoLVq2/GxOlj+MPzr+DN3btw6+qbsfvN17FkyaXY9foLcNMOzpw8DleSCxKlfE4EEMCdTJnNCkTDaI3unvOxYsU1GBzcht9tfxHnnJPFticfhduRRa2SB+MU0rZRKObgABJwN1S5KBsmwovYTn5fdd31/nN28hRy3QsD5VQJUghwFpbusK5EMV/PLz+WAzZ4dKiADssyhIDnzYAzjlz3eVCq5FsspYTnaVSUheEWNVWvL81yol5CNpCFYGGN0eAZ4J9FD27KBo1IMv9YDQsvbD4BRwKnJ8vY/c4JP/ykK7BgyaLZHdL/GwVlQsFvxxL+aBqEgDYWM8riVMGjAoe0ZzE/mdpnccBGCDA7iwOJj4nP9FCv0G4ErRelayAlOAwzcASbOwzBra9ArVyeitqwVlFAhBJU21sXwvhb+obqBfE/hrmFAhG6XrU85SswcvjQ51pTzPq7G9hf8wze/Xi0yfmtIaDwq1aClExotA1DcFGrlHF6+PBXvgL/+eSjDye+Pzra1bPwfK9GdYyHDQrz+7yxiQqMob6n4fIzSwMqTlrFl54GFGMCam1kRxcfO/LF5+NHDn4luZCyVpqpfvTis4+teer5HZWTIx4XjkOJN7yrwJHc7xeCwtBuMF8BRWxJapoUbiiSrBEyzQ+88fQWWpZGK0Vt+/5dO3cuWta//JrbN6ybPjVmSVO6vQTtmoGxbE75EQn9DGhMnOl8odpYEsy4FJnzLpD7dvxm8Ohnf97L6A6Q2I8/3X/X+sL4+OiKdfdsESlX1EolcFEBEypoRuagQbTkCIlczwIUzub9SSrfwu1kqVSnqBanS3995r4HD771nH81s8boMA8Q/YLL6dBTjzz87/ffeav/l7/auLjv6pXgTq9XLEk/Cc0ViAl0KF13ppklopWnJr38yR9O/HDw0w8OvfvazrMnvvs+vpwizgOBEtH1fPTwl1+PPvrlZsYF3ExX1lobNHWzZbVRJmzZqEuyUNVi++v5/wCRgVmcBxhqewAAAABJRU5ErkJggg==';
const trayIconTemplatePng = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAAAAAAAAQCEeRdzAAACPElEQVR4nO2XO2sWQRSGn293okRQf4DaSoIEBBs7IViIgiCCYiGIKCSE/AEvhQiCljbaCIqFlY2dlYWdELCyFCxsTRElMd8mKwPvwDiZ2Z29YOULy9mdPXPOey57dndCOyZAnaHXS99kGpsBZjPsbQLTLiRMw70C2AVOAa+BIx6pEM7Zd+A6sObt702glIGLwDx5OCT9NW9/bwJ+dPaoVIoUppn2/oLJ0KmU9ljqfTidLe96EIGp5FnJIoOAxYLkdk4fmIZ1G/lN4IxK0EaglN414BdwW87t+k4XAhM5Pww8aHEa22tJ3FJDXpXzJAmTiMQSuAccVRRFRxLW2RWRuKS+iJIwwXUh5yeA1czUx+CcnQM+AOeB9VhPmMRAeQzsl3JWNzeQOA18BC4A30ISJlI/W/tFrYXR115NY8RciktPbiujti/uhwPKRIzUegRjs3+SMT1DFB7xPTAJQ6m0fwbeadyeDO5Z0i91fiOYmskyGvJhU3kZ+Aq8Ar6oTyrZeQEsS9dGu9T0/Pch4GM3MJ5M8ZgE9gFvVQI77Q5o3TXkitYqlcDdq8YigOpuj+eq90M12SfgKfAMOEgHmC7KSrNN9w/gEfAGOA68B45pfbbhMR1MoJS8owHzRF9Bd7XmypINQ38segOrN8yAvW5Mu5dP+a8JFN55L+dDCYwC858AcdSe7Ps9ENrqVIIZyaHOfVvRLyuTYLyuGT5GBtzbcrONQC35E5gbKXpn19r6rWv3v7GHgL9hYyTnrfgDaQ55x0HLahcAAAAASUVORK5CYII=';

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
    const trayPng = process.platform === 'darwin' ? trayIconTemplatePng : trayIconColorPng;
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${trayPng}`)
      .resize({ width: process.platform === 'darwin' ? 18 : 16 });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    if (!icon.isEmpty()) {
      try {
        this.tray = new Tray(icon);
    this.tray.setToolTip('Deskiii desktop companion');
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
      { label: 'Show Deskiii', click: this.actions.openAmbient },
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
      { label: 'Quit Deskiii', click: () => app.quit() },
    ];
    return Menu.buildFromTemplate(template);
  }
}
