import { contextBridge, ipcRenderer } from 'electron';

import type { RuntimeInfo, WindowAction } from '../shared/runtime';

const api = Object.freeze({
  getRuntimeInfo: (): Promise<RuntimeInfo> =>
    ipcRenderer.invoke('desky:runtime-info') as Promise<RuntimeInfo>,
  performWindowAction: (action: WindowAction): void => {
    ipcRenderer.send('desky:window-action', action);
  },
});

contextBridge.exposeInMainWorld('desky', api);

export type DeskyBridge = typeof api;
