import { contextBridge, ipcRenderer } from 'electron';

import type {
  AmbientDragCommand,
  AmbientPointerRegion,
  AmbientSurfaceState,
  MotionPreference,
  RuntimeInfo,
  WindowAction,
} from '../shared/runtime';
import type {
  OpenClawBridge,
  OpenClawConnectInput,
  OpenClawConnectionState,
  OpenClawCreateSessionInput,
  OpenClawResolveApprovalInput,
} from '../shared/openclaw';
import type { AdapterEvent } from '../shared/adapter-events';
import type { AgentActionCommand } from '../shared/agent-actions';
import type { AvatarAssetBridge, FeaturedAvatarAsset } from '../shared/avatar-assets';
import type {
  LocalAnimationBridge,
  LocalAnimationPreviewCommand,
  LocalAnimationPreviewReport,
  LocalAnimationPreviewState,
  LocalAnimationSelectionResult,
} from '../shared/local-animation';
import type {
  CompanionDraftSnapshot,
  CompanionSnapshot,
} from '../shared/companion-state';

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

const companionChannels = {
  state: 'desky:companion:state',
  getState: 'desky:companion:get-state',
  action: 'desky:companion:action',
  draft: 'desky:companion:draft',
  getDraft: 'desky:companion:get-draft',
  setDraft: 'desky:companion:set-draft',
} as const;

const companion = Object.freeze({
  getState: () => ipcRenderer.invoke(companionChannels.getState) as Promise<CompanionSnapshot>,
  onState: (listener: (state: CompanionSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: CompanionSnapshot) => listener(state);
    ipcRenderer.on(companionChannels.state, handler);
    return () => ipcRenderer.removeListener(companionChannels.state, handler);
  },
  onAction: (listener: (command: AgentActionCommand) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: AgentActionCommand) => listener(command);
    ipcRenderer.on(companionChannels.action, handler);
    return () => ipcRenderer.removeListener(companionChannels.action, handler);
  },
  getDraft: () => ipcRenderer.invoke(companionChannels.getDraft) as Promise<CompanionDraftSnapshot>,
  setDraft: (text: string) => ipcRenderer.invoke(companionChannels.setDraft, text) as Promise<CompanionDraftSnapshot>,
  onDraft: (listener: (draft: CompanionDraftSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, draft: CompanionDraftSnapshot) => listener(draft);
    ipcRenderer.on(companionChannels.draft, handler);
    return () => ipcRenderer.removeListener(companionChannels.draft, handler);
  },
});

const avatar: AvatarAssetBridge = Object.freeze({
  getFeatured: () => ipcRenderer.invoke('desky:avatar:get-featured') as Promise<FeaturedAvatarAsset>,
});

const animationChannels = {
  state: 'desky:animation:state',
  command: 'desky:animation:command',
  getState: 'desky:animation:get-state',
  select: 'desky:animation:select',
  play: 'desky:animation:play',
  clear: 'desky:animation:clear',
  getCurrentCommand: 'desky:animation:get-current-command',
  report: 'desky:animation:report',
} as const;

const animation: LocalAnimationBridge = Object.freeze({
  getState: () => ipcRenderer.invoke(animationChannels.getState) as Promise<LocalAnimationPreviewState>,
  select: () => ipcRenderer.invoke(animationChannels.select) as Promise<LocalAnimationSelectionResult>,
  play: () => ipcRenderer.invoke(animationChannels.play) as Promise<LocalAnimationPreviewState>,
  clear: () => ipcRenderer.invoke(animationChannels.clear) as Promise<LocalAnimationPreviewState>,
  getCurrentCommand: () => ipcRenderer.invoke(animationChannels.getCurrentCommand) as Promise<LocalAnimationPreviewCommand | undefined>,
  report: (report: LocalAnimationPreviewReport) => ipcRenderer.invoke(animationChannels.report, report) as Promise<LocalAnimationPreviewState>,
  onState: (listener: (state: LocalAnimationPreviewState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LocalAnimationPreviewState) => listener(state);
    ipcRenderer.on(animationChannels.state, handler);
    return () => ipcRenderer.removeListener(animationChannels.state, handler);
  },
  onCommand: (listener: (command: LocalAnimationPreviewCommand) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: LocalAnimationPreviewCommand) => listener(command);
    ipcRenderer.on(animationChannels.command, handler);
    return () => ipcRenderer.removeListener(animationChannels.command, handler);
  },
});

const api = Object.freeze({
  getRuntimeInfo: (): Promise<RuntimeInfo> =>
    ipcRenderer.invoke('desky:runtime-info') as Promise<RuntimeInfo>,
  getAmbientSurfaceState: (): Promise<AmbientSurfaceState> =>
    ipcRenderer.invoke('desky:ambient-state') as Promise<AmbientSurfaceState>,
  onAmbientSurfaceState: (listener: (state: AmbientSurfaceState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AmbientSurfaceState) => listener(state);
    ipcRenderer.on('desky:ambient-state', handler);
    return () => ipcRenderer.removeListener('desky:ambient-state', handler);
  },
  getMotionPreference: (): Promise<MotionPreference> =>
    ipcRenderer.invoke('desky:motion-preference:get') as Promise<MotionPreference>,
  setMotionPreference: (preference: MotionPreference): Promise<MotionPreference> =>
    ipcRenderer.invoke('desky:motion-preference:set', preference) as Promise<MotionPreference>,
  onMotionPreference: (listener: (preference: MotionPreference) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, preference: MotionPreference) => listener(preference);
    ipcRenderer.on('desky:motion-preference:state', handler);
    return () => ipcRenderer.removeListener('desky:motion-preference:state', handler);
  },
  performWindowAction: (action: WindowAction): void => {
    ipcRenderer.send('desky:window-action', action);
  },
  setAmbientPointerRegion: (region: AmbientPointerRegion): void => {
    ipcRenderer.send('desky:ambient-pointer-region', region);
  },
  dragAmbient: (command: AmbientDragCommand): void => {
    ipcRenderer.send('desky:ambient-drag', command);
  },
  setAmbientAvatarYaw: (degrees: number): void => {
    ipcRenderer.send('desky:ambient-avatar-yaw', degrees);
  },
  companion,
  avatar,
  animation,
  openClaw,
});

contextBridge.exposeInMainWorld('desky', api);

export type DeskyBridge = typeof api;
