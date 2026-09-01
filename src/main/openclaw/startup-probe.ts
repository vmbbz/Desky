export type OpenClawGatewayStartupState =
  | { status: 'started' }
  | { status: 'starting'; pendingReason?: string }
  | { status: 'draining' }
  | { status: 'unknown' };

export type OpenClawGatewayStartupProbe = (
  gatewayUrl: string,
) => Promise<OpenClawGatewayStartupState>;

const maximumProbeBodyBytes = 8_192;
const defaultProbeTimeoutMs = 5_000;

export function openClawStartupProbeUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else throw new Error('OpenClaw startup probes require a WebSocket Gateway URL.');
  url.pathname = '/startupz';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function readBoundedText(response: Response): Promise<string | undefined> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumProbeBodyBytes) return undefined;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumProbeBodyBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseStartupState(value: unknown): OpenClawGatewayStartupState {
  if (!value || typeof value !== 'object') return { status: 'unknown' };
  const result = value as Record<string, unknown>;
  if (result.ok === true && result.status === 'started') return { status: 'started' };
  if (result.ok === false && result.status === 'draining') return { status: 'draining' };
  if (result.ok === false && result.status === 'starting') {
    return {
      status: 'starting',
      ...(typeof result.pendingReason === 'string' && result.pendingReason.length <= 160
        ? { pendingReason: result.pendingReason }
        : {}),
    };
  }
  return { status: 'unknown' };
}

export async function probeOpenClawGatewayStartup(
  gatewayUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<OpenClawGatewayStartupState> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('OpenClaw startup probe timed out.')),
    options.timeoutMs ?? defaultProbeTimeoutMs,
  );
  timeout.unref?.();
  try {
    const response = await (options.fetchImpl ?? fetch)(openClawStartupProbeUrl(gatewayUrl), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return { status: 'unknown' };
    }
    const body = await readBoundedText(response);
    if (body === undefined) return { status: 'unknown' };
    try {
      return parseStartupState(JSON.parse(body));
    } catch {
      return { status: 'unknown' };
    }
  } catch {
    // The authenticated protocol-v4 WebSocket remains the compatibility
    // authority for older Gateways. Only an explicit startup response can
    // withdraw a connected claim.
    return { status: 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}
