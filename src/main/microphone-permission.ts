import type { SurfaceKind } from '../shared/runtime';

export interface MicrophonePermissionContext {
  surface?: SurfaceKind;
  requestingUrl: string;
  securityOrigin?: string;
  isMainFrame: boolean;
  mediaTypes: readonly string[];
  packaged: boolean;
}

function isTrustedRendererUrl(raw: string, packaged: boolean): boolean {
  try {
    const url = new URL(raw);
    if (packaged) {
      return url.protocol === 'desky:'
        && url.hostname === 'app'
        && url.pathname === '/main_window/index.html';
    }
    const entry = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
    return url.origin === entry.origin && url.pathname === entry.pathname;
  } catch {
    return false;
  }
}

export function isAdmittedMicrophonePermission(
  context: MicrophonePermissionContext,
): boolean {
  return (context.surface === 'ambient' || context.surface === 'control-center')
    && context.isMainFrame
    && context.mediaTypes.length > 0
    && context.mediaTypes.every((type) => type === 'audio')
    && isTrustedRendererUrl(context.requestingUrl, context.packaged)
    && (!context.securityOrigin
      || context.securityOrigin === new URL(context.requestingUrl).origin
      || (context.packaged && context.securityOrigin === 'desky://app'));
}
