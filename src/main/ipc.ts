import { readFile } from 'node:fs/promises';

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';

import {
  ambientPointerRegions,
  motionPreferences,
  windowActions,
  type AmbientPointerRegion,
  type MotionPreference,
  type WindowAction,
} from '../shared/runtime';
import type {
  OpenClawConnectInput,
  OpenClawResolveApprovalInput,
} from '../shared/openclaw';
import {
  localAnimationPreviewStatuses,
  type LocalAnimationPreviewCommand,
  type LocalAnimationPreviewReport,
} from '../shared/local-animation';
import { getDistributionProfile } from './capabilities';
import { loadFeaturedAvatarAsset } from './avatar-asset-broker';
import { CompanionStateHost } from './companion-state-host';
import {
  LocalAnimationPreviewHost,
  validateLocalAnimationAsset,
} from './local-animation-preview';
import {
  ambientPointerRegionChannel,
  ambientStateChannel,
  type DeskyWindowManager,
} from './companion-window';
import { redactOpenClawError, type OpenClawAdapterHost } from './openclaw/host';

const runtimeInfoChannel = 'desky:runtime-info';
const windowActionChannel = 'desky:window-action';
const featuredAvatarChannel = 'desky:avatar:get-featured';
const openClawChannels = {
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
const companionChannels = {
  state: 'desky:companion:state',
  getState: 'desky:companion:get-state',
  action: 'desky:companion:action',
  draft: 'desky:companion:draft',
  getDraft: 'desky:companion:get-draft',
  setDraft: 'desky:companion:set-draft',
} as const;
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
const motionPreferenceChannels = {
  state: 'desky:motion-preference:state',
  get: 'desky:motion-preference:get',
  set: 'desky:motion-preference:set',
} as const;

function isWindowAction(value: unknown): value is WindowAction {
  return typeof value === 'string' && windowActions.includes(value as WindowAction);
}

function isAmbientPointerRegion(value: unknown): value is AmbientPointerRegion {
  return typeof value === 'string'
    && ambientPointerRegions.includes(value as AmbientPointerRegion);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConnectInput(value: unknown): OpenClawConnectInput {
  if (!isRecord(value)
    || typeof value.gatewayUrl !== 'string' || value.gatewayUrl.length > 2048
    || (value.authKind !== 'token' && value.authKind !== 'password')
    || (value.credential !== undefined && (typeof value.credential !== 'string' || value.credential.length > 16_384))
    || typeof value.rememberCredential !== 'boolean') {
    throw new Error('Invalid OpenClaw connection input.');
  }
  return {
    gatewayUrl: value.gatewayUrl,
    authKind: value.authKind,
    credential: value.credential,
    rememberCredential: value.rememberCredential,
  };
}

function readApprovalInput(value: unknown): OpenClawResolveApprovalInput {
  if (!isRecord(value)
    || typeof value.requestId !== 'string'
    || (value.kind !== 'exec' && value.kind !== 'plugin' && value.kind !== 'system-agent')
    || (value.decision !== 'allow-once' && value.decision !== 'allow-always' && value.decision !== 'deny')) {
    throw new Error('Invalid approval decision.');
  }
  return { requestId: value.requestId, kind: value.kind, decision: value.decision };
}

function assertText(value: unknown, name: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`Invalid ${name}.`);
  return value;
}

function readAnimationReport(value: unknown): LocalAnimationPreviewReport {
  if (!isRecord(value)
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || value.requestId.length > 128
    || typeof value.status !== 'string'
    || !localAnimationPreviewStatuses.includes(value.status as never)
    || (value.status !== 'playing' && value.status !== 'completed' && value.status !== 'blocked' && value.status !== 'error')
    || typeof value.message !== 'string'
    || value.message.length > 240) {
    throw new Error('Invalid local animation preview report.');
  }
  return {
    requestId: value.requestId,
    status: value.status,
    message: value.message,
  };
}

async function rendererSafeOpenClawCall<T>(
  operation: () => T | Promise<T>,
  secrets: Array<string | undefined> = [],
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(redactOpenClawError(error, secrets));
  }
}

