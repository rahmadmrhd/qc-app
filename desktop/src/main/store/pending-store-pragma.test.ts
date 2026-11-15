import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const executed: string[] = [];

vi.mock('node:sqlite', async () => {
  const actual = await vi.importActual<typeof import('node:sqlite')>('node:sqlite');
  class Spy extends actual.DatabaseSync {
    override exec(sql: string): void {
      executed.push(sql);
      super.exec(sql);
    }
  }
  return { ...actual, DatabaseSync: Spy };
});

const { openPendingStore } = await import('./pending-store');

let dir: string;
beforeEach(() => {
  executed.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'qc-pending-pragma-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('pragma pending-store', () => {
  test('memakai synchronous FULL: komit terakhir tak hilang pada mati listrik/OS crash', () => {
    const store = openPendingStore(join(dir, 'pending.db'));
    store.close();
    expect(executed).toContain('PRAGMA synchronous = FULL');
    expect(executed).not.toContain('PRAGMA synchronous = NORMAL');
  });
});
