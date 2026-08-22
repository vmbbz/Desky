import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Type } from 'typebox';

import factory from './plugin.cjs';

export default factory.createDeskyActionsPlugin({ defineToolPlugin, Type });