export function registerIpc(
  openClaw: OpenClawAdapterHost,
  windows: DeskyWindowManager,
): void {
  const companion = new CompanionStateHost();
  const animation = new LocalAnimationPreviewHost();
  let motionPreference: MotionPreference = 'system';
  const broadcastAnimationState = () => {
    const state = animation.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(animationChannels.state, state);
    }
  };
  const sendAnimationCommand = (command: LocalAnimationPreviewCommand) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (windows.surfaceFor(window.webContents) !== 'ambient') continue;
      window.webContents.send(animationChannels.command, command);
    }
  };

  ipcMain.handle(runtimeInfoChannel, (event) => ({
    distributionProfile: getDistributionProfile(),
    platform: process.platform,
    version: app.getVersion(),
    surface: windows.surfaceFor(event.sender),
  }));
  ipcMain.handle(featuredAvatarChannel, () => loadFeaturedAvatarAsset());
  ipcMain.handle(motionPreferenceChannels.get, () => motionPreference);
  ipcMain.handle(motionPreferenceChannels.set, (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Motion preference can only be changed from the control center.');
    }
    if (typeof value !== 'string' || !motionPreferences.includes(value as MotionPreference)) {
      throw new Error('Invalid motion preference.');
    }
    motionPreference = value as MotionPreference;
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(motionPreferenceChannels.state, motionPreference);
    }
    return motionPreference;
  });
  ipcMain.handle(animationChannels.getState, () => animation.getState());
  ipcMain.handle(animationChannels.select, async (event) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Local animations can only be selected from the control center.');
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Choose a VRM Animation',
      properties: ['openFile'],
      filters: [{ name: 'VRM Animation', extensions: ['vrma'] }],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length !== 1) {
      return { cancelled: true, state: animation.getState() };
    }
    const filePath = result.filePaths[0];
    const asset = validateLocalAnimationAsset(filePath, await readFile(filePath));
    const command = animation.select(asset);
    windows.performAction(event.sender, 'show-ambient');
    broadcastAnimationState();
    sendAnimationCommand(command);
    return { cancelled: false, state: animation.getState() };
  });
  ipcMain.handle(animationChannels.play, (event) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Local animation previews can only be started from the control center.');
    }
    const command = animation.requestPlay();
    windows.performAction(event.sender, 'show-ambient');
    broadcastAnimationState();
    sendAnimationCommand(command);
    return animation.getState();
  });
  ipcMain.handle(animationChannels.clear, (event) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Local animation previews can only be cleared from the control center.');
    }
    const state = animation.clear();
    broadcastAnimationState();
    sendAnimationCommand({ kind: 'clear' });
    return state;
  });
  ipcMain.handle(animationChannels.getCurrentCommand, (event) => {
    if (windows.surfaceFor(event.sender) !== 'ambient') return undefined;
    return animation.getCurrentCommand();
  });
  ipcMain.handle(animationChannels.report, (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'ambient') {
      throw new Error('Only the ambient companion can report animation playback.');
    }
    const state = animation.report(readAnimationReport(value));
    broadcastAnimationState();
    return state;
  });

  ipcMain.on(windowActionChannel, (event, action: unknown) => {
    if (!isWindowAction(action)) return;

    windows.performAction(event.sender, action);
  });

  ipcMain.handle(ambientStateChannel, () => windows.getAmbientState());
  ipcMain.on(ambientPointerRegionChannel, (event, region: unknown) => {
    if (!isAmbientPointerRegion(region)) return;
    windows.setPointerRegion(event.sender, region);
  });

  ipcMain.handle(companionChannels.getState, () => companion.getSnapshot());
  ipcMain.handle(companionChannels.getDraft, () => companion.getDraft());
  ipcMain.handle(companionChannels.setDraft, (_event, value: unknown) => {
    const text = assertText(value, 'draft', 100_000);
    const draft = companion.setDraft(text);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(companionChannels.draft, draft);
    }
    return draft;
  });

  ipcMain.handle(openClawChannels.getState, () => openClaw.getState());
  ipcMain.handle(openClawChannels.connect, (_event, input: unknown) => {
    const connection = readConnectInput(input);
    return rendererSafeOpenClawCall(() => openClaw.connect(connection), [connection.credential]);
  });
  ipcMain.handle(openClawChannels.disconnect, () => rendererSafeOpenClawCall(() => openClaw.disconnect()));
  ipcMain.handle(openClawChannels.refreshSessions, () => rendererSafeOpenClawCall(() => openClaw.refreshSessions()));
  ipcMain.handle(openClawChannels.createSession, (_event, input: unknown) => {
    if (!isRecord(input) || (input.label !== undefined && typeof input.label !== 'string')) {
      throw new Error('Invalid session input.');
    }
    return rendererSafeOpenClawCall(() => openClaw.createSession({ label: input.label as string | undefined }));
  });
  ipcMain.handle(openClawChannels.selectSession, (_event, key: unknown) => {
    const sessionKey = assertText(key, 'session key', 512);
    return rendererSafeOpenClawCall(() => openClaw.selectSession(sessionKey));
  });
  ipcMain.handle(openClawChannels.send, (_event, message: unknown) => {
    const text = assertText(message, 'message', 100_000);
    return rendererSafeOpenClawCall(() => openClaw.send(text), [text]);
  });
  ipcMain.handle(openClawChannels.cancel, () => rendererSafeOpenClawCall(() => openClaw.cancel()));
  ipcMain.handle(openClawChannels.resolveApproval, (_event, input: unknown) => {
    const approval = readApprovalInput(input);
    return rendererSafeOpenClawCall(() => openClaw.resolveApproval(approval));
  });

  openClaw.onState((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(openClawChannels.state, state);
  });
  openClaw.onEvent((adapterEvent) => {
    const snapshot = companion.applyEvent(adapterEvent);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(openClawChannels.event, adapterEvent);
      window.webContents.send(companionChannels.state, snapshot);
    }
  });
  openClaw.onAction((command) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (windows.surfaceFor(window.webContents) !== 'ambient') continue;
      window.webContents.send(companionChannels.action, command);
    }
  });
}

export const ipcChannels = {
  runtimeInfo: runtimeInfoChannel,
  featuredAvatar: featuredAvatarChannel,
  windowAction: windowActionChannel,
  ambientState: ambientStateChannel,
  ambientPointerRegion: ambientPointerRegionChannel,
  companion: companionChannels,
  animation: animationChannels,
  motionPreference: motionPreferenceChannels,
  openClaw: openClawChannels,
} as const;
