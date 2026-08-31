import { readFile } from 'node:fs/promises';

import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ambientDragPhases,
  ambientPointerRegions,
  motionPreferences,
  windowActions,
  type AmbientDragCommand,
  type AmbientPointerRegion,
  type MotionPreference,
  type WindowAction,
} from '../shared/runtime';
import type { MotionPersonalityPolicy } from '../shared/motion-personality';
import type { AvatarLoadReport } from '../shared/avatar-assets';
import type {
  AdapterConnectCommand,
  AdapterResolveApprovalInput,
} from '../shared/agent-adapter';
import { normalizeSafeExternalUrl } from '../shared/external-link';
import {
  localAnimationPreviewStatuses,
  type LocalAnimationPreviewCommand,
  type LocalAnimationPreviewReport,
} from '../shared/local-animation';
import { getDistributionProfile, getReleaseManifest } from './capabilities';
import { AvatarAssetHost } from './avatar-asset-host';
import { AvatarCache } from './avatar-cache';
import {
  getAdmittedAvatarRevisionByAvatarId,
  getAdmittedAvatarRevisions,
  getBundledMarketplaceCatalog,
} from './marketplace-catalog';
import { CompanionStateHost } from './companion-state-host';
import {
  LocalAnimationPreviewHost,
  validateLocalAnimationAsset,
} from './local-animation-preview';
import { readScopedLocalAnimationVisualTestFile } from './local-animation-visual-test';
import {
  ambientAvatarYawChannel,
  ambientDragChannel,
  ambientPointerRegionChannel,
  ambientStateChannel,
  type DeskyWindowManager,
} from './companion-window';
import type { AgentAdapterRegistry } from './adapters/registry';
import type { CodexWorkspaceGrantBroker } from './codex/workspace-grants';
import { readScopedCodexVisualTestWorkspace } from './codex/visual-test-workspace';
import { shouldDisableAvatarNetwork } from './visual-test-policy';
import { ConversationLauncher } from './conversation-launcher';
import {
  isBoundedVoiceAudioBase64,
  type VoiceInputAudioChunk,
  type VoiceInputSession,
  type VoiceInputStopCommand,
} from '../shared/voice-input';
import {
  admitVrm1CompatibilityFixture,
  readScopedVrm1CompatibilityFile,
} from './vrm1-compatibility-fixture';

