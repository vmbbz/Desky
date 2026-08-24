import { describe, expect, it, vi } from 'vitest';

import {
  installBoundedApplicationShutdown,
  type BeforeQuitEvent,
} from '../src/main/bounded-shutdown';

describe('bounded application shutdown', () => {
  it('prevents duplicate quits until asynchronous adapter teardown completes', async () => {
    let listener: ((event: BeforeQuitEvent) => void) | undefined;
    const application = {
      on: vi.fn((_event: 'before-quit', next: (event: BeforeQuitEvent) => void) => { listener = next; }),
      quit: vi.fn(),
    };
    let release: (() => void) | undefined;
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    installBoundedApplicationShutdown(application, shutdown);
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };
    listener?.(first);
    listener?.(second);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(application.quit).not.toHaveBeenCalled();
    release?.();
    await vi.waitFor(() => expect(application.quit).toHaveBeenCalledOnce());

    const final = { preventDefault: vi.fn() };
    listener?.(final);
    expect(final.preventDefault).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('rejects an unbounded timeout policy', () => {
    const application = { on: vi.fn(), quit: vi.fn() };
    expect(() => installBoundedApplicationShutdown(application, async () => undefined, 60_000))
      .toThrow('Invalid application shutdown policy');
  });
});
