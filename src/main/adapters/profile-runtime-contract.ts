import type { OpenClawAdapterHost } from '../openclaw/host';
import type { SecureVault } from '../openclaw/secure-vault';
import type { CodexWorkspaceGrantBroker } from '../codex/workspace-grants';
import type { AgentAdapterRuntime } from './runtime';

export interface ProfileRuntimeInput {
  appVersion: string;
  openClaw: OpenClawAdapterHost;
  vault: SecureVault;
  workspaceGrants: CodexWorkspaceGrantBroker;
  packaged: boolean;
  resourcesPath: string;
  visualTestExercise?: string;
}

export type CreateProfileRuntimes = (input: ProfileRuntimeInput) => AgentAdapterRuntime[];
