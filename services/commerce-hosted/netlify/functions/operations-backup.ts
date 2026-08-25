import type { Config } from '@netlify/functions';
import { handleBackupRequest } from '../../src/server';

export default (request: Request) => handleBackupRequest(request);
export const config: Config = { path: '/v1/operations/backup' };
