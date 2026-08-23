export type AvatarDragMode = 'move' | 'rotate';

/**
 * Direct mesh contact rotates the character. Transparent space retains native
 * surface movement, while the established modifier remains a rotation escape.
 */
export function resolveAvatarDragMode(input: {
  hitAvatar: boolean;
  forceRotate: boolean;
}): AvatarDragMode {
  return input.forceRotate || input.hitAvatar ? 'rotate' : 'move';
}
