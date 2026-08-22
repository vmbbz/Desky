import { app, BrowserWindow, ipcMain } from 'electron';

import type { WindowAction } from '../shared/runtime';
import type {
  OpenClawConnectInput,
  OpenClawResolveApprovalInput,
} from '../shared/openclaw';
import { getDistributionProfile } from './capabilities';
import type { OpenClawAdapterHost } from './openclaw/host';

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

function isWindowAction(value: unknown): value is WindowAction {
  return value === 'close' || value === 'minimize';
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

export function registerIpc(openClaw: OpenClawAdapterHost): void {
  ipcMain.handle(runtimeInfoChannel, () => ({
    distributionProfile: getDistributionProfile(),
    platform: process.platform,
    version: app.getVersion(),
  }));

  ipcMain.on(windowActionChannel, (event, action: unknown) => {
    if (!isWindowAction(action)) return;

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    if (action === 'close') window.close();
    if (action === 'minimize') window.minimize();
  });

  ipcMain.handle(openClawChannels.getState, () => openClaw.getState());
  ipcMain.handle(openClawChannels.connect, (_event, input: unknown) => openClaw.connect(readConnectInput(input)));
  ipcMain.handle(openClawChannels.disconnect, () => openClaw.disconnect());
  ipcMain.handle(openClawChannels.refreshSessions, () => openClaw.refreshSessions());
  ipcMain.handle(openClawChannels.createSession, (_event, input: unknown) => {
    if (!isRecord(input) || (input.label !== undefined && typeof input.label !== 'string')) {
      throw new Error('Invalid session input.');
    }
    return openClaw.createSession({ label: input.label as string | undefined });
  });
  ipcMain.handle(openClawChannels.selectSession, (_event, key: unknown) => openClaw.selectSession(assertText(key, 'session key', 512)));
  ipcMain.handle(openClawChannels.send, (_event, message: unknown) => openClaw.send(assertText(message, 'message', 100_000)));
  ipcMain.handle(openClawChannels.cancel, () => openClaw.cancel());
  ipcMain.handle(openClawChannels.resolveApproval, (_event, input: unknown) => openClaw.resolveApproval(readApprovalInput(input)));

  openClaw.onState((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(openClawChannels.state, state);
  });
  openClaw.onEvent((adapterEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(openClawChannels.event, adapterEvent);
  });
}

export const ipcChannels = {
  runtimeInfo: runtimeInfoChannel,
  windowAction: windowActionChannel,
  openClaw: openClawChannels,
} as const;
