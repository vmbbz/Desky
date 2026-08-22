export const companionModes = [
  'disconnected',
  'idle',
  'listening',
  'thinking',
  'working',
  'approval',
  'speaking',
  'success',
  'error',
] as const;

export type CompanionMode = (typeof companionModes)[number];

interface EventContext {
  eventId: string;
  timestamp: string;
  connectionId: string;
  sessionId?: string;
  turnId?: string;
}

export type AdapterEvent = EventContext & (
  | { type: 'connection.ready'; payload: { runtimeName: string } }
  | { type: 'connection.closed'; payload: { reason: string } }
  | { type: 'user.input.accepted'; payload: { summary: string } }
  | { type: 'agent.thinking'; payload: { status: string } }
  | { type: 'assistant.delta'; payload: { text: string } }
  | { type: 'tool.started'; payload: { toolName: string; safeSummary: string } }
  | { type: 'tool.progress'; payload: { safeSummary: string } }
  | { type: 'tool.completed'; payload: { toolName: string; safeSummary: string } }
  | {
      type: 'approval.requested';
      payload: { requestId: string; action: string; safeTarget: string };
    }
  | { type: 'turn.completed'; payload: { summary: string } }
  | { type: 'turn.failed'; payload: { safeError: string } }
);
