export interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface ApplicationShutdownPort {
  on(event: 'before-quit', listener: (event: BeforeQuitEvent) => void): void;
  quit(): void;
}

const defaultShutdownTimeoutMs = 10_000;

async function boundedShutdown(task: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Application shutdown timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Electron does not await async before-quit handlers. This barrier prevents the
 * first quit, awaits bounded transport teardown once, then issues the final
 * quit that is allowed through.
 */
export function installBoundedApplicationShutdown(
  application: ApplicationShutdownPort,
  shutdown: () => Promise<void>,
  timeoutMs = defaultShutdownTimeoutMs,
): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('Invalid application shutdown policy.');
  }
  let running = false;
  let complete = false;
  application.on('before-quit', (event) => {
    if (complete) return;
    event.preventDefault();
    if (running) return;
    running = true;
    void boundedShutdown(shutdown, timeoutMs)
      .catch(() => undefined)
      .finally(() => {
        complete = true;
        application.quit();
      });
  });
}
