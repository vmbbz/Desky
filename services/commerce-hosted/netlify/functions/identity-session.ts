import type { Config } from '@netlify/functions';
import { handleServiceRequest } from '../../src/server';

export default (request: Request) => handleServiceRequest('/v1/identity/session', request);
export const config: Config = { path: '/v1/identity/session' };
