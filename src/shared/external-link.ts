const allowedProtocols = new Set(['https:', 'http:']);

export function normalizeSafeExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_081) {
    throw new Error('Invalid external link.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid external link.');
  }
  if (!allowedProtocols.has(url.protocol) || url.username || url.password) {
    throw new Error('External link protocol is not allowed.');
  }
  return url.toString();
}
