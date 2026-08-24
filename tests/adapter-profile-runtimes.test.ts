import { describe, expect, it, vi } from 'vitest';

import { agentRuntimesForProfile } from '../src/main/adapters/profile-runtimes';
import type { AgentAdapterRuntime } from '../src/main/adapters/runtime';
import { codexAdapterDescriptor } from '../src/shared/codex';
import { hermesAdapterDescriptor } from '../src/shared/hermes';

const openClaw = { descriptor: { adapterId: 'openclaw' } } as AgentAdapterRuntime;
const codex = { descriptor: { adapterId: 'codex' } } as AgentAdapterRuntime;
const hermes = { descriptor: { adapterId: 'hermes' } } as AgentAdapterRuntime;
const claude = { descriptor: { adapterId: 'claude' } } as AgentAdapterRuntime;

describe('profile adapter construction', () => {
  it('admits Codex as production only in the direct profile', () => {
    expect(codexAdapterDescriptor).toMatchObject({
      production: true,
      distributionProfiles: ['direct'],
    });
  });

  it('constructs Codex only for direct packages', () => {
    const createCodex = vi.fn(() => codex);
    const createHermes = vi.fn(() => hermes);
    expect(agentRuntimesForProfile('direct', openClaw, createCodex, createHermes))
      .toEqual([openClaw, codex, hermes]);
    expect(createCodex).toHaveBeenCalledOnce();
    expect(createHermes).toHaveBeenCalledOnce();
  });

  it('does not instantiate direct-only runtimes in Store packages', () => {
    const createCodex = vi.fn(() => codex);
    const createHermes = vi.fn(() => hermes);
    expect(agentRuntimesForProfile('store', openClaw, createCodex, createHermes)).toEqual([openClaw]);
    expect(createCodex).not.toHaveBeenCalled();
    expect(createHermes).not.toHaveBeenCalled();
  });

  it('constructs the unadmitted Claude candidate only for an explicit direct admission exercise', () => {
    const createCodex = vi.fn(() => codex);
    const createHermes = vi.fn(() => hermes);
    const createClaude = vi.fn(() => claude);
    expect(agentRuntimesForProfile('direct', openClaw, createCodex, createHermes, createClaude))
      .toEqual([openClaw, codex, hermes, claude]);
    expect(createClaude).toHaveBeenCalledOnce();

    const storeClaude = vi.fn(() => claude);
    expect(agentRuntimesForProfile('store', openClaw, createCodex, createHermes, storeClaude))
      .toEqual([openClaw]);
    expect(storeClaude).not.toHaveBeenCalled();
  });

  it('admits Hermes as production only in the direct profile', () => {
    expect(hermesAdapterDescriptor).toMatchObject({
      production: true,
      distributionProfiles: ['direct'],
    });
  });
});
