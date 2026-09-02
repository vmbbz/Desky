import type { AdapterConnectionState } from '../shared/agent-adapter';
import type { ConversationOpenResult } from '../shared/conversation';

interface ProviderConversationRoute {
  protocolUrl: string;
}

const providerConversationRoutes: Readonly<Record<string, ProviderConversationRoute>> = Object.freeze({
  // OpenClaw Companion documents this exact, credential-free Windows deep link.
  // The client owns its session picker; Deskii never serializes gateway secrets
  // or provider-native session identifiers into an OS URL.
  openclaw: Object.freeze({ protocolUrl: 'openclaw://chat' }),
});

export interface ConversationLauncherDependencies {
  getAdapterState(): AdapterConnectionState;
  getProtocolHandlerName(url: string): string;
  openExternal(url: string): Promise<void>;
  openDeskii(): void;
}

/**
 * Main-owned routing for the ambient "Open conversation" action.
 *
 * Renderer text, session ids and endpoint values never influence the launched
 * protocol. A provider is eligible only after its fixed route is reviewed and
 * admitted here. Missing, unadmitted, or failed clients fall back to Deskii's
 * synchronized transcript instead of opening an unrelated application view.
 */
export class ConversationLauncher {
  constructor(private readonly dependencies: ConversationLauncherDependencies) {}

  async open(): Promise<ConversationOpenResult> {
    const state = this.dependencies.getAdapterState();
    const route = providerConversationRoutes[state.adapterId];
    if (!route) return this.openDeskii(state.adapterId, 'no-admitted-provider-route');

    const handlerName = this.dependencies.getProtocolHandlerName(route.protocolUrl).trim();
    if (!handlerName) return this.openDeskii(state.adapterId, 'provider-client-not-installed');

    try {
      await this.dependencies.openExternal(route.protocolUrl);
      return {
        destination: 'provider-client',
        reason: 'provider-client-opened',
        adapterId: state.adapterId,
        clientName: handlerName,
      };
    } catch {
      return this.openDeskii(state.adapterId, 'provider-client-launch-failed');
    }
  }

  private openDeskii(
    adapterId: string,
    reason: Exclude<ConversationOpenResult['reason'], 'provider-client-opened'>,
  ): ConversationOpenResult {
    this.dependencies.openDeskii();
    return { destination: 'deskii', reason, adapterId };
  }
}
