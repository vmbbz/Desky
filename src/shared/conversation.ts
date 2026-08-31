export const conversationDestinations = ['provider-client', 'deskiii'] as const;

export type ConversationDestination = (typeof conversationDestinations)[number];

export const conversationOpenReasons = [
  'provider-client-opened',
  'no-admitted-provider-route',
  'provider-client-not-installed',
  'provider-client-launch-failed',
] as const;

export type ConversationOpenReason = (typeof conversationOpenReasons)[number];

export interface ConversationOpenResult {
  destination: ConversationDestination;
  reason: ConversationOpenReason;
  adapterId: string;
  clientName?: string;
}

export interface ConversationBridge {
  open(): Promise<ConversationOpenResult>;
}
