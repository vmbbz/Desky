import { CodexRuntime } from '../codex/runtime';
import { HermesRuntime } from '../hermes/runtime';
import { OpenClawRuntime } from './openclaw-runtime';
import type { CreateProfileRuntimes } from './profile-runtime-contract';

/** Signed/notarized direct module graph: admitted production adapters only. */
export const createProfileRuntimes: CreateProfileRuntimes = (input) => [
  new OpenClawRuntime(input.openClaw),
  new CodexRuntime({
    appVersion: input.appVersion,
    resolveWorkspaceGrant: (grantId, sandbox) => input.workspaceGrants.resolve(grantId, sandbox),
  }),
  new HermesRuntime({ vault: input.vault }),
];
