import type { Writable } from 'node:stream';

type OutputStream = Pick<Writable, 'on'> | undefined | null;

function isBrokenPipe(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EPIPE';
}

function guardOutputStream(stream: OutputStream): void {
  stream?.on('error', (error: unknown) => {
    // A GUI process can outlive the terminal or automation harness that
    // launched it. Losing that optional diagnostic pipe must not terminate the
    // desktop companion; all other stream failures keep their normal severity.
    if (!isBrokenPipe(error)) throw error;
  });
}

export function installBrokenPipeGuards(
  stdout: OutputStream = process.stdout,
  stderr: OutputStream = process.stderr,
): void {
  guardOutputStream(stdout);
  if (stderr !== stdout) guardOutputStream(stderr);
}
