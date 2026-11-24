import { describe, expect, test } from 'bun:test';
import type { Db, DbStatement } from './db';
import { type PlanOutcome, runRecordBatch } from './record-batch';

/** Db palsu: hanya `batch()` yang dipakai `runRecordBatch` (tanpa MariaDB). */
function fakeDb(): { db: Db; batches: DbStatement[][] } {
  const batches: DbStatement[][] = [];
  const db = {
    batch: async (stmts: DbStatement[]) => {
      batches.push(stmts);
      return [];
    },
  } as unknown as Db;
  return { db, batches };
}

const OPTIONS = { conflicts: {}, stale: 'basi' };
const stmt = (label: string) => ({ label }) as unknown as DbStatement;

describe('runRecordBatch', () => {
  test('perencana berjalan paling banyak 4 serentak, hasil tetap urut masukan', async () => {
    const { db, batches } = fakeDb();
    let running = 0;
    let peak = 0;
    const ids = Array.from({ length: 20 }, (_, i) => `id-${String(i).padStart(2, '0')}`);
    const result = await runRecordBatch(
      { DB: db },
      ids,
      async (id): Promise<PlanOutcome<string>> => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        return { stmts: [stmt(id)], dto: id };
      },
      OPTIONS,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(result.items).toEqual(ids);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(20);
  });

  test('galat yang dilempar = galat PERTAMA menurut urutan masukan, walau yang lain selesai lebih dulu', async () => {
    const { db, batches } = fakeDb();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    await expect(
      runRecordBatch(
        { DB: db },
        ids,
        async (id): Promise<PlanOutcome<string>> => {
          // 'b' gagal paling lambat, 'e' paling cepat: yang dilempar tetap 'b'.
          if (id === 'b') {
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error('galat-b');
          }
          if (id === 'e') throw new Error('galat-e');
          return { stmts: [stmt(id)], dto: id };
        },
        OPTIONS,
      ),
    ).rejects.toThrow('galat-b');
    expect(batches).toHaveLength(0);
  });
});
