import type { Config } from '@netlify/functions';
import { handleJwksRequest } from '../../src/server';

export default (request: Request) => handleJwksRequest(request);
export const config: Config = { path: '/.well-known/jwks.json' };
