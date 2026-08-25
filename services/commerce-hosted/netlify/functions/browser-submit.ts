import type { Config } from '@netlify/functions';
import { handleBrowserRequest } from '../../src/server';

export default (request: Request) => handleBrowserRequest('/v1/browser/submit', request);
export const config: Config = { path: '/v1/browser/submit' };
