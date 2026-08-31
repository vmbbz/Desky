import { describe, expect, it } from 'vitest';

import { markdownToPlainText, responseBubbleLifetimeMs } from '../src/shared/agent-text';

describe('agent text presentation', () => {
  it('creates a readable ambient preview without leaking Markdown syntax', () => {
    expect(markdownToPlainText([
      '## Skills',
      '- **Coding & debugging:** Node.js, `Python`',
      '- [OpenClaw](https://openclaw.ai): gateway diagnosis',
    ].join('\n'))).toBe('Skills • Coding & debugging: Node.js, Python • OpenClaw: gateway diagnosis');
  });

  it('gives completed responses a bounded length-aware reading window', () => {
    expect(responseBubbleLifetimeMs('Short answer.')).toBe(8_000);
    expect(responseBubbleLifetimeMs('x'.repeat(180))).toBe(13_000);
    expect(responseBubbleLifetimeMs('x'.repeat(2_000))).toBe(18_000);
  });
});
