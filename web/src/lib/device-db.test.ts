import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDeviceDb,
  type DeviceRecord,
  deleteRecords,
  readAllRecords,
  resetDeviceDbForTests,
  writeRecords,
} from './device-db';

function rec(key: string, savedAt: number, extra: Record<string, unknown> = {}): DeviceRecord {
  return { key, owner: 'a@x.id', v: 1, savedAt, ...extra };
}

const sorted = (rows: DeviceRecord[]) => [...rows].sort((a, b) => a.savedAt - b.savedAt);

beforeEach(() => {
  resetDeviceDbForTests();
  globalThis.indexedDB = new IDBFactory();
});

describe('device-db', () => {
  it('menulis lalu membaca rekaman yang sama, termasuk undefined bersarang', async () => {
    const r = rec('k1', 10, { data: { pageParams: [undefined] } });
    expect(await writeRecords('columns', [r], 10)).toBe(true);
    const rows = await readAllRecords('columns');
    expect(rows).toEqual([r]);
    const data = rows[0]?.data as { pageParams: unknown[] } | undefined;
    expect(data?.pageParams).toHaveLength(1);
  });

  it('kunci sama menimpa', async () => {
    await writeRecords('columns', [rec('k1', 1, { n: 'a' })], 10);
    await writeRecords('columns', [rec('k1', 2, { n: 'b' })], 10);
    const rows = await readAllRecords('columns');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.n).toBe('b');
  });

  it('memangkas rekaman terlama ke batas keep', async () => {
    await writeRecords(
      'tasks',
      [1, 2, 3, 4, 5].map((n) => rec(`k${n}`, n)),
      3,
    );
    expect(sorted(await readAllRecords('tasks')).map((r) => r.savedAt)).toEqual([3, 4, 5]);
    await writeRecords('tasks', [rec('k6', 6), rec('k7', 7)], 3);
    expect(sorted(await readAllRecords('tasks')).map((r) => r.savedAt)).toEqual([5, 6, 7]);
  });

  it('dua toko terpisah', async () => {
    await writeRecords('columns', [rec('c1', 1)], 10);
    expect(await readAllRecords('tasks')).toEqual([]);
    await writeRecords('tasks', [rec('t1', 1)], 10);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual(['c1']);
  });

  it('deleteRecords membuang kunci tertentu; clearDeviceDb mengosongkan kedua toko', async () => {
    await writeRecords('columns', [rec('k1', 1), rec('k2', 2)], 10);
    await writeRecords('tasks', [rec('t1', 1)], 10);
    await deleteRecords('columns', ['k1']);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual(['k2']);
    await clearDeviceDb();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
  });

  it('guard false: tidak menulis dan hasil false; dipanggil sekali', async () => {
    const guard = vi.fn(() => false);
    expect(await writeRecords('columns', [rec('k1', 1)], 10, guard)).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(await readAllRecords('columns')).toEqual([]);
  });

  it('tanpa IndexedDB: tidak pernah menolak', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await writeRecords('columns', [rec('k1', 1)], 10)).toBe(false);
    await expect(deleteRecords('columns', ['k1'])).resolves.toBeUndefined();
    await expect(clearDeviceDb()).resolves.toBeUndefined();
  });

  it('open yang memicu onerror: perilaku sama', async () => {
    globalThis.indexedDB = {
      open() {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => (req.onerror as (() => void) | null)?.());
        return req;
      },
    } as unknown as IDBFactory;
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await writeRecords('columns', [rec('k1', 1)], 10)).toBe(false);
    await expect(deleteRecords('columns', ['k1'])).resolves.toBeUndefined();
    await expect(clearDeviceDb()).resolves.toBeUndefined();
  });
});
