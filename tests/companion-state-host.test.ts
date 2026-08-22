import { describe, expect, it } from 'vitest';

import { CompanionStateHost } from '../src/main/companion-state-host';

const context = {
  protocolVersion: 1 as const,
  eventId: 'event-1',
  timestamp: '2026-08-22T00:00:00.000Z',
  connectionId: 'test-connection',
  sessionId: 'test-session',
  turnId: 'test-turn',
};

describe('CompanionStateHost', () => {
  it('holds one revisioned snapshot for late-opening surfaces', () => {
    const host = new CompanionStateHost();

    host.applyEvent({
      ...context,
      type: 'approval.requested',
      payload: {
        requestId: 'approval-1',
        kind: 'exec',
        action: 'Run command',
        safeTarget: 'npm test',
        allowedDecisions: ['allow-once', 'deny'],
      },
    });

    expect(host.getSnapshot()).toMatchObject({
      revision: 1,
      mode: 'approval',
      pendingApproval: { requestId: 'approval-1' },
    });
  });

  it('keeps a revisioned session-only draft independent of window lifetime', () => {
    const host = new CompanionStateHost();

    expect(host.setDraft('partly written')).toEqual({ revision: 1, text: 'partly written' });
    expect(host.getDraft()).toEqual({ revision: 1, text: 'partly written' });
    expect(host.setDraft('')).toEqual({ revision: 2, text: '' });
  });
});
