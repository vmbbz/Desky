import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  avatarActionKinds,
  OPENCLAW_DESKY_ACTION_TOOL,
} from '../src/shared/agent-actions';

interface SchemaBuilder {
  Boolean(): unknown;
  Literal(value: string): unknown;
  Object(properties: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  String(): unknown;
  Union(items: unknown[], options?: Record<string, unknown>): unknown;
}

interface ToolDefinition {
  name: string;
  execute(input: { action: string }): Promise<Record<string, unknown>>;
}

interface PluginDefinition {
  id: string;
  tools(tool: (definition: ToolDefinition) => ToolDefinition): ToolDefinition[];
}

interface PluginFactory {
  avatarActions: readonly string[];
  toolName: string;
  createDeskyActionsPlugin(input: {
    defineToolPlugin(definition: PluginDefinition): PluginDefinition;
    Type: SchemaBuilder;
  }): PluginDefinition;
}

const requireFromRepository = createRequire(join(process.cwd(), 'package.json'));
const factory = requireFromRepository(
  './integrations/openclaw-desky-actions/plugin.cjs',
) as PluginFactory;

const Type: SchemaBuilder = {
  Boolean: () => ({ type: 'boolean' }),
  Literal: (value) => ({ const: value }),
  Object: (properties, options) => ({ type: 'object', properties, ...options }),
  String: () => ({ type: 'string' }),
  Union: (items, options) => ({ anyOf: items, ...options }),
};

describe('OpenClaw Desky Actions plugin', () => {
  it('keeps the shipped plugin manifest and executable contract aligned with Desky', async () => {
    const manifest = JSON.parse(readFileSync(join(
      process.cwd(),
      'integrations/openclaw-desky-actions/openclaw.plugin.json',
    ), 'utf8')) as { id: string; contracts: { tools: string[] } };
    const plugin = factory.createDeskyActionsPlugin({
      defineToolPlugin: (definition) => definition,
      Type,
    });
    const [tool] = plugin.tools((definition) => definition);

    expect(factory.avatarActions).toEqual(avatarActionKinds);
    expect(factory.toolName).toBe(OPENCLAW_DESKY_ACTION_TOOL);
    expect(manifest).toMatchObject({
      id: plugin.id,
      contracts: { tools: [tool.name] },
    });
    await expect(tool.execute({ action: 'wave' })).resolves.toMatchObject({
      requested: true,
      action: 'wave',
      delivery: 'session-tool-stream',
    });
  });
});
