import type { DistributionProfile } from '../../shared/runtime';
import { join } from 'node:path';

import { ClaudeRuntime } from '../claude/runtime';
import { CodexRuntime } from '../codex/runtime';
import { HermesRuntime } from '../hermes/runtime';
import { OpenClawRuntime } from './openclaw-runtime';
import type { CreateProfileRuntimes } from './profile-runtime-contract';
import type { AgentAdapterRuntime } from './runtime';

/**
 * Constructs only runtimes admitted by the immutable package profile. In
 * particular, Store builds never instantiate a local-CLI adapter.
 */
export function agentRuntimesForProfile(
  profile: DistributionProfile,
  openClaw: AgentAdapterRuntime,
  createDirectCodex: () => AgentAdapterRuntime,
  createDirectHermes: () => AgentAdapterRuntime,
  createClaudeAdmissionCandidate?: () => AgentAdapterRuntime,
): AgentAdapterRuntime[] {
  return profile === 'direct'
    ? [
        openClaw,
        createDirectCodex(),
        createDirectHermes(),
        ...(createClaudeAdmissionCandidate ? [createClaudeAdmissionCandidate()] : []),
      ]
    : [openClaw];
}

export const createProfileRuntimes: CreateProfileRuntimes = (input) => agentRuntimesForProfile(
  'direct',
  new OpenClawRuntime(input.openClaw),
  () => new CodexRuntime({
    appVersion: input.appVersion,
    resolveWorkspaceGrant: (grantId, sandbox) => input.workspaceGrants.resolve(grantId, sandbox),
  }),
  () => new HermesRuntime({ vault: input.vault }),
  input.visualTestExercise === 'claude-ui'
    || input.visualTestExercise === 'claude-ui-saved'
    ? () => new ClaudeRuntime({
        appVersion: input.appVersion,
        vault: input.vault,
        cliExecutablePath: input.packaged ? join(input.resourcesPath, 'claude.exe') : undefined,
        resolveWorkspaceGrant: (grantId, sandbox) => input.workspaceGrants.resolve(grantId, sandbox),
      })
    : undefined,
);
