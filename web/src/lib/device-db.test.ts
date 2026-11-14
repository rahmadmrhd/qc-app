import 'fake-indexeddb/auto';
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllDeviceStores,
  clearBoardStores,
  type DeviceRecord,
  deleteOutboxExceptOwner,
  deleteOutboxRecords,
  deleteRecords,
  OPEN_TIMEOUT_MS,
  putOutboxRecord,
  readAllRecords,
  readOutboxRecords,
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

  it('deleteRecords membuang kunci tertentu; clearBoardStores mengosongkan kedua toko papan', async () => {
    await writeRecords('columns', [rec('k1', 1), rec('k2', 2)], 10);
    await writeRecords('tasks', [rec('t1', 1)], 10);
    await deleteRecords('columns', ['k1']);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual(['k2']);
    await clearBoardStores();
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
    await expect(clearBoardStores()).resolves.toBeUndefined();
    await expect(clearAllDeviceStores()).resolves.toBeUndefined();
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
    await expect(clearBoardStores()).resolves.toBeUndefined();
    await expect(clearAllDeviceStores()).resolves.toBeUndefined();
  });
});

describe('device-db: open yang tidak pernah menjawab', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('selesai ke nilai aman setelah batas waktu, membuka ulang pada panggilan berikutnya, dan menutup hasil terlambat', async () => {
    const real = new IDBFactory();
    const requests: IDBOpenDBRequest[] = [];
    const open = vi.fn((name: string, version?: number) => {
      if (open.mock.calls.length === 1) {
        const hanging = {} as IDBOpenDBRequest;
        requests.push(hanging);
        return hanging;
      }
      return real.open(name, version);
    });
    globalThis.indexedDB = { open } as unknown as IDBFactory;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = readAllRecords('columns');
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);
    expect(await pending).toEqual([]);
    vi.useRealTimers();

    // Panggilan berikutnya mencoba membuka ulang (koneksi tersimpan direset).
    expect(await writeRecords('columns', [rec('k1', 1)], 10)).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);

    // Jawaban `open` pertama yang datang terlambat menutup koneksinya dan tidak menimpa koneksi baru.
    const close = vi.fn();
    const late = requests[0] as unknown as { result?: unknown; onsuccess?: () => void };
    late.result = { close };
    late.onsuccess?.();
    expect(close).toHaveBeenCalledTimes(1);
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual(['k1']);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

const OWNER = 'a@x.id';
function orec(owner: string, id: string, entry: Record<string, unknown> = {}): DeviceRecord {
  return { key: `${owner}|${id}`, owner, v: 1, savedAt: 1, entry: { id, ...entry } };
}
const keysOf = (rows: DeviceRecord[] | null) => (rows ?? []).map((r) => r.key).sort();
const always = () => true;
const isCheck = (e: DeviceRecord) => (e.entry as { kind?: string }).kind === 'check';
const slotIs = (slot: string) => (e: DeviceRecord) => (e.entry as { slot?: string }).slot === slot;

describe('device-db: toko outbox (v2)', () => {
  it('upgrade v1 ke v2 menjaga isi columns/tasks dan menambah outbox', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('qc-device', 1);
      req.onupgradeneeded = () => {
        for (const name of ['columns', 'tasks']) {
          req.result.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(['columns', 'tasks'], 'readwrite');
        tx.objectStore('columns').put(rec('c1', 1));
        tx.objectStore('tasks').put(rec('t1', 1));
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    expect((await readAllRecords('columns')).map((r) => r.key)).toEqual(['c1']);
    expect((await readAllRecords('tasks')).map((r) => r.key)).toEqual(['t1']);
    expect(await readOutboxRecords()).toEqual([]);
    expect(await putOutboxRecord(OWNER, orec(OWNER, 'e1'), {}, always)).toBe('ok');
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|e1`]);
  });

  it('readOutboxRecords: [] saat kosong, null tanpa IndexedDB', async () => {
    expect(await readOutboxRecords()).toEqual([]);
    resetDeviceDbForTests();
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await readOutboxRecords()).toBeNull();
  });

  it('readOutboxRecords: null bila open memicu onerror', async () => {
    globalThis.indexedDB = {
      open() {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => (req.onerror as (() => void) | null)?.());
        return req;
      },
    } as unknown as IDBFactory;
    expect(await readOutboxRecords()).toBeNull();
  });

  it('replaceIf mengganti rekaman task+indeks sama dalam SATU transaksi', async () => {
    await putOutboxRecord(OWNER, orec(OWNER, 'old', { slot: 's1' }), {}, always);
    await putOutboxRecord(OWNER, orec(OWNER, 'other', { slot: 's2' }), {}, always);
    await putOutboxRecord('b@x.id', orec('b@x.id', 'b1', { slot: 's1' }), {}, always);
    await readOutboxRecords(); // koneksi sudah terbuka
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const result = await putOutboxRecord(
      OWNER,
      orec(OWNER, 'new', { slot: 's1' }),
      { replaceIf: slotIs('s1') },
      always,
    );
    expect(result).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(keysOf(await readOutboxRecords())).toEqual([
      `${OWNER}|new`,
      `${OWNER}|other`,
      'b@x.id|b1',
    ]);
  });

  it('B1: pemindaian per pemilik tidak menyentuh pemilik lain yang namanya berawalan `owner|` (replaceIf dan cap)', async () => {
    const foreign = `${OWNER}|z`;
    await putOutboxRecord(foreign, orec(foreign, 'f1', { slot: 's1', kind: 'check' }), {}, always);
    await putOutboxRecord(OWNER, orec(OWNER, 'a1', { slot: 's1', kind: 'check' }), {}, always);
    // replaceIf yang cocok dengan rekaman asing tidak boleh menghapusnya.
    const replaced = await putOutboxRecord(
      OWNER,
      orec(OWNER, 'a2', { slot: 's1', kind: 'check' }),
      { replaceIf: slotIs('s1') },
      always,
    );
    expect(replaced).toBe('ok');
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|a2`, `${foreign}|f1`]);
    // cap hanya menghitung rekaman milik owner: 1 milik OWNER (a2) + 1 asing; max 2 tidak penuh bila asing dihitung benar.
    const capped = await putOutboxRecord(
      OWNER,
      orec(OWNER, 'a3', { kind: 'check' }),
      { cap: { count: isCheck, max: 2 } },
      always,
    );
    expect(capped).toBe('ok');
  });

  it('cap penuh: batal tanpa menulis apa pun (penggantian pun ikut batal)', async () => {
    await putOutboxRecord(OWNER, orec(OWNER, 'c1', { kind: 'check' }), {}, always);
    await putOutboxRecord(OWNER, orec(OWNER, 'c2', { kind: 'check' }), {}, always);
    await putOutboxRecord(OWNER, orec(OWNER, 'm1', { kind: 'comment' }), {}, always);
    const full = await putOutboxRecord(
      OWNER,
      orec(OWNER, 'c3', { kind: 'check' }),
      { cap: { count: isCheck, max: 2 }, replaceIf: (e) => e.key === `${OWNER}|m1` },
      always,
    );
    expect(full).toBe('full');
    expect(keysOf(await readOutboxRecords())).toEqual([
      `${OWNER}|c1`,
      `${OWNER}|c2`,
      `${OWNER}|m1`,
    ]);
    // Jenis lain tetap bisa (m1 tidak dihitung sebagai check).
    expect(
      await putOutboxRecord(
        OWNER,
        orec(OWNER, 'm2', { kind: 'comment' }),
        { cap: { count: (e) => !isCheck(e), max: 3 } },
        always,
      ),
    ).toBe('ok');
  });

  it('cap: rekaman yang diganti tidak dihitung; menimpa kunci sendiri tidak dihitung ganda', async () => {
    await putOutboxRecord(OWNER, orec(OWNER, 'c1', { kind: 'check', slot: 's1' }), {}, always);
    await putOutboxRecord(OWNER, orec(OWNER, 'c2', { kind: 'check', slot: 's2' }), {}, always);
    const cap = { count: isCheck, max: 2 };
    expect(
      await putOutboxRecord(
        OWNER,
        orec(OWNER, 'c3', { kind: 'check', slot: 's1' }),
        { cap, replaceIf: slotIs('s1') },
        always,
      ),
    ).toBe('ok');
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|c2`, `${OWNER}|c3`]);
    expect(
      await putOutboxRecord(
        OWNER,
        orec(OWNER, 'c2', { kind: 'check', slot: 's2' }),
        { cap },
        always,
      ),
    ).toBe('ok');
  });

  it('cap dihitung per pemilik', async () => {
    await putOutboxRecord('b@x.id', orec('b@x.id', 'b1'), {}, always);
    const cap = { count: always, max: 1 };
    expect(await putOutboxRecord(OWNER, orec(OWNER, 'a1'), { cap }, always)).toBe('ok');
    expect(await putOutboxRecord(OWNER, orec(OWNER, 'a2'), { cap }, always)).toBe('full');
  });

  it('guard false: failed, tidak menulis; dipanggil sinkron sebelum transaksi', async () => {
    await readOutboxRecords(); // koneksi terbuka
    const guard = vi.fn(() => false);
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    expect(await putOutboxRecord(OWNER, orec(OWNER, 'e1'), {}, guard)).toBe('failed');
    expect(guard).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(await readOutboxRecords()).toEqual([]);
  });

  it('tanpa IndexedDB: put/delete tidak menolak dan hasilnya gagal', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    expect(await putOutboxRecord(OWNER, orec(OWNER, 'e1'), {}, always)).toBe('failed');
    expect(await deleteOutboxRecords([`${OWNER}|e1`])).toBe(false);
    expect(await deleteOutboxExceptOwner(OWNER)).toBe(false);
  });

  it('deleteOutboxRecords membuang kunci tertentu; deleteOutboxExceptOwner menyisakan milik owner', async () => {
    const rows: Array<[string, string]> = [
      [OWNER, 'a1'],
      [OWNER, 'a2'],
      ['b@x.id', 'b1'],
      ['c@x.id', 'c1'],
    ];
    for (const [o, id] of rows) await putOutboxRecord(o, orec(o, id), {}, always);
    expect(await deleteOutboxRecords([`${OWNER}|a1`])).toBe(true);
    expect(await deleteOutboxRecords([])).toBe(true);
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|a2`, 'b@x.id|b1', 'c@x.id|c1']);
    expect(await deleteOutboxExceptOwner(OWNER)).toBe(true);
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|a2`]);
  });

  it('clearBoardStores TIDAK menyentuh outbox; clearAllDeviceStores menghapus ketiganya', async () => {
    await writeRecords('columns', [rec('c1', 1)], 10);
    await writeRecords('tasks', [rec('t1', 1)], 10);
    await putOutboxRecord(OWNER, orec(OWNER, 'e1'), {}, always);
    await clearBoardStores();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readAllRecords('tasks')).toEqual([]);
    expect(keysOf(await readOutboxRecords())).toEqual([`${OWNER}|e1`]);
    await writeRecords('columns', [rec('c1', 1)], 10);
    await clearAllDeviceStores();
    expect(await readAllRecords('columns')).toEqual([]);
    expect(await readOutboxRecords()).toEqual([]);
  });
});
