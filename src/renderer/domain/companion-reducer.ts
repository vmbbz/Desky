import type { AdapterEvent, CompanionMode } from '../../shared/adapter-events';

export interface CompanionViewState {
  mode: CompanionMode;
  label: string;
  detail: string;
  bubbleText: string;
  activeTurnId?: string;
  pendingApproval?: Extract<AdapterEvent, { type: 'approval.requested' }>['payload'];
}

export const initialCompanionState: CompanionViewState = {
  mode: 'disconnected',
  label: 'Offline',
  detail: 'Choose an agent connection',
  bubbleText: 'I’ll be right here when you’re ready.',
};

const maxBubbleCharacters = 360;

function appendBubble(current: string, delta: string): string {
  return `${current}${delta}`.slice(-maxBubbleCharacters);
}

export function reduceCompanionState(
  state: CompanionViewState,
  event: AdapterEvent,
): CompanionViewState {
  switch (event.type) {
    case 'connection.ready':
      return {
        mode: 'idle',
        label: 'Ready',
        detail: event.payload.runtimeName,
        bubbleText: `Connected to ${event.payload.runtimeName}.`,
        pendingApproval: undefined,
      };
    case 'connection.closed':
      return {
        mode: 'disconnected',
        label: 'Offline',
        detail: event.payload.reason,
        bubbleText: 'The agent connection closed.',
        pendingApproval: undefined,
      };
    case 'user.input.accepted':
      return {
        mode: 'listening',
        label: 'Listening',
        detail: event.payload.summary,
        bubbleText: '',
        activeTurnId: event.turnId,
      };
    case 'agent.thinking':
      return {
        ...state,
        mode: 'thinking',
        label: 'Thinking',
        detail: event.payload.status,
        activeTurnId: event.turnId ?? state.activeTurnId,
      };
    case 'tool.started':
      return {
        ...state,
        mode: 'working',
        label: `Using ${event.payload.toolName}`,
        detail: event.payload.safeSummary,
      };
    case 'tool.progress':
      return { ...state, detail: event.payload.safeSummary };
    case 'tool.completed':
      return {
        ...state,
        mode: 'thinking',
        label: 'Reviewing',
        detail: event.payload.safeSummary,
      };
    case 'approval.requested':
      return {
        ...state,
        mode: 'approval',
        label: 'Approval needed',
        detail: `${event.payload.action}: ${event.payload.safeTarget}`,
        bubbleText: 'I need your approval before I continue.',
        pendingApproval: event.payload,
      };
    case 'approval.resolved': {
      if (state.pendingApproval?.requestId !== event.payload.requestId) return state;
      const allowed = event.payload.status === 'allowed';
      return {
        ...state,
        mode: allowed && state.activeTurnId ? 'thinking' : 'idle',
        label: allowed ? 'Approval accepted' : 'Approval closed',
        detail: `The runtime marked the request ${event.payload.status}.`,
        bubbleText: allowed ? 'Continuing with the approved action.' : 'The approval request is closed.',
        pendingApproval: undefined,
      };
    }
    case 'assistant.delta':
      return {
        ...state,
        mode: 'speaking',
        label: 'Responding',
        detail: 'Streaming a response',
        bubbleText: appendBubble(state.bubbleText, event.payload.text),
      };
    case 'turn.completed':
      return {
        ...state,
        mode: 'success',
        label: 'Done',
        detail: event.payload.summary,
        activeTurnId: undefined,
        pendingApproval: undefined,
      };
    case 'turn.failed': {
      const cancelled = event.payload.kind === 'cancelled';
      return {
        ...state,
        mode: cancelled ? 'cancelled' : 'error',
        label: cancelled ? 'Cancelled' : 'Needs attention',
        detail: event.payload.safeError,
        bubbleText: cancelled
          ? 'That turn was cancelled.'
          : 'That turn did not complete. Open details to recover.',
        activeTurnId: undefined,
        pendingApproval: undefined,
      };
    }
  }
}
