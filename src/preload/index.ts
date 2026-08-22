import { contextBridge, ipcRenderer } from 'electron';

import type { RuntimeInfo, WindowAction } from '../shared/runtime';
import type {
  OpenClawBridge,
  OpenClawConnectInput,
  OpenClawConnectionState,
  OpenClawCreateSessionInput,
  OpenClawResolveApprovalInput,
} from '../shared/openclaw';
import type { AdapterEvent } from '../shared/adapter-events';

const channels = {
  state: 'desky:openclaw:state',
  event: 'desky:openclaw:event',
  getState: 'desky:openclaw:get-state',
  connect: 'desky:openclaw:connect',
  disconnect: 'desky:openclaw:disconnect',
  refreshSessions: 'desky:openclaw:refresh-sessions',
  createSession: 'desky:openclaw:create-session',
  selectSession: 'desky:openclaw:select-session',
  send: 'desky:openclaw:send',
  cancel: 'desky:openclaw:cancel',
  resolveApproval: 'desky:openclaw:resolve-approval',
} as const;

const openClaw: OpenClawBridge = Object.freeze({
  getState: () => ipcRenderer.invoke(channels.getState) as Promise<OpenClawConnectionState>,
  connect: (input: OpenClawConnectInput) => ipcRenderer.invoke(channels.connect, input) as Promise<OpenClawConnectionState>,
  disconnect: () => ipcRenderer.invoke(channels.disconnect) as Promise<OpenClawConnectionState>,
  refreshSessions: () => ipcRenderer.invoke(channels.refreshSessions) as Promise<OpenClawConnectionState>,
  createSession: (input: OpenClawCreateSessionInput) => ipcRenderer.invoke(channels.createSession, input) as Promise<OpenClawConnectionState>,
  selectSession: (sessionKey: string) => ipcRenderer.invoke(channels.selectSession, sessionKey) as Promise<OpenClawConnectionState>,
  send: (message: string) => ipcRenderer.invoke(channels.send, message) as Promise<void>,
  cancel: () => ipcRenderer.invoke(channels.cancel) as Promise<void>,
  resolveApproval: (input: OpenClawResolveApprovalInput) => ipcRenderer.invoke(channels.resolveApproval, input) as Promise<void>,
  onState: (listener: (state: OpenClawConnectionState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OpenClawConnectionState) => listener(state);
    ipcRenderer.on(channels.state, handler);
    return () => ipcRenderer.removeListener(channels.state, handler);
  },
  onEvent: (listener: (event: AdapterEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, adapterEvent: AdapterEvent) => listener(adapterEvent);
    ipcRenderer.on(channels.event, handler);
    return () => ipcRenderer.removeListener(channels.event, handler);
  },
});

const api = Object.freeze({
  getRuntimeInfo: (): Promise<RuntimeInfo> =>
    ipcRenderer.invoke('desky:runtime-info') as Promise<RuntimeInfo>,
  performWindowAction: (action: WindowAction): void => {
    ipcRenderer.send('desky:window-action', action);
  },
  openClaw,
});

contextBridge.exposeInMainWorld('desky', api);

export type DeskyBridge = typeof api;
