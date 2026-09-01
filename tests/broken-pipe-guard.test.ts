import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { installBrokenPipeGuards } from '../src/main/broken-pipe-guard';

describe('installBrokenPipeGuards', () => {
  it('keeps the GUI process alive when an inherited terminal pipe closes', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    installBrokenPipeGuards(stdout as never, stderr as never);

    expect(() => stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })))
      .not.toThrow();
    expect(() => stderr.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })))
      .not.toThrow();
  });

  it('does not hide unrelated output-stream failures', () => {
    const stdout = new EventEmitter();
    installBrokenPipeGuards(stdout as never, undefined);

    const failure = Object.assign(new Error('output device failed'), { code: 'EIO' });
    expect(() => stdout.emit('error', failure)).toThrow(failure);
  });
});
