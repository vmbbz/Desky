import type { Config } from '@netlify/functions';
import { handleHealthRequest } from '../../src/server';

export default (request: Request) => handleHealthRequest(request, false);
export const config: Config = { path: '/healthz' };
