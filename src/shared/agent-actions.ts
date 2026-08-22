export const avatarActionKinds = ['wave', 'jump'] as const;

export type AvatarActionKind = (typeof avatarActionKinds)[number];

export const OPENCLAW_DESKY_ACTION_TOOL = 'desky_avatar_action';

export interface AgentActionCommand {
  protocolVersion: 1;
  commandId: string;
  timestamp: string;
  connectionId: string;
  sessionId: string;
  turnId: string;
  type: 'avatar.perform';
  payload: {
    action: AvatarActionKind;
  };
}

export function isAvatarActionKind(value: unknown): value is AvatarActionKind {
  return typeof value === 'string'
    && avatarActionKinds.includes(value as AvatarActionKind);
}
