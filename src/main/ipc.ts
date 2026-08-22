import { app, BrowserWindow, ipcMain } from 'electron';

import {
  ambientPointerRegions,
  windowActions,
  type AmbientPointerRegion,
  type WindowAction,
} from '../shared/runtime';
import type {
  OpenClawConnectInput,
  OpenClawResolveApprovalInput,
} from '../shared/openclaw';
import { getDistributionProfile } from './capabilities';
import { CompanionStateHost } from './companion-state-host';
import {
  ambientPointerRegionChannel,
  ambientStateChannel,
  type DeskyWindowManager,
} from './companion-window';
import { redactOpenClawError, type OpenClawAdapterHost } from './openclaw/host';

const runtimeInfoChannel = 'desky:runtime-info';
const windowActionChannel = 'desky:window-action';
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
  draft: 'desky:companion:draft',
  getDraft: 'desky:companion:get-draft',
  setDraft: 'desky:companion:set-draft',
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

  ipcMain.handle(runtimeInfoChannel, (event) => ({
    distributionProfile: getDistributionProfile(),
    platform: process.platform,
    version: app.getVersion(),
    surface: windows.surfaceFor(event.sender),
  }));

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
}

export const ipcChannels = {
  runtimeInfo: runtimeInfoChannel,
  windowAction: windowActionChannel,
  ambientState: ambientStateChannel,
  ambientPointerRegion: ambientPointerRegionChannel,
  companion: companionChannels,
  openClaw: openClawChannels,
} as const;
