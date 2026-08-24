import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import {
  app,
  BrowserWindow,
  powerMonitor,
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
import {
  parseMotionPersonalityPolicy,
  type MotionPersonalityPolicy,
} from '../shared/motion-personality';
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
import type { PersistedAvatarSelection } from './avatar-asset-host';
import { createWindowOptions } from './window-options';

const applicationScheme = 'desky';
const ambientSize = { width: 420, height: 580 };
export const ambientStateChannel = 'desky:ambient-state';
export const ambientPointerRegionChannel = 'desky:ambient-pointer-region';
export const ambientDragChannel = 'desky:ambient-drag';
export const ambientAvatarYawChannel = 'desky:ambient-avatar-yaw';

interface PowerLifecycleProbe {
  read: () => {
    powerSuspended: boolean;
    resumeEpoch: number;
    suspendEpoch: number;
  };
  resume: () => void;
  suspend: () => void;
}

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
  powerLifecycle?: PowerLifecycleProbe,
): Promise<void> {
  const initialWindowBounds = window.getBounds();
  let visualExerciseError: string | null = null;
  let codexFilesystemEvidence: Record<string, unknown> | null = null;
  let performanceLifecycle: Record<string, unknown> | null = null;
  let realPowerLifecycle: Record<string, unknown> | null = null;
  const processMetricsBefore = app.getAppMetrics().map((metric) => ({
    type: metric.type,
    pid: metric.pid,
    workingSetSize: metric.memory?.workingSetSize ?? null,
  }));
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
  const visualAvatarId = process.env.DESKY_VISUAL_TEST_AVATAR_ID;
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'activate-avatar'
    && visualAvatarId) {
    await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const button = document.querySelector(
          '[data-avatar-id=${JSON.stringify(visualAvatarId)}]',
        );
        if (button instanceof HTMLButtonElement) {
          button.click();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Marketplace avatar button did not become available');
    })()`);
  }
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'preview-avatar'
    && visualAvatarId) {
    await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const button = document.querySelector(
          '[data-avatar-preview-id=${JSON.stringify(visualAvatarId)}]',
        );
        if (button instanceof HTMLButtonElement) {
          button.click();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Marketplace preview button did not become available');
    })()`);
  }
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'remove-avatar-download'
    && visualAvatarId) {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const avatarId = ${JSON.stringify(visualAvatarId)};
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 15000;
        let previewButton;
        while (Date.now() < deadline) {
          previewButton = document.querySelector('[data-avatar-preview-id="' + CSS.escape(avatarId) + '"]');
          if (previewButton instanceof HTMLButtonElement) break;
          await wait(50);
        }
        if (!(previewButton instanceof HTMLButtonElement)) throw new Error('Preview button is unavailable');
        previewButton.click();
        while (Date.now() < deadline
          && document.querySelector('.marketplace-preview-stage')?.dataset.previewState !== 'ready') {
          await wait(50);
        }
        if (document.querySelector('.marketplace-preview-stage')?.dataset.previewState !== 'ready') {
          throw new Error('Preview did not cache the admitted model');
        }
        document.querySelector('.marketplace-preview__heading button')?.click();
        let card;
        let removeButton;
        while (Date.now() < deadline) {
          card = document.querySelector('[data-avatar-card-id="' + CSS.escape(avatarId) + '"]');
          removeButton = document.querySelector('[data-avatar-remove-id="' + CSS.escape(avatarId) + '"]');
          if (card instanceof HTMLElement
            && card.dataset.avatarCacheStatus === 'verified'
            && removeButton instanceof HTMLButtonElement
            && !removeButton.disabled) break;
          await wait(50);
        }
        if (!(card instanceof HTMLElement) || !(removeButton instanceof HTMLButtonElement)) {
          throw new Error('Cached model did not become removable');
        }
        const storage = document.querySelector('.marketplace-storage');
        const beforeBytes = storage instanceof HTMLElement ? storage.dataset.cacheTotalBytes : '';
        removeButton.click();
        while (Date.now() < deadline && card.dataset.avatarCacheStatus !== 'missing') await wait(50);
        const afterBytes = storage instanceof HTMLElement ? storage.dataset.cacheTotalBytes : '';
        const verified = card.dataset.avatarCacheStatus === 'missing'
          && Number(afterBytes) < Number(beforeBytes);
        card.dataset.cacheRemovalVerified = String(verified);
        card.dataset.cacheBytesBeforeRemoval = beforeBytes;
        card.dataset.cacheBytesAfterRemoval = afterBytes;
        if (!verified) throw new Error('Model removal did not reduce verified cache storage');
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'avatar-switch-soak') {
    const requestedSwitchCount = Number.parseInt(
      process.env.DESKY_VISUAL_TEST_SWITCH_COUNT ?? '',
      10,
    );
    const switchCount = Number.isSafeInteger(requestedSwitchCount)
      ? Math.max(1, Math.min(requestedSwitchCount, 100))
      : 20;
    try {
      await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      let root = document.querySelector('.marketplace-view');
      const deadline = Date.now() + 55000;
      while (!root && Date.now() < deadline) {
        await wait(50);
        root = document.querySelector('.marketplace-view');
      }
      if (!(root instanceof HTMLElement)) throw new Error('Marketplace did not become available');
      const ids = [...document.querySelectorAll('[data-avatar-id]')]
        .map((button) => button.getAttribute('data-avatar-id'))
        .filter((value) => typeof value === 'string' && value.length > 0);
      if (ids.length < 3) throw new Error('Avatar-switch soak requires three admitted avatars');
      const completed = [];
      for (let index = 0; index < ${switchCount}; index += 1) {
        const active = root.dataset.activeAvatarId ?? '';
        const nextId = ids.find((id, offset) => id !== active && (offset + index) % 2 === 0)
          ?? ids.find((id) => id !== active);
        if (!nextId) throw new Error('No alternate companion was available');
        const button = document.querySelector('[data-avatar-id="' + CSS.escape(nextId) + '"]');
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
          throw new Error('Companion activation button was unavailable');
        }
        button.click();
        const switchDeadline = Math.min(deadline, Date.now() + 8000);
        while (Date.now() < switchDeadline) {
          if (root.dataset.activeAvatarId === nextId
            && root.dataset.avatarSelection === 'ready') break;
          await wait(40);
        }
        if (root.dataset.activeAvatarId !== nextId
          || root.dataset.avatarSelection !== 'ready') {
          throw new Error('Companion switch ' + (index + 1) + ' did not commit');
        }
        completed.push(nextId);
        await wait(80);
      }
      root.dataset.switchSoak = completed.join(',');
      return completed;
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'codex-ui'
    && process.env.DESKY_CODEX_UI_TEST_WORKSPACE) {
    const workspace = process.env.DESKY_CODEX_UI_TEST_WORKSPACE;
    const denyMarker = join(workspace, 'packaged-deny-marker.txt').replaceAll('\\', '/');
    const allowMarker = join(workspace, 'packaged-allow-marker.txt').replaceAll('\\', '/');
    const cancellationMarker = join(workspace, 'packaged-cancellation-marker.txt').replaceAll('\\', '/');
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeoutMs = 120000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await wait(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const root = await waitFor(
          () => document.querySelector('.control-center'),
          'the Control Center',
          15000,
        );
        const mark = (phase) => { root.dataset.codexUiExercise = phase; };
        const promptInput = () => document.querySelector('#control-prompt');
        const response = () => document.querySelector('.control-center__bubble p')?.textContent ?? '';
        const submitPrompt = async (text) => {
          const input = await waitFor(
            () => {
              const candidate = promptInput();
              return candidate instanceof HTMLInputElement && !candidate.disabled ? candidate : undefined;
            },
            'an enabled Codex prompt',
          );
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(60);
          input.closest('form')?.requestSubmit();
          await waitFor(
            () => root.dataset.activeTurnId || root.dataset.companionMode === 'listening',
            'Codex turn acceptance',
          );
        };
        const waitForTurnEnd = () => waitFor(
          () => !root.dataset.activeTurnId && !document.querySelector('.approval-card'),
          'Codex turn completion',
        );

        const provider = await waitFor(
          () => document.querySelector('[data-adapter-id="codex"]'),
          'the Codex provider option',
          15000,
        );
        provider.click();
        const form = await waitFor(
          () => document.querySelector('[data-provider-form="codex"]'),
          'the Codex provider form',
          15000,
        );
        mark('provider-selected');
        const workspaceButton = form.querySelector('.workspace-consent button');
        if (!(workspaceButton instanceof HTMLButtonElement)) throw new Error('Workspace consent control is unavailable');
        workspaceButton.click();
        await waitFor(
          () => {
            const value = form.querySelector('.workspace-consent span')?.textContent?.trim();
            return value && value !== 'No folder selected' ? value : undefined;
          },
          'the scoped workspace grant',
          15000,
        );
        mark('workspace-granted');
        form.requestSubmit();
        await waitFor(
          () => root.dataset.activeAdapterId === 'codex' && root.dataset.adapterStatus === 'connected',
          'the authenticated Codex connection',
          60000,
        );
        mark('connected');
        const newSession = await waitFor(
          () => {
            const candidate = document.querySelector('[data-session-new="true"]');
            return candidate instanceof HTMLButtonElement && !candidate.disabled
              ? candidate
              : undefined;
          },
          'the new-session control',
          15000,
        );
        const previousSession = document.querySelector('#adapter-session')?.value ?? '';
        newSession.click();
        await waitFor(
          () => {
            const select = document.querySelector('#adapter-session');
            return select instanceof HTMLSelectElement
              && select.value
              && select.value !== previousSession
              ? select.value
              : undefined;
          },
          'the packaged conformance session',
          30000,
        );
        mark('session-ready');

        await submitPrompt('Reply with exactly DESKY_CODEX_PACKAGED_STREAM_OK and no other text. Do not use tools.');
        await waitFor(
          () => response().includes('DESKY_CODEX_PACKAGED_STREAM_OK') && !root.dataset.activeTurnId,
          'the packaged assistant stream',
        );
        mark('stream-proved');

        await submitPrompt(${JSON.stringify([
          'Run this exact command once:',
          `node -e "require('node:fs').writeFileSync('${denyMarker}', 'DESKY_PACKAGED_DENY_BAD')"`,
          'Request sandbox approval if needed. Do not merely describe the command and do not stop before the approval is answered.',
        ].join('\n'))});
        const deny = await waitFor(
          () => document.querySelector('[data-approval-decision="deny"]'),
          'the deny approval control',
        );
        deny.click();
        await waitForTurnEnd();
        mark('deny-proved');

        await submitPrompt(${JSON.stringify([
          'Run this exact command once:',
          `node -e "require('node:fs').writeFileSync('${allowMarker}', 'DESKY_PACKAGED_ALLOW_OK')"`,
          'Request sandbox approval if needed. Do not merely describe the command and do not stop before the approval is answered.',
        ].join('\n'))});
        const allow = await waitFor(
          () => document.querySelector('[data-approval-decision="allow-once"]'),
          'the allow-once approval control',
        );
        allow.click();
        await waitForTurnEnd();
        mark('allow-proved');

        await submitPrompt(${JSON.stringify([
          'Run this exact command and wait for it to finish:',
          `node -e "setTimeout(() => require('node:fs').writeFileSync('${cancellationMarker}', 'DESKY_PACKAGED_CANCEL_BAD'), 10000)"`,
          'You must execute the command now. Request sandbox approval if needed. Do not explain it instead.',
        ].join('\n'))});
        const cancellationAllow = await waitFor(
          () => document.querySelector('[data-approval-decision="allow-once"]'),
          'approval for the cancellable command',
        );
        cancellationAllow.click();
        await wait(500);
        const stop = await waitFor(
          () => {
            const candidate = document.querySelector('.prompt-bar .cancel-button');
            return root.dataset.activeTurnId
              && candidate instanceof HTMLButtonElement
              && !candidate.disabled
              ? candidate
              : undefined;
          },
          'a running packaged Codex tool',
        );
        let reconnectObserved = root.dataset.adapterStatus === 'reconnecting';
        const observer = new MutationObserver(() => {
          reconnectObserved ||= root.dataset.adapterStatus === 'reconnecting';
        });
        observer.observe(root, { attributes: true, attributeFilter: ['data-adapter-status'] });
        stop.click();
        await waitFor(
          () => root.dataset.adapterStatus === 'connected' && !root.dataset.activeTurnId,
          'Codex process-tree cancellation and reconnect',
          60000,
        );
        observer.disconnect();
        if (!reconnectObserved) throw new Error('Codex reconnecting state was not observed after Stop');
        root.dataset.codexReconnectObserved = 'true';
        await wait(12000);
        mark('cancellation-proved');

        await submitPrompt('Reply with exactly DESKY_CODEX_PACKAGED_RECOVERY_OK and no other text. Do not use tools.');
        await waitFor(
          () => response().includes('DESKY_CODEX_PACKAGED_RECOVERY_OK') && !root.dataset.activeTurnId,
          'the post-cancellation packaged stream',
        );
        mark('passed');
      })()`);
      const readOptionalMarker = async (path: string): Promise<string | undefined> => {
        try {
          return await readFile(path, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      };
      const [denied, allowed, cancelled] = await Promise.all([
        readOptionalMarker(join(workspace, 'packaged-deny-marker.txt')),
        readOptionalMarker(join(workspace, 'packaged-allow-marker.txt')),
        readOptionalMarker(join(workspace, 'packaged-cancellation-marker.txt')),
      ]);
      codexFilesystemEvidence = {
        deniedMarkerAbsent: denied === undefined,
        allowedMarkerExact: allowed === 'DESKY_PACKAGED_ALLOW_OK',
        cancelledMarkerAbsent: cancelled === undefined,
      };
      if (denied !== undefined
        || allowed !== 'DESKY_PACKAGED_ALLOW_OK'
        || cancelled !== undefined) {
        throw new Error('Packaged Codex filesystem evidence did not match the approval and cancellation decisions');
      }
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  const hermesExercise = process.env.DESKY_VISUAL_TEST_EXERCISE;
  const hermesTestToken = process.env.DESKY_HERMES_UI_TEST_TOKEN;
  if (surface === 'control-center'
    && (hermesExercise === 'hermes-ui' || hermesExercise === 'hermes-ui-saved')
    && (hermesExercise === 'hermes-ui-saved' || hermesTestToken)) {
    const endpoint = process.env.DESKY_HERMES_UI_TEST_ENDPOINT ?? 'http://127.0.0.1:8642';
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const waitFor = async (read, label, timeoutMs = 120000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const value = read();
            if (value) return value;
            await wait(25);
          }
          throw new Error('Timed out waiting for ' + label);
        };
        const root = await waitFor(
          () => document.querySelector('.control-center'),
          'the Control Center',
          15000,
        );
        const testToken = ${JSON.stringify(hermesTestToken ?? '')};
        const savedOnly = ${JSON.stringify(hermesExercise === 'hermes-ui-saved')};
        const mark = (phase) => { root.dataset.hermesUiExercise = phase; };
        const setInput = (input, value) => {
          if (!(input instanceof HTMLInputElement)) throw new Error('Hermes input is unavailable');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const openConnection = async () => {
          if (!document.querySelector('[aria-label="Agent connection"]')) {
            const badge = document.querySelector('.control-center__actions .connection-badge');
            if (!(badge instanceof HTMLButtonElement)) throw new Error('Connection control is unavailable');
            badge.click();
          }
          return waitFor(
            () => document.querySelector('[data-provider-form="hermes"]'),
            'the Hermes provider form',
            15000,
          );
        };
        const disconnect = async () => {
          const form = await openConnection();
          const button = await waitFor(
            () => {
              const candidate = [...form.querySelectorAll('.connection-actions button')]
                .find((entry) => entry.textContent?.trim() === 'Disconnect');
              return candidate instanceof HTMLButtonElement && !candidate.disabled
                ? candidate
                : undefined;
            },
            'an enabled Hermes disconnect control',
            15000,
          );
          button.click();
          await waitFor(() => root.dataset.adapterStatus === 'disconnected', 'Hermes disconnect', 30000);
        };
        const connect = async (token, remember) => {
          const form = await openConnection();
          setInput(form.querySelector('#hermes-endpoint'), ${JSON.stringify(endpoint)});
          setInput(form.querySelector('#hermes-token'), token);
          const checkbox = form.querySelector('#hermes-remember-token');
          if (!(checkbox instanceof HTMLInputElement)) throw new Error('Hermes storage control is unavailable');
          if (checkbox.checked !== remember) checkbox.click();
          await waitFor(
            () => {
              const submit = form.querySelector('button[type="submit"]');
              return submit instanceof HTMLButtonElement && !submit.disabled ? submit : undefined;
            },
            'an enabled Hermes connect control',
            15000,
          );
          form.requestSubmit();
          await waitFor(
            () => root.dataset.activeAdapterId === 'hermes' && root.dataset.adapterStatus === 'connected',
            'the authenticated Hermes connection',
            60000,
          );
        };
        const response = () => document.querySelector('.control-center__bubble p')?.textContent ?? '';
        const submitPrompt = async (text) => {
          const input = await waitFor(
            () => {
              const candidate = document.querySelector('#control-prompt');
              return candidate instanceof HTMLInputElement && !candidate.disabled ? candidate : undefined;
            },
            'an enabled Hermes prompt',
          );
          setInput(input, text);
          await wait(60);
          input.closest('form')?.requestSubmit();
          await waitFor(() => root.dataset.activeTurnId, 'Hermes turn acceptance');
        };
        const waitForTurnEnd = () => waitFor(
          () => !root.dataset.activeTurnId && !document.querySelector('.approval-card'),
          'Hermes turn completion',
        );

        const provider = await waitFor(
          () => document.querySelector('[data-adapter-id="hermes"]'),
          'the Hermes provider option',
          15000,
        );
        provider.click();
        mark('provider-selected');
        await connect(savedOnly ? '' : testToken, true);
        mark(savedOnly ? 'restart-saved-access-proved' : 'connected');

        if (!savedOnly) {
          await disconnect();
          await connect('', true);
          mark('saved-access-proved');
        }

        const newSession = await waitFor(
          () => {
            const candidate = document.querySelector('[data-session-new="true"]');
            return candidate instanceof HTMLButtonElement && !candidate.disabled ? candidate : undefined;
          },
          'the new-session control',
          15000,
        );
        const previousHermesSession = document.querySelector('#adapter-session')?.value ?? '';
        newSession.click();
        await waitFor(
          () => {
            const select = document.querySelector('#adapter-session');
            return select instanceof HTMLSelectElement
              && select.value
              && select.value !== previousHermesSession
              ? select.value
              : undefined;
          },
          'the packaged Hermes session',
          30000,
        );
        mark('session-ready');

        const streamMarker = savedOnly
          ? 'DESKY_HERMES_PACKAGED_RESTART_OK'
          : 'DESKY_HERMES_PACKAGED_STREAM_OK';
        await submitPrompt('Reply with exactly ' + streamMarker + ' and no other text. Do not use tools.');
        await waitFor(
          () => response().includes(streamMarker) && !root.dataset.activeTurnId,
          'the packaged Hermes assistant stream',
        );
        mark('stream-proved');

        if (!savedOnly) {
          await submitPrompt('Use the terminal tool exactly once to run: chmod 777 /tmp/desky-hermes-packaged-cancel; python -c "import time; time.sleep(30)". Do not answer before attempting it.');
          const allow = await waitFor(
            () => document.querySelector('[data-approval-decision="allow-once"]'),
            'Hermes command approval',
          );
          allow.click();
          await wait(1500);
          const stop = await waitFor(
            () => {
              const candidate = document.querySelector('.prompt-bar .cancel-button');
              return root.dataset.activeTurnId && candidate instanceof HTMLButtonElement
                && !candidate.disabled ? candidate : undefined;
            },
            'the Hermes Stop control',
          );
          stop.click();
          await waitForTurnEnd();
          mark('stop-proved');
        }
        root.dataset.hermesTokenLeak = testToken && document.body.innerText.includes(testToken)
          ? 'true'
          : 'false';
        mark('passed');
      })()`);
    } catch (error) {
      const message = String(error);
      visualExerciseError = hermesTestToken
        ? message.replaceAll(hermesTestToken, '[redacted]')
        : message;
    }
  }
  if (surface === 'control-center'
    && (process.env.DESKY_VISUAL_TEST_EXERCISE === 'claude-ui'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'claude-ui-saved')) {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 15000;
        let root;
        while (Date.now() < deadline) {
          root = document.querySelector('.control-center');
          const provider = document.querySelector('[data-adapter-id="claude"]');
          if (root && provider instanceof HTMLButtonElement) {
            provider.click();
            while (Date.now() < deadline) {
              if (document.querySelector('[data-provider-form="claude"]')) {
                document.querySelector('[data-provider-form="claude"]')?.scrollIntoView({ block: 'start' });
                root.dataset.claudeUiExercise = 'provider-selected';
                return;
              }
              await wait(25);
            }
          }
          await wait(25);
        }
        throw new Error('Timed out waiting for the Claude admission form');
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'control-center'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrma-interruption') {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 30000;
        const waitFor = async (predicate, message) => {
          while (Date.now() < deadline) {
            const result = predicate();
            if (result) return result;
            await wait(25);
          }
          throw new Error(message);
        };
        const root = await waitFor(
          () => document.querySelector('.control-center'),
          'Control Center did not become available',
        );
        const card = await waitFor(
          () => document.querySelector('.animation-preview-card'),
          'Local animation preview controls did not become available',
        );
        const findButton = (label) => [...card.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === label);

        const full = await waitFor(
          () => findButton('Full'),
          'Full motion control did not become available',
        );
        full.click();
        await waitFor(
          () => findButton('Full')?.getAttribute('aria-pressed') === 'true',
          'Full motion preference was not applied',
        );

        const choose = await waitFor(
          () => findButton('Choose .vrma'),
          'Local animation chooser did not become available',
        );
        choose.click();
        const playing = await waitFor(() => {
          const status = card.querySelector('.animation-preview-card__status');
          return status?.classList.contains('animation-preview-card__status--playing')
            ? status
            : undefined;
        }, 'The selected VRM Animation did not begin playing');
        root.dataset.vrmaInterruption = 'playing';
        root.dataset.vrmaInterruptionStatus = playing.textContent?.trim() ?? '';

        const reduced = await waitFor(
          () => findButton('Reduced'),
          'Reduced motion control did not become available',
        );
        reduced.click();
        const interrupted = await waitFor(() => {
          const status = card.querySelector('.animation-preview-card__status');
          return status?.classList.contains('animation-preview-card__status--blocked')
            && status.textContent?.toLowerCase().includes('interrupted')
            ? status
            : undefined;
        }, 'Active VRM Animation did not report interruption');
        root.dataset.vrmaInterruption = 'passed';
        root.dataset.vrmaInterruptionStatus = interrupted.textContent?.trim() ?? '';
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'ambient'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-state-cycle') {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 30000;
        let stage;
        let canvas;
        while (Date.now() < deadline) {
          stage = document.querySelector('.avatar-stage');
          canvas = stage?.querySelector('canvas');
          if (stage instanceof HTMLElement
            && canvas instanceof HTMLCanvasElement
            && stage.dataset.avatarState === 'ready') break;
          await wait(50);
        }
        if (!(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
          throw new Error('VRM 1.0 state-cycle avatar did not become ready');
        }
        const status = stage.querySelector('.asset-status')?.textContent?.trim() ?? '';
        if (!status.includes('Seed-san') || !status.includes('VRM 1.0')) {
          throw new Error('VRM 1.0 state-cycle loaded the wrong fixture');
        }

        document.querySelector('.ambient-launcher button')?.click();
        let input;
        while (Date.now() < deadline) {
          input = document.querySelector('#ambient-prompt');
          if (input instanceof HTMLInputElement && !input.disabled) break;
          await wait(25);
        }
        if (!(input instanceof HTMLInputElement)) throw new Error('Simulation composer is unavailable');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'Exercise the normalized companion state cycle.');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = input.closest('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('Simulation composer form is unavailable');
        await wait(50);
        form.requestSubmit();

        const expected = ['idle', 'listening', 'thinking', 'working', 'speaking', 'success'];
        const observed = new Map();
        while (Date.now() < deadline) {
          const mode = canvas.dataset.motionMode;
          if (mode && !observed.has(mode)) {
            observed.set(mode, canvas.dataset.motionStateClip ?? '');
          }
          if (expected.every((modeName) => observed.has(modeName))) break;
          await wait(20);
        }
        const missing = expected.filter((modeName) => !observed.has(modeName));
        if (missing.length > 0) throw new Error('VRM 1.0 state cycle missed: ' + missing.join(', '));
        if (canvas.dataset.motionClipError) {
          throw new Error('VRM 1.0 state cycle reported a clip error: ' + canvas.dataset.motionClipError);
        }
        stage.dataset.vrm1FixtureVerified = 'true';
        stage.dataset.vrm1StateCycleVerified = 'true';
        stage.dataset.vrm1ObservedModes = JSON.stringify(Object.fromEntries(observed));
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  const requestedWaitMs = Number.parseInt(process.env.DESKY_VISUAL_TEST_WAIT_MS ?? '', 10);
  const waitMs = Number.isSafeInteger(requestedWaitMs)
    ? Math.max(0, Math.min(requestedWaitMs, 60_000))
    : 8_000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  if (surface === 'ambient'
    && (process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-compatibility'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-jump'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-state-cycle')) {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const stage = document.querySelector('.avatar-stage');
          const status = stage?.querySelector('.asset-status')?.textContent?.trim() ?? '';
          if (stage instanceof HTMLElement
            && stage.dataset.avatarState === 'ready'
            && status.includes('Seed-san')
            && status.includes('VRM 1.0')
            && status.includes('VRM-Public-License-1.0')) {
            stage.dataset.vrm1FixtureVerified = 'true';
            return;
          }
          await wait(50);
        }
        throw new Error('Pinned VRM 1.0 fixture did not reach a rights-reviewed ready state');
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
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
  if (surface === 'ambient'
    && (process.env.DESKY_VISUAL_TEST_EXERCISE === 'jump'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-compatibility'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-jump')) {
    await window.webContents.executeJavaScript(`(async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const avatar = document.querySelector('.ambient-avatar-hitbox');
      avatar?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await wait(500);
      const canvas = document.querySelector('.avatar-stage canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Avatar canvas is unavailable');
      const maxX = Number.parseFloat(canvas.dataset.framingMaxX ?? 'Infinity');
      const maxY = Number.parseFloat(canvas.dataset.framingMaxY ?? 'Infinity');
      canvas.dataset.motionFramingVerified = String(maxX <= 0.985 && maxY <= 0.985);
      if (canvas.dataset.motionFramingVerified !== 'true') {
        throw new Error('Expansive motion exceeded the live framing envelope');
      }
    })()`);
  }
  if (surface === 'ambient'
    && (process.env.DESKY_VISUAL_TEST_EXERCISE === 'webgl-loss'
      || process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-compatibility')) {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        let canvas;
        while (Date.now() < deadline) {
          canvas = document.querySelector('.avatar-stage canvas');
          if (canvas instanceof HTMLCanvasElement
            && canvas.dataset.motionFrame
            && canvas.dataset.webglState === 'ready') break;
          await wait(50);
        }
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Avatar WebGL canvas is unavailable');
        const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const extension = context?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WEBGL_lose_context is unavailable');
        const frameBefore = Number.parseInt(canvas.dataset.motionFrame ?? '0', 10);
        extension.loseContext();
        await wait(450);
        if (canvas.dataset.webglState !== 'lost') throw new Error('WebGL loss was not observed');
        extension.restoreContext();
        const restoreDeadline = Date.now() + 5000;
        while (Date.now() < restoreDeadline && canvas.dataset.webglState !== 'recovered') {
          await wait(50);
        }
        await wait(500);
        const frameAfter = Number.parseInt(canvas.dataset.motionFrame ?? '0', 10);
        canvas.dataset.webglRecoveryVerified = String(
          canvas.dataset.webglState === 'recovered' && frameAfter > frameBefore,
        );
        if (canvas.dataset.webglRecoveryVerified !== 'true') {
          throw new Error('Avatar rendering did not recover after WebGL restoration');
        }
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'ambient'
    && process.env.DESKY_VISUAL_TEST_EXERCISE === 'vrm1-compatibility') {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 30000;
        const stage = document.querySelector('.avatar-stage');
        const canvas = stage?.querySelector('canvas');
        if (!(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
          throw new Error('VRM 1.0 compatibility surface is unavailable');
        }
        await window.desky.setMotionPreference('reduced');
        while (Date.now() < deadline && canvas.dataset.motionReduced !== 'true') await wait(25);
        if (canvas.dataset.motionReduced !== 'true') {
          throw new Error('VRM 1.0 reduced-motion state was not observed');
        }
        stage.dataset.vrm1ReducedMotionVerified = 'true';

        await window.desky.setMotionPreference('full');
        while (Date.now() < deadline) {
          if (canvas.dataset.motionReduced === 'false'
            && !canvas.dataset.motionActiveProgram
            && Boolean(canvas.dataset.motionStateClip)) {
            stage.dataset.vrm1IdleRestored = 'true';
            return;
          }
          await wait(25);
        }
        throw new Error('VRM 1.0 idle state did not resume after action and reduced motion');
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'webgl-unrecoverable') {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const deadline = Date.now() + 10000;
        let canvas;
        while (Date.now() < deadline) {
          canvas = document.querySelector('.avatar-stage canvas');
          if (canvas instanceof HTMLCanvasElement
            && canvas.dataset.motionFrame
            && canvas.dataset.webglState === 'ready') break;
          await wait(50);
        }
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Avatar WebGL canvas is unavailable');
        const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const extension = context?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WEBGL_lose_context is unavailable');
        extension.loseContext();
        const failureDeadline = Date.now() + 5000;
        while (Date.now() < failureDeadline && canvas.dataset.webglState !== 'unrecoverable') {
          await wait(50);
        }
        if (canvas.dataset.webglState !== 'unrecoverable') {
          throw new Error('Unrecoverable WebGL fallback was not reached');
        }
        const retry = document.querySelector('[data-webgl-retry]');
        if (!(retry instanceof HTMLButtonElement)) throw new Error('Graphics retry control is unavailable');
        retry.click();
        const retryDeadline = Date.now() + 10000;
        let replacement;
        while (Date.now() < retryDeadline) {
          replacement = document.querySelector('.avatar-stage canvas');
          if (replacement instanceof HTMLCanvasElement
            && replacement !== canvas
            && replacement.dataset.webglState === 'ready'
            && Number.parseInt(replacement.dataset.motionFrame ?? '0', 10) > 0
            && document.querySelector('.avatar-stage')?.dataset.avatarState === 'ready') break;
          await wait(50);
        }
        if (!(replacement instanceof HTMLCanvasElement) || replacement === canvas) {
          throw new Error('Graphics retry did not create a fresh rendering surface');
        }
        replacement.dataset.webglUnrecoverableRetryVerified = 'true';
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
    }
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'render-lifecycle') {
    try {
      const readLoop = async () => window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('.avatar-stage canvas');
        return {
          frame: Number.parseInt(canvas?.dataset.motionFrame ?? '0', 10),
          suspended: canvas?.dataset.renderSuspended ?? null,
          reason: canvas?.dataset.renderSuspensionReason ?? null,
        };
      })()`) as Promise<{ frame: number; suspended: string | null; reason: string | null }>;
      const readyDeadline = Date.now() + 10000;
      let initial = await readLoop();
      while (Date.now() < readyDeadline && initial.frame < 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        initial = await readLoop();
      }
      window.hide();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const hiddenA = await readLoop();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const hiddenB = await readLoop();
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const visible = await readLoop();
      if (hiddenA.suspended !== 'true'
        || !['native-hidden', 'document-hidden'].includes(hiddenA.reason ?? '')
        || hiddenB.frame !== hiddenA.frame
        || visible.frame <= hiddenB.frame) {
        throw new Error('Native hidden-surface rendering did not suspend and resume cleanly');
      }
      if (!powerLifecycle) throw new Error('Power lifecycle harness is unavailable');
      powerLifecycle.suspend();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const asleepA = await readLoop();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const asleepB = await readLoop();
      powerLifecycle.resume();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const awake = await readLoop();
      if (asleepA.suspended !== 'true'
        || asleepA.reason !== 'power-suspend'
        || asleepB.frame !== asleepA.frame
        || awake.frame <= asleepB.frame) {
        throw new Error('Power lifecycle rendering did not suspend and resume cleanly');
      }
      await window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('.avatar-stage canvas');
        if (canvas instanceof HTMLCanvasElement) {
          canvas.dataset.renderLifecycleVerified = 'true';
          canvas.dataset.hiddenSuspendedFrame = ${hiddenA.frame.toString()};
          canvas.dataset.powerSuspendedFrame = ${asleepA.frame.toString()};
        }
      })()`);
    } catch (error) {
      visualExerciseError = String(error);
      if (!window.isVisible()) window.showInactive();
      powerLifecycle?.resume();
    }
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
    const observed: string[] = [];
    let previous = '';
    const deadline = Date.now() + 50_000;
    while (Date.now() < deadline) {
      const program = await window.webContents.executeJavaScript(
        "document.querySelector('.avatar-stage canvas')?.dataset.motionActiveProgram ?? ''",
      ) as string;
      if (program && !previous) {
        observed.push(program);
        await new Promise((resolve) => setTimeout(resolve, 450));
        const safeProgram = program.replace(/[^a-z0-9-]/g, '');
        if (safeProgram) {
          const frame = await window.webContents.capturePage();
          await writeFile(`${outputPath}.${safeProgram}.png`, frame.toPNG());
        }
      }
      previous = program;
      await window.webContents.executeJavaScript(`(() => {
        const stage = document.querySelector('.avatar-stage');
        if (stage instanceof HTMLElement) {
          stage.dataset.observedPrograms = ${JSON.stringify(observed.join(','))};
        }
      })()`);
      if (observed.length >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'performance-lifecycle') {
    try {
      const readRenderState = async () => window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('.avatar-stage canvas');
        return {
          avatarState: document.querySelector('.avatar-stage')?.dataset.avatarState ?? null,
          frame: Number.parseInt(canvas?.dataset.motionFrame ?? '0', 10),
          suspended: canvas?.dataset.renderSuspended ?? null,
          reason: canvas?.dataset.renderSuspensionReason ?? null,
        };
      })()`) as Promise<{
        avatarState: string | null;
        frame: number;
        suspended: string | null;
        reason: string | null;
      }>;
      const readyDeadline = Date.now() + 10000;
      let readyState = await readRenderState();
      while (Date.now() < readyDeadline
        && (readyState.avatarState !== 'ready' || readyState.frame < 1)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        readyState = await readRenderState();
      }
      if (readyState.avatarState !== 'ready') throw new Error('Avatar was not ready for performance sampling');

      const sampleMetrics = () => app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        percentCpuUsage: metric.cpu?.percentCPUUsage ?? null,
        workingSetSize: metric.memory?.workingSetSize ?? null,
      }));
      const readSampleCount = (name: string, fallback: number) => {
        const parsed = Number.parseInt(process.env[name] ?? '', 10);
        return Number.isFinite(parsed) && parsed >= 1 && parsed <= 300 ? parsed : fallback;
      };
      const samplePhase = async (count: number) => {
        const samples: ReturnType<typeof sampleMetrics>[] = [];
        for (let index = 0; index < count; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          samples.push(sampleMetrics());
        }
        return samples;
      };
      const summarize = (
        samples: Awaited<ReturnType<typeof samplePhase>>,
        type?: string,
      ) => {
        const cpuTotals = samples.map((sample) => sample
          .filter((metric) => !type || metric.type === type)
          .reduce((total, metric) => total + (metric.percentCpuUsage ?? 0), 0));
        const workingSetTotals = samples.map((sample) => sample
          .filter((metric) => !type || metric.type === type)
          .map((metric) => metric.workingSetSize)
          .filter((value): value is number => typeof value === 'number')
          .reduce((total, value) => total + value, 0));
        return {
          averagePercentCpuUsage: cpuTotals.length > 0
            ? cpuTotals.reduce((total, value) => total + value, 0) / cpuTotals.length
            : null,
          peakPercentCpuUsage: cpuTotals.length > 0 ? Math.max(...cpuTotals) : null,
          peakWorkingSetSize: workingSetTotals.length > 0 ? Math.max(...workingSetTotals) : null,
        };
      };

      sampleMetrics();
      const visibleSamples = await samplePhase(readSampleCount('DESKY_PERFORMANCE_VISIBLE_SAMPLES', 10));
      const frameBeforeHide = (await readRenderState()).frame;
      window.hide();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const hiddenState = await readRenderState();
      const hiddenSamples = await samplePhase(readSampleCount('DESKY_PERFORMANCE_HIDDEN_SAMPLES', 6));
      const frameAfterHidden = (await readRenderState()).frame;
      window.showInactive();
      const recoveredSamples = await samplePhase(readSampleCount('DESKY_PERFORMANCE_RECOVERED_SAMPLES', 3));
      const recoveredState = await readRenderState();
      const hiddenFrameStable = hiddenState.suspended === 'true'
        && ['native-hidden', 'document-hidden'].includes(hiddenState.reason ?? '')
        && frameAfterHidden === hiddenState.frame;
      const recoveryAdvanced = recoveredState.frame > frameAfterHidden;
      if (!hiddenFrameStable || !recoveryAdvanced) {
        throw new Error('Timed lifecycle probe did not suspend and recover the render loop');
      }
      performanceLifecycle = {
        intervalMs: 1000,
        visibleSampleCount: visibleSamples.length,
        hiddenSampleCount: hiddenSamples.length,
        recoveredSampleCount: recoveredSamples.length,
        frameBeforeHide,
        hiddenFrame: hiddenState.frame,
        frameAfterHidden,
        recoveredFrame: recoveredState.frame,
        hiddenReason: hiddenState.reason,
        hiddenFrameStable,
        recoveryAdvanced,
        visible: {
          application: summarize(visibleSamples),
          browser: summarize(visibleSamples, 'Browser'),
          renderer: summarize(visibleSamples, 'Tab'),
          gpu: summarize(visibleSamples, 'GPU'),
          utility: summarize(visibleSamples, 'Utility'),
        },
        hidden: {
          application: summarize(hiddenSamples),
          browser: summarize(hiddenSamples, 'Browser'),
          renderer: summarize(hiddenSamples, 'Tab'),
          gpu: summarize(hiddenSamples, 'GPU'),
          utility: summarize(hiddenSamples, 'Utility'),
        },
        recovered: {
          application: summarize(recoveredSamples),
          browser: summarize(recoveredSamples, 'Browser'),
          renderer: summarize(recoveredSamples, 'Tab'),
          gpu: summarize(recoveredSamples, 'GPU'),
          utility: summarize(recoveredSamples, 'Utility'),
        },
      };
    } catch (error) {
      visualExerciseError = String(error);
      if (!window.isVisible()) window.showInactive();
    }
  }
  if (surface === 'ambient' && process.env.DESKY_VISUAL_TEST_EXERCISE === 'real-power-lifecycle') {
    try {
      if (!powerLifecycle) throw new Error('Power lifecycle probe is unavailable');
      const readRenderState = async () => window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('.avatar-stage canvas');
        return {
          avatarState: document.querySelector('.avatar-stage')?.dataset.avatarState ?? null,
          frame: Number.parseInt(canvas?.dataset.motionFrame ?? '0', 10),
          suspended: canvas?.dataset.renderSuspended ?? null,
          reason: canvas?.dataset.renderSuspensionReason ?? null,
        };
      })()`) as Promise<{
        avatarState: string | null;
        frame: number;
        suspended: string | null;
        reason: string | null;
      }>;
      const readyDeadline = Date.now() + 10000;
      let initialRenderState = await readRenderState();
      while (Date.now() < readyDeadline
        && (initialRenderState.avatarState !== 'ready' || initialRenderState.frame < 1)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        initialRenderState = await readRenderState();
      }
      if (initialRenderState.avatarState !== 'ready' || initialRenderState.frame < 1) {
        throw new Error('Avatar was not ready for the real power lifecycle probe');
      }

      const baseline = powerLifecycle.read();
      const waitingAt = new Date().toISOString();
      await writeFile(`${outputPath}.ready.json`, `${JSON.stringify({
        baseline,
        frameBeforeSuspend: initialRenderState.frame,
        waitingAt,
      }, null, 2)}\n`, 'utf8');

      const waitStartedAt = Date.now();
      const deadline = waitStartedAt + 15 * 60 * 1000;
      let observed = powerLifecycle.read();
      while (Date.now() < deadline
        && !(observed.suspendEpoch > baseline.suspendEpoch
          && observed.resumeEpoch > baseline.resumeEpoch
          && !observed.powerSuspended)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        observed = powerLifecycle.read();
      }
      if (observed.suspendEpoch <= baseline.suspendEpoch) {
        throw new Error('Electron did not observe a real operating-system suspend event');
      }
      if (observed.resumeEpoch <= baseline.resumeEpoch || observed.powerSuspended) {
        throw new Error('Electron did not observe a matching real operating-system resume event');
      }

      const resumedAt = new Date().toISOString();
      await writeFile(`${outputPath}.resume.json`, `${JSON.stringify({
        baseline,
        observed,
        resumedAt,
        elapsedWallClockMs: Date.now() - waitStartedAt,
      }, null, 2)}\n`, 'utf8');

      const frameImmediatelyAfterResume = (await readRenderState()).frame;
      const recoveryDeadline = Date.now() + 30000;
      let recoveredRenderState = await readRenderState();
      while (Date.now() < recoveryDeadline
        && (recoveredRenderState.avatarState !== 'ready'
          || recoveredRenderState.suspended === 'true'
          || recoveredRenderState.frame <= frameImmediatelyAfterResume)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        recoveredRenderState = await readRenderState();
      }
      if (recoveredRenderState.avatarState !== 'ready'
        || recoveredRenderState.suspended === 'true'
        || recoveredRenderState.frame <= frameImmediatelyAfterResume) {
        throw new Error('Avatar rendering did not recover after the real operating-system resume');
      }
      realPowerLifecycle = {
        baseline,
        observed,
        waitingAt,
        resumedAt,
        elapsedWallClockMs: Date.now() - waitStartedAt,
        frameBeforeSuspend: initialRenderState.frame,
        frameImmediatelyAfterResume,
        recoveredFrame: recoveredRenderState.frame,
        recoveredAvatarState: recoveredRenderState.avatarState,
        recoveredSuspended: recoveredRenderState.suspended,
        recoveredSuspensionReason: recoveredRenderState.reason,
      };
    } catch (error) {
      visualExerciseError = String(error);
    }
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
    avatarStatusText: document.querySelector('.avatar-stage .asset-status')?.textContent?.trim() ?? null,
    avatarTextureCount: document.querySelector('.avatar-stage')?.dataset.avatarTextureCount ?? null,
    vrm1FixtureVerified: document.querySelector('.avatar-stage')?.dataset.vrm1FixtureVerified ?? null,
    vrm1ReducedMotionVerified: document.querySelector('.avatar-stage')?.dataset.vrm1ReducedMotionVerified ?? null,
    vrm1IdleRestored: document.querySelector('.avatar-stage')?.dataset.vrm1IdleRestored ?? null,
    vrm1StateCycleVerified: document.querySelector('.avatar-stage')?.dataset.vrm1StateCycleVerified ?? null,
    vrm1ObservedModes: document.querySelector('.avatar-stage')?.dataset.vrm1ObservedModes ?? null,
    motionFrame: document.querySelector('.avatar-stage canvas')?.dataset.motionFrame ?? null,
    motionElapsed: document.querySelector('.avatar-stage canvas')?.dataset.motionElapsed ?? null,
    renderTargetFps: document.querySelector('.avatar-stage canvas')?.dataset.renderTargetFps ?? null,
    motionMode: document.querySelector('.avatar-stage canvas')?.dataset.motionMode ?? null,
    motionStateClip: document.querySelector('.avatar-stage canvas')?.dataset.motionStateClip ?? null,
    motionActiveProgram: document.querySelector('.avatar-stage canvas')?.dataset.motionActiveProgram ?? null,
    motionActiveCue: document.querySelector('.avatar-stage canvas')?.dataset.motionActiveCue ?? null,
    motionPendingCues: document.querySelector('.avatar-stage canvas')?.dataset.motionPendingCues ?? null,
    motionReduced: document.querySelector('.avatar-stage canvas')?.dataset.motionReduced ?? null,
    motionClipError: document.querySelector('.avatar-stage canvas')?.dataset.motionClipError ?? null,
    framingZoom: document.querySelector('.avatar-stage canvas')?.dataset.framingZoom ?? null,
    framingTargetZoom: document.querySelector('.avatar-stage canvas')?.dataset.framingTargetZoom ?? null,
    framingMaxX: document.querySelector('.avatar-stage canvas')?.dataset.framingMaxX ?? null,
    framingMaxY: document.querySelector('.avatar-stage canvas')?.dataset.framingMaxY ?? null,
    framingConstrained: document.querySelector('.avatar-stage canvas')?.dataset.framingConstrained ?? null,
    motionFramingVerified: document.querySelector('.avatar-stage canvas')?.dataset.motionFramingVerified ?? null,
    webglState: document.querySelector('.avatar-stage canvas')?.dataset.webglState ?? null,
    webglLossCount: document.querySelector('.avatar-stage canvas')?.dataset.webglLossCount ?? null,
    webglRestoreCount: document.querySelector('.avatar-stage canvas')?.dataset.webglRestoreCount ?? null,
    webglRecoveryVerified: document.querySelector('.avatar-stage canvas')?.dataset.webglRecoveryVerified ?? null,
    webglUnrecoverableRetryVerified: document.querySelector('.avatar-stage canvas')?.dataset.webglUnrecoverableRetryVerified ?? null,
    renderSuspended: document.querySelector('.avatar-stage canvas')?.dataset.renderSuspended ?? null,
    renderSuspensionReason: document.querySelector('.avatar-stage canvas')?.dataset.renderSuspensionReason ?? null,
    renderLifecycleVerified: document.querySelector('.avatar-stage canvas')?.dataset.renderLifecycleVerified ?? null,
    hiddenSuspendedFrame: document.querySelector('.avatar-stage canvas')?.dataset.hiddenSuspendedFrame ?? null,
    powerSuspendedFrame: document.querySelector('.avatar-stage canvas')?.dataset.powerSuspendedFrame ?? null,
    motionObservedPrograms: document.querySelector('.avatar-stage')?.dataset.observedPrograms ?? null,
    motionPreferenceError: ${JSON.stringify(motionPreferenceError)},
    visualExerciseError: ${JSON.stringify(visualExerciseError)},
    activeAdapterId: document.querySelector('.control-center')?.dataset.activeAdapterId ?? null,
    adapterStatus: document.querySelector('.control-center')?.dataset.adapterStatus ?? null,
    selectedAdapterId: document.querySelector('.control-center')?.dataset.selectedAdapterId ?? null,
    codexUiExercise: document.querySelector('.control-center')?.dataset.codexUiExercise ?? null,
    codexReconnectObserved: document.querySelector('.control-center')?.dataset.codexReconnectObserved ?? null,
    hermesUiExercise: document.querySelector('.control-center')?.dataset.hermesUiExercise ?? null,
    hermesTokenLeak: document.querySelector('.control-center')?.dataset.hermesTokenLeak ?? null,
    claudeUiExercise: document.querySelector('.control-center')?.dataset.claudeUiExercise ?? null,
    vrmaInterruption: document.querySelector('.control-center')?.dataset.vrmaInterruption ?? null,
    vrmaInterruptionStatus: document.querySelector('.control-center')?.dataset.vrmaInterruptionStatus ?? null,
    adapterOptions: [...document.querySelectorAll('[data-adapter-id]')].map((button) => ({
      adapterId: button.dataset.adapterId,
      selected: button.dataset.adapterSelected
    })),
    codexFormVisible: Boolean(document.querySelector('[data-provider-form="codex"]')),
    hermesFormVisible: Boolean(document.querySelector('[data-provider-form="hermes"]')),
    claudeFormVisible: Boolean(document.querySelector('[data-provider-form="claude"]')),
    avatarYawDegrees: document.querySelector('.ambient-companion')?.dataset.avatarYawDegrees ?? null,
    marketplaceVisible: Boolean(document.querySelector('.marketplace-view')),
    marketplaceCards: document.querySelectorAll('.marketplace-avatar-card').length,
    marketplaceThumbnails: document.querySelectorAll('.marketplace-avatar-card__visual img').length,
    marketplaceCommerce: document.querySelector('.marketplace-kicker')?.textContent?.trim() ?? null,
    marketplaceActive: document.querySelector('.marketplace-avatar-card__actions button:disabled')?.textContent?.trim() ?? null,
    marketplaceSelection: document.querySelector('.marketplace-view')?.dataset.avatarSelection ?? null,
    marketplaceActiveAvatarId: document.querySelector('.marketplace-view')?.dataset.activeAvatarId ?? null,
    marketplacePreviewState: document.querySelector('.marketplace-preview-stage')?.dataset.previewState ?? null,
    marketplaceSwitchSoak: document.querySelector('.marketplace-view')?.dataset.switchSoak ?? null,
    marketplaceCacheTotalBytes: document.querySelector('.marketplace-storage')?.dataset.cacheTotalBytes ?? null,
    marketplaceCacheStatuses: [...document.querySelectorAll('[data-avatar-card-id]')].map((card) => ({
      avatarId: card.dataset.avatarCardId,
      status: card.dataset.avatarCacheStatus,
      protected: card.dataset.avatarCacheProtected,
      removalVerified: card.dataset.cacheRemovalVerified ?? null,
      bytesBeforeRemoval: card.dataset.cacheBytesBeforeRemoval ?? null,
      bytesAfterRemoval: card.dataset.cacheBytesAfterRemoval ?? null
    }))
  })`) as Record<string, unknown>;
  const diagnostic = {
    ...rendererDiagnostic,
    initialWindowBounds,
    nativeWindowBounds: window.getBounds(),
    processMetricsBefore,
    processMetricsAfter: app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetSize: metric.memory?.workingSetSize ?? null,
    })),
    performanceLifecycle,
    realPowerLifecycle,
    codexFilesystemEvidence,
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
  const visualTestExercise = process.env.DESKY_VISUAL_TEST_EXERCISE;
  if (visualTestExercise) url.searchParams.set('visualExercise', visualTestExercise);
  if (process.env.DESKY_VISUAL_TEST_EXERCISE === 'webgl-unrecoverable') {
    url.searchParams.set('webglRecoveryTimeoutMs', '1200');
  }
  return url.toString();
}

export class DeskyWindowManager {
  private ambient?: BrowserWindow;

  private controlCenter?: BrowserWindow;

  private desktopState: DesktopState;

  private readonly desktopControls: DesktopControls;

  private fullClickThrough = false;

  private pointerRegion: AmbientPointerRegion = 'transparent';

  private powerSuspended = false;

  private suspendEpoch = 0;

  private ambientVisibleBeforeSuspend = false;

  private resumeEpoch = 0;

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

  getAvatarSelection(): PersistedAvatarSelection {
    return {
      activeRevisionId: this.desktopState.activeAvatarRevisionId,
      fallbackRevisionId: this.desktopState.fallbackAvatarRevisionId,
    };
  }

  setAvatarSelection(selection: PersistedAvatarSelection): void {
    this.desktopState = {
      ...this.desktopState,
      activeAvatarRevisionId: selection.activeRevisionId,
      fallbackAvatarRevisionId: selection.fallbackRevisionId,
    };
    this.stateStore.save(this.desktopState);
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
    powerMonitor.on('suspend', this.handlePowerSuspend);
    powerMonitor.on('resume', this.handlePowerResume);
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
      powerSuspended: this.powerSuspended,
      recoveryAvailable: this.desktopControls.hasRecoverySurface,
      recoveryShortcut: this.desktopControls.recoveryShortcut,
      recoveryShortcutRegistered: this.desktopControls.isShortcutRegistered,
      resumeEpoch: this.resumeEpoch,
      trayAvailable: this.desktopControls.isTrayAvailable,
      visible: Boolean(
        this.ambient
        && !this.ambient.isDestroyed()
        && this.ambient.isVisible(),
      ),
      workArea: clamped.display.workArea,
    };
  }

  getMotionPersonality(): MotionPersonalityPolicy {
    return structuredClone(this.desktopState.motionPersonality);
  }

  setMotionPersonality(value: unknown): MotionPersonalityPolicy {
    const motionPersonality = parseMotionPersonalityPolicy(value);
    this.desktopState = { ...this.desktopState, motionPersonality };
    this.stateStore.save(this.desktopState);
    return structuredClone(motionPersonality);
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
    powerMonitor.removeListener('suspend', this.handlePowerSuspend);
    powerMonitor.removeListener('resume', this.handlePowerResume);
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
        void captureVisualTest(window, surface, visualTestPath, {
          read: () => ({
            powerSuspended: this.powerSuspended,
            resumeEpoch: this.resumeEpoch,
            suspendEpoch: this.suspendEpoch,
          }),
          suspend: this.handlePowerSuspend,
          resume: this.handlePowerResume,
        });
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

  private readonly handlePowerSuspend = (): void => {
    if (this.powerSuspended) return;
    this.ambientVisibleBeforeSuspend = Boolean(
      this.ambient
      && !this.ambient.isDestroyed()
      && this.ambient.isVisible(),
    );
    this.powerSuspended = true;
    this.suspendEpoch += 1;
    this.publishAmbientState();
  };

  private readonly handlePowerResume = (): void => {
    if (!this.powerSuspended) return;
    this.powerSuspended = false;
    this.resumeEpoch += 1;
    this.clampAmbientToWorkArea();
    if (this.ambientVisibleBeforeSuspend && this.ambient && !this.ambient.isDestroyed()) {
      this.ambient.showInactive();
      if (this.desktopState.alwaysOnTop) this.ambient.moveTop();
      this.ambient.webContents.invalidate();
    }
    this.ambientVisibleBeforeSuspend = false;
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
