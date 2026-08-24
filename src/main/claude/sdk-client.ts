import type {
  listSessions as listClaudeSessions,
  PermissionResult,
  Query,
  query as runClaudeQuery,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { AdapterSessionSummary } from '../../shared/agent-adapter';

export const CLAUDE_AGENT_SDK_VERSION = '0.3.241' as const;
export const CLAUDE_CODE_VERSION = '2.1.241' as const;

type ClaudeSdkModule = {
  listSessions: typeof listClaudeSessions;
  query: typeof runClaudeQuery;
};

export interface ClaudePermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  toolUseId: string;
  requestId: string;
  title?: string;
  description?: string;
  blockedPath?: string;
  suggestions?: unknown[];
}

export type ClaudePermissionHandler = (
  request: ClaudePermissionRequest,
) => Promise<PermissionResult>;

export interface ClaudeSdkStartInput {
  prompt: string;
  cwd: string;
  apiKey: string;
  appVersion: string;
  resumeSessionId?: string;
  permissionMode: 'default' | 'plan';
  onPermission: ClaudePermissionHandler;
}

export interface ClaudeSdkQueryHandle {
  messages: AsyncIterable<SDKMessage>;
  abort(): void;
  close(): void;
}

export interface ClaudeSdkClientPort {
  listSessions(cwd: string): Promise<AdapterSessionSummary[]>;
  start(input: ClaudeSdkStartInput): Promise<ClaudeSdkQueryHandle>;
}

export function buildClaudeEnvironment(
  source: NodeJS.ProcessEnv,
  apiKey: string,
  appVersion: string,
): NodeJS.ProcessEnv {
  if (!apiKey || apiKey.length > 16_384) throw new Error('Anthropic API key is required.');
  const allowed = [
    'PATH', 'Path', 'SystemRoot', 'ComSpec',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy',
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  environment.ANTHROPIC_API_KEY = apiKey;
  environment.CLAUDE_AGENT_SDK_CLIENT_APP = `desky/${appVersion}`;
  environment.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return environment;
}

export class ClaudeSdkClient implements ClaudeSdkClientPort {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly loadSdk: () => Promise<ClaudeSdkModule> = () => import('@anthropic-ai/claude-agent-sdk'),
    private readonly cliExecutablePath?: string,
  ) {}

  async listSessions(cwd: string): Promise<AdapterSessionSummary[]> {
    const sdk = await this.loadSdk();
    const sessions = await sdk.listSessions({ dir: cwd, limit: 200 });
    return sessions.slice(0, 200).map((session) => ({
      id: session.sessionId,
      label: (session.customTitle || session.summary || session.firstPrompt || 'Claude session').slice(0, 160),
      updatedAt: session.lastModified,
    }));
  }

  async start(input: ClaudeSdkStartInput): Promise<ClaudeSdkQueryHandle> {
    if (!input.prompt.trim() || input.prompt.length > 64_000) throw new Error('Invalid Claude prompt.');
    const sdk = await this.loadSdk();
    const abortController = new AbortController();
    const query = sdk.query({
      prompt: input.prompt,
      options: {
        cwd: input.cwd,
        resume: input.resumeSessionId,
        abortController,
        includePartialMessages: true,
        permissionMode: input.permissionMode,
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        ...(this.cliExecutablePath ? { pathToClaudeCodeExecutable: this.cliExecutablePath } : {}),
        maxTurns: 100,
        env: buildClaudeEnvironment(this.environment, input.apiKey, input.appVersion),
        canUseTool: async (toolName, toolInput, context) => input.onPermission({
          toolName,
          input: toolInput,
          signal: context.signal,
          toolUseId: context.toolUseID,
          requestId: context.requestId,
          title: context.title,
          description: context.description,
          blockedPath: context.blockedPath,
          suggestions: context.suggestions,
        }),
      },
    });
    return {
      messages: query,
      abort: () => abortController.abort(),
      close: () => (query as Query).close(),
    };
  }
}
