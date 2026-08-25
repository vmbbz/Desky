import type { Config } from '@netlify/functions';
import { runScheduledMonitor } from '../../src/server';

export default async () => { await runScheduledMonitor(); };
export const config: Config = { schedule: '*/15 * * * *' };
