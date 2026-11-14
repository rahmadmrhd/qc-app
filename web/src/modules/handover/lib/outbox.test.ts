import { IDBDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as deviceDb from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import {
  type CheckEntry,
  type CommentEntry,
  type CreateEntry,
  clearAllOutboxesWithin,
  countAllOutboxEntries,
  enqueueOutbox,
  hydrateOutbox,
  isExpiredEntry,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_CHECKS,
  OUTBOX_MAX_FUTURE_SKEW_MS,
  OUTBOX_MAX_WRITES,
  type OutboxEntry,
  outboxVersion,
  outboxWritesSuspended,
  purgeExpired,
  purgeForeignOutboxes,
  readOutbox,
  refreshOutboxFromStore,
  removeOutboxEntries,
  resumeOutboxWrites,
  subscribeOutbox,
  suspendOutboxWrites,
} from './outbox';

// Pembungkus tipis atas modul nyata agar baca dan pembersihan toko dapat dibuat menggantung.
vi.mock('@/lib/device-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/device-db')>();
  return {
    ...actual,
    readOutboxRecords: vi.fn(actual.readOutboxRecords),
    clearAllDeviceStores: vi.fn(actual.clearAllDeviceStores),
  };
});

const OWNER = 'a@x.com';

function check(over: Partial<Omit<CheckEntry, 'id' | 'kind'>> = {}) {
  return {
    kind: 'check' as const,
    taskId: 't1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
    at: 1_000,
    ...over,
  };
}

function comment(over: Partial<Omit<CommentEntry, 'id' | 'kind'>> = {}) {
  return {
    kind: 'comment' as const,
    clientId: '11111111-1111-4111-8111-111111111111',
    taskId: 't1',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'halo',
    at: 1_000,
    ...over,
  };
}