const runtimeInfoChannel = 'desky:runtime-info';
const windowActionChannel = 'desky:window-action';
const conversationOpenChannel = 'desky:conversation:open';
const externalLinkOpenChannel = 'desky:external-link:open';
const avatarChannels = {
  state: 'desky:avatar:selection-state',
  getState: 'desky:avatar:get-selection-state',
  getSelected: 'desky:avatar:get-selected',
  reportLoad: 'desky:avatar:report-load',
} as const;
const marketplaceCatalogChannel = 'desky:marketplace:get-catalog';
const marketplaceActivateChannel = 'desky:marketplace:activate';
const marketplaceThumbnailChannel = 'desky:marketplace:get-thumbnail';
const marketplacePreviewChannel = 'desky:marketplace:get-preview';
const marketplaceCacheInventoryChannel = 'desky:marketplace:get-cache-inventory';
const marketplaceRemoveDownloadChannel = 'desky:marketplace:remove-download';
const marketplaceOpenSourceChannel = 'desky:marketplace:open-source';
const adapterChannels = {
  state: 'desky:adapter:state',
  event: 'desky:adapter:event',
  list: 'desky:adapter:list',
  getState: 'desky:adapter:get-state',
  connect: 'desky:adapter:connect',
  disconnect: 'desky:adapter:disconnect',
  refreshSessions: 'desky:adapter:refresh-sessions',
  createSession: 'desky:adapter:create-session',
  selectSession: 'desky:adapter:select-session',
  send: 'desky:adapter:send',
  cancel: 'desky:adapter:cancel',
  resolveApproval: 'desky:adapter:resolve-approval',
} as const;
const voiceInputChannels = {
  event: 'desky:voice-input:event',
  start: 'desky:voice-input:start',
  append: 'desky:voice-input:append',
  stop: 'desky:voice-input:stop',
} as const;
const codexWorkspaceChannels = {
  select: 'desky:codex-workspace:select',
  revoke: 'desky:codex-workspace:revoke',
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
const motionPersonalityChannels = {
  state: 'desky:motion-personality:state',
  get: 'desky:motion-personality:get',
  set: 'desky:motion-personality:set',
} as const;

function isWindowAction(value: unknown): value is WindowAction {
  return typeof value === 'string' && windowActions.includes(value as WindowAction);
}

function isAmbientPointerRegion(value: unknown): value is AmbientPointerRegion {
  return typeof value === 'string'
    && ambientPointerRegions.includes(value as AmbientPointerRegion);
}

function readAmbientDragCommand(value: unknown): AmbientDragCommand | undefined {
  if (!isRecord(value)
    || typeof value.phase !== 'string'
    || !ambientDragPhases.includes(value.phase as never)
    || typeof value.pointerX !== 'number'
    || typeof value.pointerY !== 'number'
    || !Number.isFinite(value.pointerX)
    || !Number.isFinite(value.pointerY)
    || Math.abs(value.pointerX) > 1_000_000
    || Math.abs(value.pointerY) > 1_000_000) return undefined;
  return {
    phase: value.phase as AmbientDragCommand['phase'],
    pointerX: value.pointerX,
    pointerY: value.pointerY,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAdapterConnectCommand(value: unknown): AdapterConnectCommand {
  if (!isRecord(value)
    || typeof value.adapterId !== 'string'
    || value.adapterId.length === 0
    || value.adapterId.length > 128
    || !Object.hasOwn(value, 'configuration')) {
    throw new Error('Invalid agent adapter connection command.');
  }
  return {
    adapterId: value.adapterId,
    configuration: value.configuration,
  };
}

function readApprovalInput(value: unknown): AdapterResolveApprovalInput {
  if (!isRecord(value)
    || typeof value.requestId !== 'string'
    || (value.kind !== 'exec'
      && value.kind !== 'file-change'
      && value.kind !== 'plugin'
      && value.kind !== 'system-agent')
    || (value.decision !== 'allow-once' && value.decision !== 'allow-always' && value.decision !== 'deny')) {
    throw new Error('Invalid approval decision.');
  }
  return { requestId: value.requestId, kind: value.kind, decision: value.decision };
}

function readVoiceAudioChunk(value: unknown): VoiceInputAudioChunk {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || value.sessionId.length > 512
    || !isBoundedVoiceAudioBase64(value.audioBase64)) {
    throw new Error('Invalid voice-input audio chunk.');
  }
  return { sessionId: value.sessionId, audioBase64: value.audioBase64 };
}

function readVoiceStopCommand(value: unknown): VoiceInputStopCommand {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || value.sessionId.length > 512
    || typeof value.discard !== 'boolean') {
    throw new Error('Invalid voice-input stop command.');
  }
  return { sessionId: value.sessionId, discard: value.discard };
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

function readAvatarLoadReport(value: unknown): AvatarLoadReport {
  if (!isRecord(value)
    || typeof value.revisionId !== 'string'
    || value.revisionId.length === 0
    || value.revisionId.length > 128
    || (value.status !== 'ready' && value.status !== 'error')
    || (value.message !== undefined
      && (typeof value.message !== 'string' || value.message.length > 240))) {
    throw new Error('Invalid avatar load report.');
  }
  return {
    revisionId: value.revisionId,
    status: value.status,
    message: value.message,
  };
}

export function registerIpc(
  adapters: AgentAdapterRegistry,
  windows: DeskyWindowManager,
  codexWorkspaceGrants: CodexWorkspaceGrantBroker,
): void {
  const companion = new CompanionStateHost();
  const animation = new LocalAnimationPreviewHost();
  const conversationLauncher = new ConversationLauncher({
    getAdapterState: () => adapters.getState(),
    getProtocolHandlerName: (url) => app.getApplicationNameForProtocol(url),
    openExternal: (url) => shell.openExternal(url),
    openDeskiii: () => windows.openControlCenter(),
  });
  let voiceInputOwnerId: number | undefined;
  let activeVoiceInputSessionId: string | undefined;
  const avatarFetcher = shouldDisableAvatarNetwork(
    process.env.DESKY_VISUAL_TEST_DISABLE_NETWORK,
    process.env.DESKY_VISUAL_TEST_EXERCISE,
  )
    ? async (): Promise<Response> => { throw new Error('Visual-test network is disabled.'); }
    : fetch;
  const avatarCache = new AvatarCache(join(app.getPath('userData'), 'avatar-cache'), avatarFetcher);
  const avatarAssets = new AvatarAssetHost(
    avatarCache,
    () => windows.getAvatarSelection(),
    (selection) => windows.setAvatarSelection(selection),
  );
  void avatarCache.prune(
    getAdmittedAvatarRevisions(),
    avatarAssets.getProtectedRevisionIds(),
  ).catch(() => undefined);
  const marketplaceCacheInventory = async () => {
    const inspection = await avatarCache.inspect(getAdmittedAvatarRevisions());
    const protection = avatarAssets.getCacheProtection();
    return {
      maximumBytes: inspection.maximumBytes,
      totalBytes: inspection.totalBytes,
      entries: inspection.entries.map((entry) => {
        const protectionReasons = [...(protection.get(entry.revisionId) ?? [])];
        return {
          ...entry,
          protectionReasons,
          removable: entry.modelStatus !== 'missing' && protectionReasons.length === 0,
        };
      }),
    };
  };
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
    releaseProfileId: getReleaseManifest().profileId,
    commerceMode: getReleaseManifest().commerceMode,
    packageClass: getReleaseManifest().packageClass,
    platform: process.platform,
    version: app.getVersion(),
    surface: windows.surfaceFor(event.sender),
  }));
  avatarAssets.onState((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(avatarChannels.state, state);
    }
  });
  ipcMain.handle(avatarChannels.getState, () => avatarAssets.getState());
  ipcMain.handle(avatarChannels.getSelected, async () => {
    const compatibilityFile = readScopedVrm1CompatibilityFile({
      exercise: process.env.DESKY_VISUAL_TEST_EXERCISE,
      capturePath: process.env.DESKY_VISUAL_TEST_PATH,
      userDataPath: process.env.DESKY_VISUAL_TEST_USER_DATA,
      avatarPath: process.env.DESKY_VRM1_UI_TEST_FILE,
      temporaryRoot: tmpdir(),
    });
    if (compatibilityFile) {
      return admitVrm1CompatibilityFixture(await readFile(compatibilityFile));
    }
    return avatarAssets.getSelected();
  });
  ipcMain.handle(avatarChannels.reportLoad, (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'ambient') {
      throw new Error('Avatar load results can only be reported by the ambient companion.');
    }
    return avatarAssets.reportLoad(readAvatarLoadReport(value));
  });
  ipcMain.handle(marketplaceCatalogChannel, () => getBundledMarketplaceCatalog());
  ipcMain.handle(marketplaceThumbnailChannel, async (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center'
      || typeof value !== 'string'
      || value.length === 0
      || value.length > 128) {
      throw new Error('Invalid marketplace thumbnail request.');
    }
    const revision = getAdmittedAvatarRevisionByAvatarId(value);
    if (!revision) throw new Error('Marketplace avatar thumbnail is unavailable.');
    return {
      avatarId: revision.avatar.avatarId,
      mediaType: 'image/png' as const,
      bytes: await avatarCache.getThumbnail(revision),
    };
  });
  ipcMain.handle(marketplacePreviewChannel, (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center'
      || typeof value !== 'string'
      || value.length === 0
      || value.length > 128) {
      throw new Error('Invalid marketplace preview request.');
    }
    return avatarAssets.getPreview(value);
  });
  ipcMain.handle(marketplaceCacheInventoryChannel, (event) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Marketplace storage is only available in the control center.');
    }
    return marketplaceCacheInventory();
  });
  ipcMain.handle(marketplaceRemoveDownloadChannel, async (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center'
      || typeof value !== 'string'
      || value.length === 0
      || value.length > 128) {
      throw new Error('Invalid marketplace download removal request.');
    }
    const revision = getAdmittedAvatarRevisionByAvatarId(value);
    if (!revision) throw new Error('Marketplace companion download is unavailable.');
    await avatarCache.removeModel(
      revision,
      getAdmittedAvatarRevisions(),
      avatarAssets.getProtectedRevisionIds(),
    );
    return marketplaceCacheInventory();
  });
  ipcMain.handle(marketplaceActivateChannel, async (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center'
      || typeof value !== 'string'
      || value.length === 0
      || value.length > 128) {
      throw new Error('Invalid companion activation request.');
    }
    const state = await avatarAssets.activate(value);
    await avatarCache.prune(
      getAdmittedAvatarRevisions(),
      avatarAssets.getProtectedRevisionIds(),
    );
    return state;
  });
  ipcMain.handle(marketplaceOpenSourceChannel, async (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center'
      || typeof value !== 'string'
      || value.length > 128) {
      throw new Error('Invalid marketplace source request.');
    }
    const avatar = getBundledMarketplaceCatalog().avatars.find((entry) => entry.avatarId === value);
    if (!avatar) throw new Error('Marketplace avatar source is unavailable.');
    await shell.openExternal(avatar.sourceUrl);
  });
  ipcMain.handle(motionPreferenceChannels.get, () => motionPreference);
  ipcMain.handle(motionPreferenceChannels.set, (event, value: unknown) => {
    const visualTestOverride = process.env.DESKY_VISUAL_TEST_PATH !== undefined
      && process.env.DESKY_VISUAL_TEST_MOTION_PREFERENCE !== undefined;
    // The packaged visual harness must be able to exercise Full/Reduced from
    // the ambient surface; normal users can only change this from Control
    // Center, preserving the production surface boundary.
    if (windows.surfaceFor(event.sender) !== 'control-center' && !visualTestOverride) {
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
  ipcMain.handle(motionPersonalityChannels.get, () => windows.getMotionPersonality());
  ipcMain.handle(motionPersonalityChannels.set, (event, value: unknown) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Motion personality can only be changed from the control center.');
    }
    const policy: MotionPersonalityPolicy = windows.setMotionPersonality(value);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(motionPersonalityChannels.state, policy);
    }
    return policy;
  });
  ipcMain.handle(animationChannels.getState, () => animation.getState());
  ipcMain.handle(animationChannels.select, async (event) => {
    if (windows.surfaceFor(event.sender) !== 'control-center') {
      throw new Error('Local animations can only be selected from the control center.');
    }
    const visualTestFile = readScopedLocalAnimationVisualTestFile({
      exercise: process.env.DESKY_VISUAL_TEST_EXERCISE,
      capturePath: process.env.DESKY_VISUAL_TEST_PATH,
      userDataPath: process.env.DESKY_VISUAL_TEST_USER_DATA,
      animationPath: process.env.DESKY_VRMA_UI_TEST_FILE,
      temporaryRoot: tmpdir(),
    });
    const result = visualTestFile
      ? { canceled: false, filePaths: [visualTestFile] }
      : await (() => {
          const parent = BrowserWindow.fromWebContents(event.sender);
          const options: OpenDialogOptions = {
            title: 'Choose a VRM Animation',
            properties: ['openFile'],
            filters: [{ name: 'VRM Animation', extensions: ['vrma'] }],
          };
          return parent
            ? dialog.showOpenDialog(parent, options)
            : dialog.showOpenDialog(options);
        })();
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
  ipcMain.handle(conversationOpenChannel, () => conversationLauncher.open());
  ipcMain.handle(externalLinkOpenChannel, async (_event, value: unknown) => {
    await shell.openExternal(normalizeSafeExternalUrl(value));
  });

  ipcMain.handle(ambientStateChannel, () => windows.getAmbientState());
  ipcMain.on(ambientPointerRegionChannel, (event, region: unknown) => {
    if (!isAmbientPointerRegion(region)) return;
    windows.setPointerRegion(event.sender, region);
  });
  ipcMain.on(ambientDragChannel, (event, value: unknown) => {
    const command = readAmbientDragCommand(value);
    if (!command) return;
    windows.dragAmbient(event.sender, command);
  });
  ipcMain.on(ambientAvatarYawChannel, (event, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    windows.setAvatarYaw(event.sender, value);
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

  ipcMain.handle(adapterChannels.list, () => adapters.list());
  ipcMain.handle(adapterChannels.getState, () => adapters.getState());
  ipcMain.handle(adapterChannels.connect, (_event, input: unknown) => {
    const command = readAdapterConnectCommand(input);
    return adapters.connect(command);
  });
  ipcMain.handle(adapterChannels.disconnect, () => adapters.disconnect());
  ipcMain.handle(adapterChannels.refreshSessions, () => adapters.refreshSessions());
  ipcMain.handle(adapterChannels.createSession, (_event, input: unknown) => {
    if (!isRecord(input)
      || (input.label !== undefined
        && (typeof input.label !== 'string' || input.label.length > 100))) {
      throw new Error('Invalid session input.');
    }
    return adapters.createSession({ label: input.label as string | undefined });
  });
  ipcMain.handle(adapterChannels.selectSession, (_event, id: unknown) => {
    const sessionId = assertText(id, 'session id', 512);
    return adapters.selectSession(sessionId);
  });
  ipcMain.handle(adapterChannels.send, (_event, message: unknown) => {
    const text = assertText(message, 'message', 100_000);
    return adapters.send(text);
  });
  ipcMain.handle(adapterChannels.cancel, () => adapters.cancel());
  ipcMain.handle(adapterChannels.resolveApproval, (_event, input: unknown) => {
    const approval = readApprovalInput(input);
    return adapters.resolveApproval(approval);
  });
  ipcMain.handle(voiceInputChannels.start, async (event) => {
    if (voiceInputOwnerId) {
      throw new Error('Voice input is already active on another Deskiii surface.');
    }
    voiceInputOwnerId = event.sender.id;
    let session: VoiceInputSession;
    try {
      session = await adapters.startVoiceInput();
      activeVoiceInputSessionId = session.sessionId;
    } catch (error) {
      voiceInputOwnerId = undefined;
      throw error;
    }
    const ownerId = event.sender.id;
    event.sender.once('destroyed', () => {
      if (voiceInputOwnerId !== ownerId || !activeVoiceInputSessionId) return;
      const sessionId = activeVoiceInputSessionId;
      voiceInputOwnerId = undefined;
      activeVoiceInputSessionId = undefined;
      void adapters.stopVoiceInput({ sessionId, discard: true }).catch(() => undefined);
    });
    return session;
  });
  ipcMain.handle(voiceInputChannels.append, (event, input: unknown) => {
    const chunk = readVoiceAudioChunk(input);
    if (voiceInputOwnerId !== event.sender.id || chunk.sessionId !== activeVoiceInputSessionId) {
      throw new Error('Voice-input session is not owned by this surface.');
    }
    return adapters.appendVoiceInput(chunk);
  });
  ipcMain.handle(voiceInputChannels.stop, async (event, input: unknown) => {
    const command = readVoiceStopCommand(input);
    if (voiceInputOwnerId !== event.sender.id || command.sessionId !== activeVoiceInputSessionId) {
      return;
    }
    voiceInputOwnerId = undefined;
    activeVoiceInputSessionId = undefined;
    await adapters.stopVoiceInput(command);
  });
  ipcMain.handle(codexWorkspaceChannels.select, async (event, sandbox: unknown) => {
    if (getDistributionProfile() !== 'direct'
      || windows.surfaceFor(event.sender) !== 'control-center'
      || (sandbox !== 'read-only' && sandbox !== 'workspace-write')) {
      throw new Error('Codex workspace selection is unavailable on this surface.');
    }
    const visualTestWorkspace = readScopedCodexVisualTestWorkspace({
      sandbox,
      exercise: process.env.DESKY_VISUAL_TEST_EXERCISE,
      capturePath: process.env.DESKY_VISUAL_TEST_PATH,
      userDataPath: process.env.DESKY_VISUAL_TEST_USER_DATA,
      workspacePath: process.env.DESKY_CODEX_UI_TEST_WORKSPACE,
      temporaryRoot: tmpdir(),
    });
    if (visualTestWorkspace) {
      return {
        status: 'selected' as const,
        grant: await codexWorkspaceGrants.issue(visualTestWorkspace, 'read-only'),
      };
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Choose a Codex workspace',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'dontAddToRecent'],
    };
    const selection = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) return { status: 'cancelled' as const };
    if (sandbox === 'workspace-write') {
      const confirmation = parent
        ? await dialog.showMessageBox(parent, {
            type: 'warning',
            title: 'Allow Codex to edit this workspace?',
            message: 'Workspace-write access',
            detail: 'Codex can read, edit, and run commands inside the folder you selected. Network and outside-workspace access still require approval.',
            buttons: ['Allow workspace write', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          })
        : await dialog.showMessageBox({
            type: 'warning',
            title: 'Allow Codex to edit this workspace?',
            message: 'Workspace-write access',
            detail: 'Codex can read, edit, and run commands inside the folder you selected. Network and outside-workspace access still require approval.',
            buttons: ['Allow workspace write', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          });
      if (confirmation.response !== 0) return { status: 'cancelled' as const };
    }
    return {
      status: 'selected' as const,
      grant: await codexWorkspaceGrants.issue(selection.filePaths[0], sandbox),
    };
  });
  ipcMain.handle(codexWorkspaceChannels.revoke, (event, grantId: unknown) => {
    if (getDistributionProfile() !== 'direct'
      || windows.surfaceFor(event.sender) !== 'control-center'
      || typeof grantId !== 'string'
      || grantId.length === 0
      || grantId.length > 160) {
      throw new Error('Invalid Codex workspace grant revocation.');
    }
    codexWorkspaceGrants.revoke(grantId);
  });

  adapters.onState((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(adapterChannels.state, state);
  });
  adapters.onVoiceInputEvent((voiceEvent) => {
    if (voiceEvent.sessionId !== activeVoiceInputSessionId) return;
    const owner = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === voiceInputOwnerId,
    );
    owner?.webContents.send(voiceInputChannels.event, voiceEvent);
    if (voiceEvent.type === 'closed') {
      voiceInputOwnerId = undefined;
      activeVoiceInputSessionId = undefined;
    }
  });
  adapters.onEvent((adapterEvent) => {
    const snapshot = companion.applyEvent(adapterEvent);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(adapterChannels.event, adapterEvent);
      window.webContents.send(companionChannels.state, snapshot);
    }
  });
  adapters.onAction((command) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (windows.surfaceFor(window.webContents) !== 'ambient') continue;
      window.webContents.send(companionChannels.action, command);
    }
  });
}

export const ipcChannels = {
  runtimeInfo: runtimeInfoChannel,
  avatar: avatarChannels,
  marketplaceActivate: marketplaceActivateChannel,
  marketplaceCatalog: marketplaceCatalogChannel,
  marketplaceThumbnail: marketplaceThumbnailChannel,
  marketplacePreview: marketplacePreviewChannel,
  marketplaceCacheInventory: marketplaceCacheInventoryChannel,
  marketplaceRemoveDownload: marketplaceRemoveDownloadChannel,
  marketplaceOpenSource: marketplaceOpenSourceChannel,
  windowAction: windowActionChannel,
  ambientState: ambientStateChannel,
  ambientPointerRegion: ambientPointerRegionChannel,
  ambientDrag: ambientDragChannel,
  ambientAvatarYaw: ambientAvatarYawChannel,
  companion: companionChannels,
  animation: animationChannels,
  motionPreference: motionPreferenceChannels,
  motionPersonality: motionPersonalityChannels,
  adapter: adapterChannels,
} as const;
