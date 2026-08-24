/**
 * The legacy flag denies avatar-origin fetches so cache/offline exercises can
 * prove reload behavior. Authenticated adapter exercises are not offline avatar
 * tests and must not turn a fresh companion profile into a false load failure.
 */
export function shouldDisableAvatarNetwork(
  disableNetwork: string | undefined,
  exercise: string | undefined,
): boolean {
  return disableNetwork === '1'
    && exercise !== 'codex-ui'
    && exercise !== 'hermes-ui'
    && exercise !== 'hermes-ui-saved';
}
