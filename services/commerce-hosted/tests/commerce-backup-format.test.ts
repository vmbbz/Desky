import { describe, expect, it } from 'vitest';

import {
  commerceLogicalTableDigest,
  type CommerceTableBackup,
} from '../src/commerce-backup-format';

function refreshTable(generation: unknown): CommerceTableBackup {
  return {
    table: 'commerce_refresh_sessions',
    columns: ['session_id', 'generation', 'payload_text'],
    rows: [['session:pilot', generation, '{"generation":2}']],
  };
}

describe('commerce backup logical format', () => {
  it('normalizes PostgreSQL bigint strings and isolated-restore numbers identically', () => {
    expect(commerceLogicalTableDigest(refreshTable('2')))
      .toBe(commerceLogicalTableDigest(refreshTable(2)));
  });

  it('does not coerce malformed or unsafe bigint representations', () => {
    expect(() => commerceLogicalTableDigest(refreshTable(-1))).toThrow(/bigint/);
    expect(() => commerceLogicalTableDigest(refreshTable(1.5))).toThrow(/bigint/);
    expect(() => commerceLogicalTableDigest(refreshTable('02'))).toThrow(/bigint/);
  });

  it('ignores generated restore-local sequences while retaining logical row data', () => {
    const source: CommerceTableBackup = {
      table: 'commerce_audit_events',
      columns: ['sequence', 'event_id', 'payload_text'],
      rows: [['41', 'audit:1', '{"event":"created"}']],
    };
    const restored: CommerceTableBackup = {
      ...source,
      rows: [[1, 'audit:1', '{"event":"created"}']],
    };
    expect(commerceLogicalTableDigest(source)).toBe(commerceLogicalTableDigest(restored));
  });
});
