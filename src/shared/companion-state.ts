import type { AdapterEvent, CompanionMode } from './adapter-events';

export interface CompanionViewState {
  mode: CompanionMode;
  label: string;
  detail: string;
  bubbleText: string;
  responseText: string;
  responseTruncated: boolean;
  bubbleOverflow: boolean;
  activeTurnId?: string;
  pendingApproval?: Extract<AdapterEvent, { type: 'approval.requested' }>['payload'];
}

export interface CompanionSnapshot extends CompanionViewState {
  revision: number;
}

export interface CompanionDraftSnapshot {
  revision: number;
  text: string;
}

export const initialCompanionState: CompanionViewState = {
  mode: 'disconnected',
  label: 'Offline',
  detail: 'Choose an agent connection',
  bubbleText: '',
  responseText: '',
  responseTruncated: false,
  bubbleOverflow: false,
};

export const initialCompanionSnapshot: CompanionSnapshot = {
  ...initialCompanionState,
  revision: 0,
};

export const initialCompanionDraftSnapshot: CompanionDraftSnapshot = {
  revision: 0,
  text: '',
};

const maxBubbleCharacters = 220;
const maxResponseCharacters = 100_000;

function createBubblePreview(response: string, responseTruncated: boolean) {
  const overflow = responseTruncated || response.length > maxBubbleCharacters;
  return {
    bubbleText: overflow
      ? `${response.slice(0, maxBubbleCharacters).trimEnd()}…`
      : response,
    bubbleOverflow: overflow,
  };
}

function appendResponse(
  current: string,
  delta: string,
  wasTruncated: boolean,
): Pick<CompanionViewState, 'responseText' | 'responseTruncated' | 'bubbleText' | 'bubbleOverflow'> {
  const next = `${current}${delta}`;
  const responseTruncated = wasTruncated || next.length > maxResponseCharacters;
  const responseText = responseTruncated ? next.slice(-maxResponseCharacters) : next;
  return {
    responseText,
    responseTruncated,
    ...createBubblePreview(responseText, responseTruncated),
  };
}

export function reduceCompanionState(
  state: CompanionViewState,
  event: AdapterEvent,
): CompanionViewState {
  switch (event.type) {
    case 'connection.ready':
      return {
        ...initialCompanionState,
        mode: 'idle',
        label: 'Ready',
        detail: event.payload.runtimeName,
      };
    case 'connection.closed':
      return {
        ...initialCompanionState,
        mode: 'disconnected',
        label: 'Offline',
        detail: event.payload.reason,
        bubbleText: 'The agent connection closed.',
      };
    case 'user.input.accepted':
      return {
        mode: 'listening',
        label: 'Listening',
        detail: event.payload.summary,
        bubbleText: '',
        responseText: '',
        responseTruncated: false,
        bubbleOverflow: false,
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
        bubbleOverflow: false,
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
        bubbleOverflow: false,
        pendingApproval: undefined,
      };
    }
    case 'assistant.delta':
      return {
        ...state,
        mode: 'speaking',
        label: 'Responding',
        detail: 'Streaming a response',
        ...appendResponse(state.responseText, event.payload.text, state.responseTruncated),
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
        bubbleOverflow: false,
        activeTurnId: undefined,
        pendingApproval: undefined,
      };
    }
  }
}

export function reduceCompanionSnapshot(
  snapshot: CompanionSnapshot,
  event: AdapterEvent,
): CompanionSnapshot {
  return {
    ...reduceCompanionState(snapshot, event),
    revision: snapshot.revision + 1,
  };
}
