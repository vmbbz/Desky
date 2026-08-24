import { describe, expect, it, vi } from 'vitest';

import {
  buildClaudeEnvironment,
  ClaudeSdkClient,
} from '../src/main/claude/sdk-client';

describe('ClaudeSdkClient foundation', () => {
  it('builds a reviewed environment with only the supplied Anthropic key', () => {
    const environment = buildClaudeEnvironment({
      PATH: 'C:\\tools',
      USERPROFILE: 'C:\\Users\\test',
      OPENAI_API_KEY: 'must-not-pass',
      ANTHROPIC_API_KEY: 'ambient-must-not-pass',
      RANDOM_SECRET: 'must-not-pass',
    }, 'supplied-key', '0.1.0');
    expect(environment).toMatchObject({
      PATH: 'C:\\tools',
      USERPROFILE: 'C:\\Users\\test',
      ANTHROPIC_API_KEY: 'supplied-key',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'desky/0.1.0',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    });
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.RANDOM_SECRET).toBeUndefined();
  });

  it('lists bounded sessions and starts with isolated settings, streaming, and permission control', async () => {
    const close = vi.fn();
    const query = vi.fn((_input: unknown) => ({ close }));
    const listSessions = vi.fn(async () => [{
      sessionId: 'session-1',
      summary: 'Existing session',
      customTitle: 'Desky',
      firstPrompt: 'Hello',
      lastModified: 42,
    }]);
    const sdk = { query, listSessions };
    const client = new ClaudeSdkClient(
      { PATH: 'C:\\tools' },
      async () => sdk as never,
    );
    await expect(client.listSessions('C:\\workspace')).resolves.toEqual([
      { id: 'session-1', label: 'Desky', updatedAt: 42 },
    ]);
    const onPermission = vi.fn(async () => ({ behavior: 'deny' as const, message: 'Denied' }));
    const handle = await client.start({
      prompt: 'Inspect this project',
      cwd: 'C:\\workspace',
      apiKey: 'secret-key',
      appVersion: '0.1.0',
      resumeSessionId: 'session-1',
      permissionMode: 'plan',
      onPermission,
    });
    const call = query.mock.calls[0][0] as {
      prompt: string;
      options: {
        cwd: string;
        resume: string;
        includePartialMessages: boolean;
        permissionMode: string;
        settingSources: unknown[];
        strictMcpConfig: boolean;
        mcpServers: Record<string, unknown>;
        env: NodeJS.ProcessEnv;
        canUseTool: (
          name: string,
          input: Record<string, unknown>,
          context: Record<string, unknown>,
        ) => Promise<unknown>;
        abortController: AbortController;
      };
    };
    expect(call).toMatchObject({
      prompt: 'Inspect this project',
      options: {
        cwd: 'C:\\workspace', resume: 'session-1', includePartialMessages: true,
        permissionMode: 'plan', settingSources: [], strictMcpConfig: true, mcpServers: {},
      },
    });
    expect(call.options.env.ANTHROPIC_API_KEY).toBe('secret-key');
    await call.options.canUseTool('Bash', { command: 'npm test' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
      requestId: 'request-1',
      title: 'Run tests',
    });
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'Bash', toolUseId: 'tool-1', requestId: 'request-1', title: 'Run tests',
    }));
    handle.abort();
    expect(call.options.abortController.signal.aborted).toBe(true);
    handle.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
