import type { Config } from '@netlify/functions';
import { handleReconciliationRequest } from '../../src/server';

export default (request: Request) => handleReconciliationRequest(request);
export const config: Config = { path: '/v1/operations/reconciliation' };