function create(over: Partial<Omit<CreateEntry, 'id' | 'kind'>> = {}) {
  return {
    kind: 'create' as const,
    locationId: 'loc-a',
    tasks: [{ clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT A', note: 'x' }],
    at: 1_000,
    ...over,
  };
}

const fresh = <T extends { at: number }>(entry: T): T => ({ ...entry, at: Date.now() });

/** Menulis langsung ke toko (tanpa memori), seperti tab lain atau sesi sebelumnya. */
async function seed(owner: string, entry: OutboxEntry): Promise<void> {
  await deviceDb.putOutboxRecord(
    owner,
    { key: `${owner}|${entry.id}`, owner, v: 1, savedAt: entry.at, entry },
    {},
    () => true,
  );
}

async function storeKeys(): Promise<string[]> {
  return ((await deviceDb.readOutboxRecords()) ?? []).map((r) => r.key).sort();
}

beforeEach(() => resetOutboxEnv());
afterEach(() => {
  resumeOutboxWrites();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('enqueue lalu read mempertahankan urutan dan memberi id unik; tiga jenis hidup berdampingan', async () => {
  expect(await enqueueOutbox(OWNER, check({ index: 0 }))).toBe('ok');
  expect(await enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2', at: 1_001 }))).toBe('ok');
  expect(await enqueueOutbox(OWNER, comment({ at: 1_002 }))).toBe('ok');
  expect(await enqueueOutbox(OWNER, create({ at: 1_003 }))).toBe('ok');
  const list = readOutbox(OWNER);
  expect(list.map((e) => e.kind)).toEqual(['check', 'check', 'comment', 'create']);
  expect(new Set(list.map((e) => e.id)).size).toBe(4);
  expect(list[0]).toMatchObject({
    taskId: 't1',
    locationId: 'loc-a',
    text: 'A = 1',
    checked: true,
  });
  expect(await storeKeys()).toEqual(list.map((e) => `${OWNER}|${e.id}`).sort());
});

test('gabung centang per task+indeks: nilai terakhir menang, dalam SATU transaksi', async () => {
  await enqueueOutbox(OWNER, check({ index: 0, checked: true }));
  await enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2' }));
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
  await enqueueOutbox(OWNER, check({ index: 0, checked: false, at: 2_000 }));
  expect(spy).toHaveBeenCalledTimes(1);
  const list = readOutbox(OWNER);
  expect(list.map((e) => (e.kind === 'check' ? [e.index, e.checked] : null))).toEqual([
    [1, true],
    [0, false],
  ]);
  expect(await storeKeys()).toHaveLength(2);
});

test('batas 200 centang: ke-201 ditolak, mengganti slot yang ada tetap boleh', async () => {
  for (let i = 0; i < OUTBOX_MAX_CHECKS; i++) {
    expect(await enqueueOutbox(OWNER, check({ taskId: `t${i}` }))).toBe('ok');
  }
  expect(await enqueueOutbox(OWNER, check({ taskId: 'baru' }))).toBe('full');
  expect(readOutbox(OWNER)).toHaveLength(OUTBOX_MAX_CHECKS);
  expect(await enqueueOutbox(OWNER, check({ taskId: 't5', checked: false }))).toBe('ok');
  expect(readOutbox(OWNER)).toHaveLength(OUTBOX_MAX_CHECKS);
  // Batas komentar + task baru terpisah dari centang.
  expect(await enqueueOutbox(OWNER, comment())).toBe('ok');
}, 60_000);

test('batas 50 komentar + task baru gabungan, terpisah dari centang', async () => {
  for (let i = 0; i < OUTBOX_MAX_WRITES; i++) {
    const entry = i % 2 === 0 ? comment({ at: 1_000 + i }) : create({ at: 1_000 + i });
    expect(await enqueueOutbox(OWNER, entry)).toBe('ok');
  }
  expect(await enqueueOutbox(OWNER, comment())).toBe('full');
  expect(await enqueueOutbox(OWNER, create())).toBe('full');
  expect(readOutbox(OWNER)).toHaveLength(OUTBOX_MAX_WRITES);
  expect(await enqueueOutbox(OWNER, check())).toBe('ok');
  // Batas dihitung per pemilik.
  expect(await enqueueOutbox('b@x.com', comment())).toBe('ok');
});

test('toko tak dapat ditulis: failed, salinan memori tak berubah dan tak ada notifikasi', async () => {
  (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  const listener = vi.fn();
  subscribeOutbox(listener);
  expect(await enqueueOutbox(OWNER, check())).toBe('failed');
  expect(readOutbox(OWNER)).toEqual([]);
  expect(listener).not.toHaveBeenCalled();
});

test('penanda "Belum terkirim" (notify) tidak terjadi sebelum penulisan terkonfirmasi', async () => {
  const listener = vi.fn();
  subscribeOutbox(listener);
  const pending = enqueueOutbox(OWNER, check());
  expect(listener).not.toHaveBeenCalled();
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await pending).toBe('ok');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(readOutbox(OWNER)).toHaveLength(1);
});

test('suspend sesudah enqueue dipanggil tetapi sebelum transaksi: failed dan toko tak berubah', async () => {
  await enqueueOutbox(OWNER, check({ index: 0 }));
  const pending = enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2' }));
  suspendOutboxWrites();
  expect(await pending).toBe('failed');
  expect(await storeKeys()).toHaveLength(1);
  expect(readOutbox(OWNER)).toHaveLength(1);
});

test('penulisan ditahan (setelah keluar): enqueue failed; resume memulihkan', async () => {
  await enqueueOutbox(OWNER, check({ index: 0 }));
  suspendOutboxWrites();
  expect(outboxWritesSuspended()).toBe(true);
  expect(await enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2' }))).toBe('failed');
  expect(readOutbox(OWNER)).toHaveLength(1);
  resumeOutboxWrites();
  expect(outboxWritesSuspended()).toBe(false);
  expect(await enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2' }))).toBe('ok');
});

test('keluar selagi penulisan terbang: entri tidak menghidupkan salinan memori lagi', async () => {
  const pending = enqueueOutbox(OWNER, check());
  const clearing = clearAllOutboxesWithin();
  expect(await pending).toBe('failed');
  await clearing;
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await storeKeys()).toEqual([]);
});

test('hydrate memuat entri tiga jenis dari toko (urut at); entri tak valid hanya hilang dari tampilan', async () => {
  await seed(OWNER, { ...check({ at: 3_000 }), id: 'c1' });
  await seed(OWNER, { ...comment({ at: 1_000 }), id: 'm1' });
  await seed(OWNER, { ...create({ at: 2_000 }), id: 'n1' });
  await deviceDb.putOutboxRecord(
    OWNER,
    { key: `${OWNER}|rusak`, owner: OWNER, v: 1, savedAt: 1, entry: { id: 'rusak', kind: 'aneh' } },
    {},
    () => true,
  );
  await hydrateOutbox();
  expect(readOutbox(OWNER).map((e) => e.id)).toEqual(['m1', 'n1', 'c1']);
  // Tak pernah menghapus apa pun di toko.
  expect(await storeKeys()).toHaveLength(4);
});

test('hydrate hanya sekali per proses', async () => {
  await hydrateOutbox();
  const reads = vi.mocked(deviceDb.readOutboxRecords).mock.calls.length;
  await hydrateOutbox();
  expect(vi.mocked(deviceDb.readOutboxRecords).mock.calls.length).toBe(reads);
});

test('baca toko lewat batas waktu: salinan kosong, toko tak dihapus, penulisan berikutnya mempertahankan entri lama', async () => {
  await seed(OWNER, { ...check({ at: 1_000 }), id: 'lama' });
  vi.mocked(deviceDb.readOutboxRecords).mockImplementationOnce(() => new Promise(() => undefined));
  await hydrateOutbox(30);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await enqueueOutbox(OWNER, comment({ at: 2_000 }))).toBe('ok');
  expect(await storeKeys()).toHaveLength(2);
  expect(await storeKeys()).toContain(`${OWNER}|lama`);
});

test('baca toko null (tak diketahui): salinan kosong tanpa menghapus; hasil terlambat TIDAK diterapkan', async () => {
  await seed(OWNER, { ...check({ at: 1_000 }), id: 'lama' });
  vi.mocked(deviceDb.readOutboxRecords).mockImplementationOnce(async () => null);
  await hydrateOutbox();
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await storeKeys()).toEqual([`${OWNER}|lama`]);

  resetOutboxEnv();
  await seed(OWNER, { ...check({ at: 1_000 }), id: 'lama' });
  let late: (rows: deviceDb.DeviceRecord[]) => void = () => undefined;
  vi.mocked(deviceDb.readOutboxRecords).mockImplementationOnce(
    () => new Promise((resolve) => (late = resolve)),
  );
  await hydrateOutbox(20);
  late([{ key: `${OWNER}|x`, owner: OWNER, v: 1, savedAt: 1, entry: { ...check(), id: 'x' } }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(readOutbox(OWNER)).toEqual([]);
});

const legacyEntry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  taskId: 't',
  locationId: 'l',
  index: 0,
  text: 'x',
  checked: true,
  at: 1,
  ...over,
});

test('migrasi localStorage: tulis ke toko, konfirmasi, baru hapus kunci lama; entri tak valid dibuang', async () => {
  const good = legacyEntry();
  localStorage.setItem(
    'qc.outbox:a@x.com',
    JSON.stringify({
      v: 1,
      entries: [good, { ...good, id: 5 }, { ...good, id: 'e2', index: 1.5 }, null],
    }),
  );
  localStorage.setItem('kunci-lain', 'tetap');
  await hydrateOutbox();
  expect(readOutbox(OWNER)).toEqual([{ ...good, kind: 'check' }]);
  expect(await storeKeys()).toEqual([`${OWNER}|e1`]);
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBeNull();
  expect(localStorage.getItem('kunci-lain')).toBe('tetap');
});

test('migrasi: amplop rusak atau berversi lain dibiarkan; boot berikutnya tak menggandakan', async () => {
  localStorage.setItem('qc.outbox:b@x.com', '{rusak');
  localStorage.setItem('qc.outbox:c@x.com', JSON.stringify({ v: 2, entries: [legacyEntry()] }));
  await hydrateOutbox();
  expect(countAllOutboxEntries()).toBe(0);
  expect(localStorage.getItem('qc.outbox:b@x.com')).toBe('{rusak');
  expect(localStorage.getItem('qc.outbox:c@x.com')).not.toBeNull();
});

test('migrasi yang gagal menulis mempertahankan kunci lama dan dicoba lagi pada boot berikutnya', async () => {
  localStorage.setItem('qc.outbox:a@x.com', JSON.stringify({ v: 1, entries: [legacyEntry()] }));
  (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
  deviceDb.resetDeviceDbForTests();
  await hydrateOutbox();
  expect(readOutbox(OWNER)).toEqual([]);
  expect(localStorage.getItem('qc.outbox:a@x.com')).not.toBeNull();

  // Boot berikutnya, IndexedDB sehat: terpindah, kunci lama dibuang, tanpa ganda.
  const keep = localStorage.getItem('qc.outbox:a@x.com') ?? '';
  resetOutboxEnv();
  localStorage.setItem('qc.outbox:a@x.com', keep);
  await hydrateOutbox();
  expect(readOutbox(OWNER).map((e) => e.id)).toEqual(['e1']);
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBeNull();
});

test('removeOutboxEntries per id: entri pengganti untuk task+indeks yang sama tidak ikut terhapus', async () => {
  await enqueueOutbox(OWNER, check({ checked: true }));
  const [lama] = readOutbox(OWNER);
  await enqueueOutbox(OWNER, check({ checked: false, at: 2_000 }));
  const [baru] = readOutbox(OWNER);
  expect(baru?.id).not.toBe(lama?.id);
  await removeOutboxEntries(OWNER, [lama?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([baru]);
  await removeOutboxEntries(OWNER, [baru?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await storeKeys()).toEqual([]);
});

test('removeOutboxEntries membuang dari salinan memori seketika (sebelum toko selesai)', async () => {
  await enqueueOutbox(OWNER, check());
  const [e] = readOutbox(OWNER);
  const removing = removeOutboxEntries(OWNER, [e?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await removing).toBe(true);
});

test('purgeExpired: tepat 24 jam tetap, lewat 1 ms dibuang dan dikembalikan', async () => {
  await enqueueOutbox(OWNER, check({ index: 0, at: 1_000 }));
  await enqueueOutbox(OWNER, check({ index: 1, text: 'B = 2', at: 1_001 }));
  expect(await purgeExpired(OWNER, 1_000 + OUTBOX_MAX_AGE_MS)).toEqual([]);
  expect(readOutbox(OWNER)).toHaveLength(2);
  const dropped = await purgeExpired(OWNER, 1_000 + OUTBOX_MAX_AGE_MS + 1);
  expect(dropped.map((e) => (e.kind === 'check' ? e.index : -1))).toEqual([0]);
  expect(readOutbox(OWNER).map((e) => (e.kind === 'check' ? e.index : -1))).toEqual([1]);
  expect(await storeKeys()).toHaveLength(1);
});

test('purgeExpired: entri bertanggal di masa depan (> 5 menit) juga kedaluwarsa; berlaku untuk semua jenis', async () => {
  const now = 5_000_000;
  await enqueueOutbox(OWNER, check({ index: 0, at: now + OUTBOX_MAX_FUTURE_SKEW_MS }));
  await enqueueOutbox(
    OWNER,
    check({ index: 1, text: 'B = 2', at: now + OUTBOX_MAX_FUTURE_SKEW_MS + 1 }),
  );
  await enqueueOutbox(OWNER, comment({ at: now - OUTBOX_MAX_AGE_MS - 1 }));
  await enqueueOutbox(OWNER, create({ at: now - OUTBOX_MAX_AGE_MS - 1 }));
  const dropped = await purgeExpired(OWNER, now);
  expect(dropped.map((e) => e.kind).sort()).toEqual(['check', 'comment', 'create']);
  expect(readOutbox(OWNER).map((e) => (e.kind === 'check' ? e.index : -1))).toEqual([0]);
});

test('purgeForeignOutboxes menyisakan milik pemilik (memori dan toko); clearAllOutboxesWithin membuang semua', async () => {
  await enqueueOutbox('a@x.com', check());
  await enqueueOutbox('b@x.com', check());
  localStorage.setItem('qc.outbox:c@x.com', 'apa-saja');
  localStorage.setItem('qc.cache.v3', 'tetap');
  await purgeForeignOutboxes('a@x.com');
  expect(readOutbox('a@x.com')).toHaveLength(1);
  expect(readOutbox('b@x.com')).toEqual([]);
  expect(await storeKeys()).toHaveLength(1);
  expect(localStorage.getItem('qc.outbox:c@x.com')).toBeNull();
  await enqueueOutbox('b@x.com', check());
  await clearAllOutboxesWithin();
  expect(readOutbox('a@x.com')).toEqual([]);
  expect(readOutbox('b@x.com')).toEqual([]);
  expect(await storeKeys()).toEqual([]);
  expect(localStorage.getItem('qc.cache.v3')).toBe('tetap');
});

test('clearAllOutboxesWithin tetap bisa membuang walau penulisan ditahan', async () => {
  await enqueueOutbox(OWNER, check());
  suspendOutboxWrites();
  await clearAllOutboxesWithin();
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await storeKeys()).toEqual([]);
});

test('clearAllOutboxesWithin dilepas setelah batas waktu bila IndexedDB macet; memori sudah kosong', async () => {
  localStorage.setItem('qc.outbox:a@x.com', 'apa-saja');
  await enqueueOutbox(OWNER, check());
  vi.mocked(deviceDb.clearAllDeviceStores).mockImplementationOnce(
    () => new Promise(() => undefined),
  );
  const started = Date.now();
  await clearAllOutboxesWithin(50);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(localStorage.getItem('qc.outbox:a@x.com')).toBeNull();
});

test('subscribeOutbox terpicu oleh perubahan; versi naik; berhenti setelah unsubscribe', async () => {
  const listener = vi.fn();
  const off = subscribeOutbox(listener);
  const v0 = outboxVersion();
  await enqueueOutbox(OWNER, check());
  expect(listener).toHaveBeenCalledTimes(1);
  expect(outboxVersion()).toBeGreaterThan(v0);
  const [e] = readOutbox(OWNER);
  await removeOutboxEntries(OWNER, [e?.id ?? '']);
  expect(listener).toHaveBeenCalledTimes(2);
  off();
  await enqueueOutbox(OWNER, check());
  expect(listener).toHaveBeenCalledTimes(2);
});

test('countAllOutboxEntries menjumlah semua pemilik dan jenis, tanpa yang kedaluwarsa', async () => {
  expect(countAllOutboxEntries()).toBe(0);
  const now = Date.now();
  await enqueueOutbox(OWNER, fresh(check({ index: 0 })));
  await enqueueOutbox(OWNER, fresh(comment()));
  await enqueueOutbox('b@x.com', fresh(create()));
  expect(countAllOutboxEntries()).toBe(3);
  await enqueueOutbox(
    OWNER,
    check({ index: 1, text: 'B = 2', at: now - OUTBOX_MAX_AGE_MS - 60_000 }),
  );
  await enqueueOutbox(
    'b@x.com',
    check({ index: 2, text: 'C = 3', at: now + OUTBOX_MAX_FUTURE_SKEW_MS + 60_000 }),
  );
  expect(countAllOutboxEntries()).toBe(3);
});

test('isExpiredEntry: tepat 24 jam tidak, lewat 1 ms ya; masa depan > 5 menit ya; semua jenis', () => {
  for (const base of [check({ at: 1_000 }), comment({ at: 1_000 }), create({ at: 1_000 })]) {
    const e = { ...base, id: 'x' } as OutboxEntry;
    expect(isExpiredEntry(e, 1_000 + OUTBOX_MAX_AGE_MS)).toBe(false);
    expect(isExpiredEntry(e, 1_000 + OUTBOX_MAX_AGE_MS + 1)).toBe(true);
    expect(isExpiredEntry(e, 1_000 - OUTBOX_MAX_FUTURE_SKEW_MS)).toBe(false);
    expect(isExpiredEntry(e, 1_000 - OUTBOX_MAX_FUTURE_SKEW_MS - 1)).toBe(true);
  }
});

test('refreshOutboxFromStore memperbarui salinan dari toko (sumber kebenaran) dan memberi tahu pelanggan', async () => {
  await hydrateOutbox();
  const listener = vi.fn();
  subscribeOutbox(listener);
  await seed(OWNER, { ...comment({ at: 5 }), id: 'dari-tab-lain' });
  const rows = await refreshOutboxFromStore(OWNER);
  expect(rows?.map((e) => e.id)).toEqual(['dari-tab-lain']);
  expect(readOutbox(OWNER).map((e) => e.id)).toEqual(['dari-tab-lain']);
  expect(listener).toHaveBeenCalledTimes(1);
  // Tanpa perubahan: tak ada notifikasi.
  await refreshOutboxFromStore(OWNER);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('refreshOutboxFromStore: baca gagal = null dan salinan tak disentuh; ditahan saat penulisan disuspend', async () => {
  await enqueueOutbox(OWNER, check());
  vi.mocked(deviceDb.readOutboxRecords).mockImplementationOnce(async () => null);
  expect(await refreshOutboxFromStore(OWNER)).toBeNull();
  expect(readOutbox(OWNER)).toHaveLength(1);
  suspendOutboxWrites();
  expect(await refreshOutboxFromStore(OWNER)).toBeNull();
});

test('siaran: enqueue memberi tahu tab lain; pesan changed dari tab lain memuat ulang salinan', async () => {
  if (typeof BroadcastChannel === 'undefined') return;
  const other = new BroadcastChannel('qc-outbox');
  const received: unknown[] = [];
  other.onmessage = (event) => received.push(event.data);
  try {
    await hydrateOutbox();
    await enqueueOutbox(OWNER, check());
    await vi.waitFor(() => expect(received).toContainEqual({ type: 'changed' }));

    await seed(OWNER, { ...comment({ at: 9 }), id: 'tab-lain' });
    other.postMessage({ type: 'changed' });
    await vi.waitFor(() => expect(readOutbox(OWNER).map((e) => e.id)).toContain('tab-lain'));
  } finally {
    other.close();
  }
});
