'use strict';

const pluginId = 'desky-actions';
const toolName = 'desky_avatar_action';
const avatarActions = Object.freeze(['wave', 'jump']);

function createDeskyActionsPlugin({ defineToolPlugin, Type }) {
  return defineToolPlugin({
    id: pluginId,
    name: 'Desky Actions',
    description: 'Adds safe, typed avatar actions for a connected Desky desktop companion.',
    tools: (tool) => [
      tool({
        name: toolName,
        label: 'Desky Avatar Action',
        description: [
          'Request one brief visual action from the connected Desky desktop avatar.',
          'Use wave for a greeting or farewell and jump for a clearly celebratory moment.',
          'Do not call this on every response. The request may be ignored when Desky is unavailable,',
          'the session is not selected, motion is paused, or a higher-priority state is active.',
        ].join(' '),
        parameters: Type.Object({
          action: Type.Union(avatarActions.map((action) => Type.Literal(action)), {
            description: 'The finite semantic avatar action to request.',
          }),
        }, { additionalProperties: false }),
        outputSchema: Type.Object({
          requested: Type.Boolean(),
          action: Type.Union(avatarActions.map((action) => Type.Literal(action))),
          delivery: Type.Literal('session-tool-stream'),
          note: Type.String(),
        }, { additionalProperties: false }),
        async execute({ action }) {
          return {
            requested: true,
            action,
            delivery: 'session-tool-stream',
            note: 'The request was published to the session. Only a connected, eligible Desky client can perform it.',
          };
        },
      }),
    ],
  });
}

module.exports = {
  avatarActions,
  createDeskyActionsPlugin,
  pluginId,
  toolName,
};
