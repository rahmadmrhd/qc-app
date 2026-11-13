import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeHandover } from '../components/test-handover';
import {
  clearAllOutboxes,
  enqueueCheck,
  hasEntriesForTask,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ENTRIES,
  OUTBOX_MAX_FUTURE_SKEW_MS,
  outboxKey,
  outboxVersion,
  outboxWritesSuspended,
  overlayPendingChecks,
  purgeExpired,
  purgeForeignOutboxes,
  readOutbox,
  removeEntries,
  resumeOutboxWrites,
  subscribeOutbox,
  suspendOutboxWrites,
} from './check-outbox';

const OWNER = 'a@x.com';

function entry(over: Partial<Parameters<typeof enqueueCheck>[1]> = {}) {
  return {
    taskId: 't1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
    at: 1_000,
    ...over,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => resumeOutboxWrites());
afterEach(() => vi.restoreAllMocks());

test('kunci per pemilik; enqueue lalu read mempertahankan urutan dan memberi id unik', () => {
  expect(outboxKey(OWNER)).toBe('qc.outbox:a@x.com');
  expect(enqueueCheck(OWNER, entry({ index: 0 }))).toBe(true);
  expect(enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }))).toBe(true);
  const list = readOutbox(OWNER);
  expect(list.map((e) => e.index)).toEqual([0, 1]);
  expect(new Set(list.map((e) => e.id)).size).toBe(2);
  expect(list[0]).toMatchObject({
    taskId: 't1',
    locationId: 'loc-a',
    text: 'A = 1',
    checked: true,
  });
});

test('gabung per task+indeks: nilai terakhir menang dan pindah ke akhir', () => {
  enqueueCheck(OWNER, entry({ index: 0, checked: true }));
  enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }));
  enqueueCheck(OWNER, entry({ index: 0, checked: false, at: 2_000 }));
  const list = readOutbox(OWNER);
  expect(list.map((e) => [e.index, e.checked])).toEqual([
    [1, true],
    [0, false],
  ]);
});

test('batas 200 entri: indeks baru ke-201 ditolak, mengganti slot yang ada tetap boleh', () => {
  for (let i = 0; i < OUTBOX_MAX_ENTRIES; i++) {
    expect(enqueueCheck(OWNER, entry({ taskId: `t${i}` }))).toBe(true);
  }
  expect(enqueueCheck(OWNER, entry({ taskId: 'baru' }))).toBe(false);
  expect(readOutbox(OWNER)).toHaveLength(OUTBOX_MAX_ENTRIES);
  expect(enqueueCheck(OWNER, entry({ taskId: 't5', checked: false }))).toBe(true);
  expect(readOutbox(OWNER)).toHaveLength(OUTBOX_MAX_ENTRIES);
});

test('penyimpanan diblokir atau penuh: enqueue mengembalikan false', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  expect(enqueueCheck(OWNER, entry())).toBe(false);
});

test('JSON rusak atau bentuk salah menjadi kosong; entri bentuk salah dibuang', () => {
  localStorage.setItem(outboxKey(OWNER), '{rusak');
  expect(readOutbox(OWNER)).toEqual([]);
  localStorage.setItem(outboxKey(OWNER), JSON.stringify({ v: 2, entries: [] }));
  expect(readOutbox(OWNER)).toEqual([]);
  const good = {
    id: 'e1',
    taskId: 't',
    locationId: 'l',
    index: 0,
    text: 'x',
    checked: true,
    at: 1,
  };
  localStorage.setItem(
    outboxKey(OWNER),
    JSON.stringify({ v: 1, entries: [good, { ...good, id: 5 }, { ...good, index: 1.5 }, null] }),
  );
  expect(readOutbox(OWNER)).toEqual([good]);
});

