import type { Config } from '@netlify/functions';
import { handleHealthRequest } from '../../src/server';

export default (request: Request) => handleHealthRequest(request, true);
export const config: Config = { path: '/readyz' };
