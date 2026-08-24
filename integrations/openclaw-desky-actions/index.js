import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Type } from 'typebox';

import factory from './plugin.cjs';

const entry = factory.createDeskyActionsPlugin({ defineToolPlugin, Type });
const registerTools = entry.register;

entry.register = (api) => {
  registerTools(api);
  api.registerGatewayMethod('desky.actions.capabilities', ({ respond }) => {
    respond(true, {
      schemaVersion: 1,
      pluginId: factory.pluginId,
      toolName: factory.toolName,
      actions: [...factory.avatarActions],
      transport: 'session-tool-stream',
    });
  }, { scope: 'operator.read' });
};

export default entry;