test('removeEntries per id: entri pengganti untuk task+indeks yang sama tidak ikut terhapus', () => {
  enqueueCheck(OWNER, entry({ checked: true }));
  const [lama] = readOutbox(OWNER);
  enqueueCheck(OWNER, entry({ checked: false, at: 2_000 }));
  const [baru] = readOutbox(OWNER);
  expect(baru?.id).not.toBe(lama?.id);
  removeEntries(OWNER, [lama?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([baru]);
  removeEntries(OWNER, [baru?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(localStorage.getItem(outboxKey(OWNER))).toBeNull();
});

test('hasEntriesForTask', () => {
  enqueueCheck(OWNER, entry({ taskId: 't1' }));
  expect(hasEntriesForTask(OWNER, 't1')).toBe(true);
  expect(hasEntriesForTask(OWNER, 't2')).toBe(false);
  expect(hasEntriesForTask('b@x.com', 't1')).toBe(false);
});

test('purgeExpired: tepat 24 jam tetap, lewat 1 ms dibuang dan dikembalikan', () => {
  enqueueCheck(OWNER, entry({ index: 0, at: 1_000 }));
  enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2', at: 1_001 }));
  expect(purgeExpired(OWNER, 1_000 + OUTBOX_MAX_AGE_MS)).toEqual([]);
  expect(readOutbox(OWNER)).toHaveLength(2);
  const dropped = purgeExpired(OWNER, 1_000 + OUTBOX_MAX_AGE_MS + 1);
  expect(dropped.map((e) => e.index)).toEqual([0]);
  expect(readOutbox(OWNER).map((e) => e.index)).toEqual([1]);
});

test('clearAllOutboxes hanya menyentuh kunci antrean; purgeForeignOutboxes menyisakan milik pemilik', () => {
  enqueueCheck('a@x.com', entry());
  enqueueCheck('b@x.com', entry());
  localStorage.setItem('qc.cache.v3', 'tetap');
  purgeForeignOutboxes('a@x.com');
  expect(readOutbox('a@x.com')).toHaveLength(1);
  expect(readOutbox('b@x.com')).toEqual([]);
  enqueueCheck('b@x.com', entry());
  clearAllOutboxes();
  expect(readOutbox('a@x.com')).toEqual([]);
  expect(readOutbox('b@x.com')).toEqual([]);
  expect(localStorage.getItem('qc.cache.v3')).toBe('tetap');
});

test('subscribeOutbox terpicu oleh perubahan; versi naik; berhenti setelah unsubscribe', () => {
  const listener = vi.fn();
  const off = subscribeOutbox(listener);
  const v0 = outboxVersion();
  enqueueCheck(OWNER, entry());
  expect(listener).toHaveBeenCalledTimes(1);
  expect(outboxVersion()).toBeGreaterThan(v0);
  const [e] = readOutbox(OWNER);
  removeEntries(OWNER, [e?.id ?? '']);
  expect(listener).toHaveBeenCalledTimes(2);
  off();
  enqueueCheck(OWNER, entry());
  expect(listener).toHaveBeenCalledTimes(2);
});

test('subscribeOutbox juga terpicu oleh peristiwa storage dari tab lain', () => {
  const listener = vi.fn();
  const off = subscribeOutbox(listener);
  window.dispatchEvent(new StorageEvent('storage', { key: outboxKey(OWNER) }));
  expect(listener).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent('storage', { key: 'qc.cache.v3' }));
  expect(listener).toHaveBeenCalledTimes(1);
  off();
});

test('overlayPendingChecks: teks cocok mencentang butir; teks beda atau task lain diabaikan', () => {
  const dto = makeHandover({ id: 'h1' });
  const entries = [
    { id: '1', taskId: 'h1', locationId: 'loc-a', index: 0, text: 'A = 1', checked: true, at: 1 },
    {
      id: '2',
      taskId: 'h1',
      locationId: 'loc-a',
      index: 1,
      text: 'sudah berubah',
      checked: true,
      at: 1,
    },
    { id: '3', taskId: 'lain', locationId: 'loc-a', index: 1, text: 'B = 2', checked: true, at: 1 },
  ];
  const out = overlayPendingChecks(dto, entries, 'qc@x', '2026-11-13T00:00:00.000Z');
  expect(out.checklist[0]).toMatchObject({ checked: true, by: 'qc@x' });
  expect(out.checklist[1]?.checked).toBe(false);
  expect(overlayPendingChecks(dto, [], 'qc@x', 'x')).toBe(dto);
});

test('purgeExpired: entri bertanggal di masa depan (> 5 menit) juga dianggap kedaluwarsa', () => {
  const now = 5_000_000;
  enqueueCheck(OWNER, entry({ index: 0, at: now + OUTBOX_MAX_FUTURE_SKEW_MS }));
  enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2', at: now + OUTBOX_MAX_FUTURE_SKEW_MS + 1 }));
  const dropped = purgeExpired(OWNER, now);
  expect(dropped.map((e) => e.index)).toEqual([1]);
  expect(readOutbox(OWNER).map((e) => e.index)).toEqual([0]);
});

test('penulisan ditahan (setelah keluar): enqueue false, tak ada tulis apa pun; resume memulihkan', () => {
  enqueueCheck(OWNER, entry({ index: 0 }));
  const [lama] = readOutbox(OWNER);
  suspendOutboxWrites();
  expect(outboxWritesSuspended()).toBe(true);
  expect(enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }))).toBe(false);
  removeEntries(OWNER, [lama?.id ?? '']);
  expect(readOutbox(OWNER)).toEqual([lama]);
  resumeOutboxWrites();
  expect(outboxWritesSuspended()).toBe(false);
  expect(enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }))).toBe(true);
});

test('clearAllOutboxes tetap bisa membuang walau penulisan ditahan', () => {
  enqueueCheck(OWNER, entry());
  suspendOutboxWrites();
  clearAllOutboxes();
  expect(localStorage.getItem(outboxKey(OWNER))).toBeNull();
});
