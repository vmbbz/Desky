import type { DistributionProfile } from '../../shared/runtime';
import type { AgentAdapterRuntime } from './runtime';

/**
 * Constructs only runtimes admitted by the immutable package profile. In
 * particular, Store builds never instantiate a local-CLI adapter.
 */
export function agentRuntimesForProfile(
  profile: DistributionProfile,
  openClaw: AgentAdapterRuntime,
  createDirectCodex: () => AgentAdapterRuntime,
): AgentAdapterRuntime[] {
  return profile === 'direct'
    ? [openClaw, createDirectCodex()]
    : [openClaw];
}
