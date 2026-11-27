import { beforeEach, expect, test } from 'vitest';
import { makeExistingRow, makeNewRow } from './draft';
import {
  clearAllWarehouseDrafts,
  clearWarehouseDraft,
  draftDispatchId,
  parseWarehouseDraft,
  readWarehouseDraft,
  serializeWarehouseDraft,
  type WarehouseDraft,
  writeWarehouseDraft,
} from './draft-store';
import { whSerial } from './test-support';

const draftWith = (rows: WarehouseDraft['rows']): WarehouseDraft => ({
  v: 1,
  itemId: 'item1',
  filters: { buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20', hideRecorded: true },
  rows,
});

beforeEach(() => localStorage.clear());

test('tulis lalu baca kembali', () => {
  const draft = draftWith([makeExistingRow(whSerial())]);
  expect(writeWarehouseDraft('A@x.id', draft)).toBe(true);
  expect(readWarehouseDraft('a@x.id')).toEqual(draft);
});

test('draf rusak atau versi lain = null', () => {
  expect(parseWarehouseDraft('{')).toBeNull();
  expect(parseWarehouseDraft(null)).toBeNull();
  expect(parseWarehouseDraft(JSON.stringify({ ...draftWith([]), v: 2 }))).toBeNull();
  expect(parseWarehouseDraft(JSON.stringify({ v: 1, itemId: 'x' }))).toBeNull();
});

test('baris dengan bentuk rusak membuat seluruh draf null', () => {
  const good = draftWith([makeExistingRow(whSerial())]);
  const broken = { ...good, rows: [...good.rows, { kind: 'new', clientId: '' }] };
  expect(parseWarehouseDraft(JSON.stringify(broken))).toBeNull();
  const noSnapshot = { ...good, rows: [{ kind: 'existing', id: 'a', serial: 'A' }] };
  expect(parseWarehouseDraft(JSON.stringify(noSnapshot))).toBeNull();
});

test('kiriman rusak membuat draf null', () => {
  const draft = { ...draftWith([]), submission: { clientId: 'c' } };
  expect(parseWarehouseDraft(JSON.stringify(draft))).toBeNull();
});

test('5.000 baris: cepat dan jauh di bawah kuota penyimpanan', () => {
  const ref = (n: number) => ({
    orderId: `o${n}`,
    orderNumber: `SO-${n}`,
    buId: 'bu1',
    buCode: 'A',
    dispatchedOn: '2026-11-10',
  });
  const rows = Array.from({ length: 5000 }, (_, i) =>
    makeExistingRow(
      whSerial({
        id: `01jabcdefghjkmnpqrstvwxyz${i}`.slice(0, 26),
        serial: `SN${String(i).padStart(8, '0')}`,
        dispatches: Array.from({ length: 20 }, (_, n) => ref(n)),
      }),
    ),
  );
  const draft = draftWith(rows);
  const started = performance.now();
  const text = serializeWarehouseDraft(draft);
  const parsed = parseWarehouseDraft(text);
  expect(performance.now() - started).toBeLessThan(1500);
  expect(parsed?.rows).toHaveLength(5000);
  // Snapshot dipangkas: 5.000 baris tidak mendekati batas ~5 MB.
  expect(text.length).toBeLessThan(3_000_000);
});

test('clientId baris baru stabil antar tulis dan baca', () => {
  const row = makeNewRow({
    serial: 'N1',
    itemId: 'item1',
    buId: 'bu1',
    locationId: 'loc1',
    testDate: '2026-11-20',
  });
  writeWarehouseDraft('a@x.id', draftWith([row]));
  expect(readWarehouseDraft('a@x.id')?.rows[0]).toEqual(row);
});

test('hapus per pemilik dan hapus semua', () => {
  writeWarehouseDraft('a@x.id', draftWith([]));
  writeWarehouseDraft('b@x.id', draftWith([]));
  clearWarehouseDraft('a@x.id');
  expect(readWarehouseDraft('a@x.id')).toBeNull();
  expect(readWarehouseDraft('b@x.id')).not.toBeNull();
  clearAllWarehouseDrafts();
  expect(readWarehouseDraft('b@x.id')).toBeNull();
});

test('storage yang menolak tulis tidak melempar', () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error('quota');
  };
  try {
    expect(writeWarehouseDraft('a@x.id', draftWith([]))).toBe(false);
  } finally {
    Storage.prototype.setItem = original;
  }
});

test('draftDispatchId: membaca id pengeluaran dan mengikuti perubahan isi draf', () => {
  const base = draftWith([makeExistingRow(whSerial())]);
  expect(draftDispatchId('a@x.id')).toBeNull();
  const submission = {
    clientId: 'c',
    header: { orderNumber: 'SO', itemId: 'item1', total: 1, handoverIds: [] },
    chunkSize: 500,
    sentChunks: 1,
    dispatchId: 'd1',
  } as unknown as NonNullable<WarehouseDraft['submission']>;
  writeWarehouseDraft('a@x.id', { ...base, submission });
  expect(draftDispatchId('a@x.id')).toBe('d1');
  expect(draftDispatchId('a@x.id')).toBe('d1');
  writeWarehouseDraft('a@x.id', { ...base, submission: { ...submission, dispatchId: 'd2' } });
  expect(draftDispatchId('a@x.id')).toBe('d2');
  clearWarehouseDraft('a@x.id');
  expect(draftDispatchId('a@x.id')).toBeNull();
});

test('skipped tersimpan dan terbaca; bentuk rusak dibuang tanpa menjatuhkan draf', () => {
  const base = draftWith([makeExistingRow(whSerial())]);
  const withSkipped = { ...base, skipped: [{ serial: 'A', reason: 'Tipe berbeda' }] };
  expect(parseWarehouseDraft(serializeWarehouseDraft(withSkipped))?.skipped).toEqual([
    { serial: 'A', reason: 'Tipe berbeda' },
  ]);
  const broken = JSON.stringify({ ...base, skipped: [{ serial: 1 }, 'x'] });
  const parsed = parseWarehouseDraft(broken);
  expect(parsed).not.toBeNull();
  expect(parsed?.skipped).toBeUndefined();
});
