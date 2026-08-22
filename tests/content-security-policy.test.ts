import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  developmentRendererContentSecurityPolicy,
  rendererContentSecurityPolicy,
} from '../src/shared/content-security-policy';

describe('renderer content security policy', () => {
  it('keeps the packaged HTML policy aligned with the shared production policy', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8');

    expect(html).toContain(`content="${rendererContentSecurityPolicy}"`);
  });

  it('admits only the extra development runtime capability and required asset transports', () => {
    expect(developmentRendererContentSecurityPolicy).toContain(
      "script-src 'self' 'unsafe-eval'",
    );
    expect(developmentRendererContentSecurityPolicy).toContain(
      "connect-src 'self' data: blob: https: ws://localhost:*",
    );
    expect(developmentRendererContentSecurityPolicy).toContain("object-src 'none'");
    expect(rendererContentSecurityPolicy).not.toContain("'unsafe-eval'");
  });
});
