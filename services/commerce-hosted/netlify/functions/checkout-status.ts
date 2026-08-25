import type { Config } from '@netlify/functions';
import { handleServiceRequest } from '../../src/server';

export default (request: Request) => handleServiceRequest('/v1/checkout/session/status', request);
export const config: Config = { path: '/v1/checkout/session/status' };
