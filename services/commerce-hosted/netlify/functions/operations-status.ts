import type { Config } from '@netlify/functions';
import { handleOperationsRequest } from '../../src/server';

export default (request: Request) => handleOperationsRequest(request);
export const config: Config = { path: '/v1/operations/status' };
