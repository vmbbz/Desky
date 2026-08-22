export const rendererContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' data: blob: https: ws://localhost:*",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Electron Forge's development server requires unsafe-eval for its source-map
// and hot-reload runtime. The packaged application continues to use the
// stricter renderer policy declared above.
export const developmentRendererContentSecurityPolicy = rendererContentSecurityPolicy
  .replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
