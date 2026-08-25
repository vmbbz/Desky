export interface CommerceExternalIdentity {
  provider: 'supabase';
  subject: string;
}

export interface CommerceExternalIdentityVerifier {
  authenticate(accessToken: string): Promise<CommerceExternalIdentity>;
}

export interface SupabaseIdentityVerifierOptions {
  projectRef: string;
  publishableKey: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

const projectRefPattern = /^[a-z]{20}$/;
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseIdentityVerifier implements CommerceExternalIdentityVerifier {
  private readonly endpoint: string;
  private readonly publishableKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: SupabaseIdentityVerifierOptions) {
    if (!projectRefPattern.test(options.projectRef)
      || !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(options.publishableKey)) {
      throw new Error('Supabase identity verifier is not configured.');
    }
    this.endpoint = `https://${options.projectRef}.supabase.co/auth/v1/user`;
    this.publishableKey = options.publishableKey;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetcher = options.fetcher ?? fetch;
  }

  async authenticate(accessToken: string): Promise<CommerceExternalIdentity> {
    if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 8_192
      || accessToken.trim() !== accessToken || /[\r\n]/.test(accessToken)) {
      throw new Error('External identity authentication failed.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'GET',
        headers: { accept: 'application/json', apikey: this.publishableKey, authorization: `Bearer ${accessToken}` },
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      if (response.status !== 200 || response.url !== this.endpoint) {
        throw new Error('External identity authentication failed.');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 32 * 1_024)) {
        throw new Error('External identity authentication failed.');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 32 * 1_024) throw new Error('External identity authentication failed.');
      const value = JSON.parse(text) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !subjectPattern.test(String((value as { id?: unknown }).id ?? ''))) {
        throw new Error('External identity authentication failed.');
      }
      return { provider: 'supabase', subject: String((value as { id: string }).id).toLowerCase() };
    } catch {
      throw new Error('External identity authentication failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
