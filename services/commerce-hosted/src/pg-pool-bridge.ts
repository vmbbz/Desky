import type { Pool, PoolClient, QueryResult } from 'pg';

import {
  type PostgresPool,
  type PostgresQueryResult,
  type PostgresTransactionClient,
} from '../../../src/service/commerce/postgres-checkout-ledger';

function pgResult(result: QueryResult): PostgresQueryResult {
  return {
    rows: result.rows as Array<Record<string, unknown>>,
    rowCount: result.rowCount,
  };
}

class PgClientBridge implements PostgresTransactionClient {
  constructor(private readonly client: PoolClient) {}

  async query(text: string, values?: unknown[]): Promise<PostgresQueryResult> {
    return pgResult(await this.client.query(text, values));
  }

  release(): void { this.client.release(); }
}

export class PgPoolBridge implements PostgresPool {
  constructor(private readonly pool: Pool) {}

  async query(text: string, values?: unknown[]): Promise<PostgresQueryResult> {
    return pgResult(await this.pool.query(text, values));
  }

  async connect(): Promise<PostgresTransactionClient> {
    return new PgClientBridge(await this.pool.connect());
  }

  async end(): Promise<void> { await this.pool.end(); }
}
