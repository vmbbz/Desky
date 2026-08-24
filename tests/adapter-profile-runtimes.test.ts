import { describe, expect, it, vi } from 'vitest';

import { agentRuntimesForProfile } from '../src/main/adapters/profile-runtimes';
import type { AgentAdapterRuntime } from '../src/main/adapters/runtime';
import { codexAdapterDescriptor } from '../src/shared/codex';

const openClaw = { descriptor: { adapterId: 'openclaw' } } as AgentAdapterRuntime;
const codex = { descriptor: { adapterId: 'codex' } } as AgentAdapterRuntime;

describe('profile adapter construction', () => {
  it('admits Codex as production only in the direct profile', () => {
    expect(codexAdapterDescriptor).toMatchObject({
      production: true,
      distributionProfiles: ['direct'],
    });
  });

  it('constructs Codex only for direct packages', () => {
    const createCodex = vi.fn(() => codex);
    expect(agentRuntimesForProfile('direct', openClaw, createCodex)).toEqual([openClaw, codex]);
    expect(createCodex).toHaveBeenCalledOnce();
  });

  it('does not instantiate the local CLI runtime in Store packages', () => {
    const createCodex = vi.fn(() => codex);
    expect(agentRuntimesForProfile('store', openClaw, createCodex)).toEqual([openClaw]);
    expect(createCodex).not.toHaveBeenCalled();
  });
});
