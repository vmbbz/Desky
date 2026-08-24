export const codexSandboxModes = ['read-only', 'workspace-write'] as const;
export type CodexSandboxMode = (typeof codexSandboxModes)[number];

export const codexSandboxDisclosures = Object.freeze({
  'read-only': Object.freeze({
    label: 'Read only',
    recommended: true,
    summary: 'Inspect files without changing the workspace.',
    approvalBehavior: 'Edits, command execution, and network access require approval.',
  }),
  'workspace-write': Object.freeze({
    label: 'Workspace write',
    recommended: false,
    summary: 'Read, edit, and run commands inside the selected workspace.',
    approvalBehavior: 'Access outside the workspace and network access require approval.',
  }),
});

export interface CodexWorkspaceGrantSummary {
  schemaVersion: 1;
  grantId: string;
  label: string;
  expiresAt: number;
  maximumSandbox: CodexSandboxMode;
}

export type CodexWorkspaceSelectionResult =
  | { status: 'cancelled' }
  | { status: 'selected'; grant: CodexWorkspaceGrantSummary };

export interface CodexWorkspaceBridge {
  select(maximumSandbox: CodexSandboxMode): Promise<CodexWorkspaceSelectionResult>;
  revoke(grantId: string): Promise<void>;
}
