import { beforeEach, expect, test } from 'vitest';
import { makeExistingRow } from './draft';
import { readWarehouseDraft, writeWarehouseDraft } from './draft-store';
import { HAND_OFF_ROWS_MAX, handOffToDispatch } from './hand-off';
import { whSerial } from './test-support';

const EMAIL = 'wh@x.com';
const row = (n: number, over: Partial<Parameters<typeof handOffToDispatch>[0][number]> = {}) => ({
  serialId: `id${n}`,
  serial: `SN${n}`,
  itemId: 'item1',
  buId: 'bu1',
  ...over,
});

beforeEach(() => localStorage.clear());

test('menambah baris ke draf kosong: Item dan BU mengikuti baris pertama', () => {
  handOffToDispatch([row(1), row(2)], EMAIL);
  const draft = readWarehouseDraft(EMAIL);
  expect(draft?.itemId).toBe('item1');
  expect(draft?.filters.buId).toBe('bu1');
  expect(draft?.rows.map((r) => r.serial)).toEqual(['SN1', 'SN2']);
  expect(draft?.rows.every((r) => r.kind === 'existing')).toBe(true);
});

test('memakai snapshot yang diberikan pemanggil', () => {
  const snapshot = whSerial({ id: 'id1', serial: 'SN1', locationName: 'Gudang X' });
  handOffToDispatch([row(1, { snapshot })], EMAIL);
  const first = readWarehouseDraft(EMAIL)?.rows[0];
  expect(first?.kind === 'existing' && first.snapshot.locationName).toBe('Gudang X');
});

test('tidak menimpa draf yang ada: baris ditambahkan di akhir', () => {
  writeWarehouseDraft(EMAIL, {
    v: 1,
    itemId: 'item1',
    filters: { buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20', hideRecorded: false },
    rows: [makeExistingRow(whSerial({ id: 'old', serial: 'OLD' }))],
  });
  handOffToDispatch([row(1)], EMAIL);
  const draft = readWarehouseDraft(EMAIL);
  expect(draft?.rows.map((r) => r.serial)).toEqual(['OLD', 'SN1']);
  expect(draft?.filters).toMatchObject({ locationId: 'loc1', hideRecorded: false });
});

test('serial yang sudah ada di draf dilewati', () => {
  writeWarehouseDraft(EMAIL, {
    v: 1,
    itemId: 'item1',
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
    rows: [makeExistingRow(whSerial({ id: 'id1', serial: 'SN1' }))],
  });
  handOffToDispatch([row(1), row(2)], EMAIL);
  expect(readWarehouseDraft(EMAIL)?.rows.map((r) => r.serial)).toEqual(['SN1', 'SN2']);
});

test('melempar bila melebihi batas baris draf', () => {
  const many = Array.from({ length: HAND_OFF_ROWS_MAX + 1 }, (_, i) => row(i));
  expect(() => handOffToDispatch(many, EMAIL)).toThrow(
    'Terlalu banyak serial untuk satu pengeluaran',
  );
  expect(readWarehouseDraft(EMAIL)).toBeNull();
});

test('batas dihitung bersama baris draf yang sudah ada', () => {
  const existing = Array.from({ length: HAND_OFF_ROWS_MAX }, (_, i) =>
    makeExistingRow(whSerial({ id: `e${i}`, serial: `E${i}` })),
  );
  writeWarehouseDraft(EMAIL, {
    v: 1,
    itemId: 'item1',
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
    rows: existing,
  });
  expect(() => handOffToDispatch([row(1)], EMAIL)).toThrow(
    'Terlalu banyak serial untuk satu pengeluaran',
  );
});

test('Tipe atau BU campur ditolak, begitu pula Tipe yang beda dari draf', () => {
  expect(() => handOffToDispatch([row(1), row(2, { itemId: 'item2' })], EMAIL)).toThrow(
    'satu Tipe',
  );
  expect(() => handOffToDispatch([row(1), row(2, { buId: 'bu2' })], EMAIL)).toThrow('satu BU');
  writeWarehouseDraft(EMAIL, {
    v: 1,
    itemId: 'item1',
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
    rows: [makeExistingRow(whSerial({ id: 'old', serial: 'OLD' }))],
  });
  expect(() => handOffToDispatch([row(1, { itemId: 'item2' })], EMAIL)).toThrow('Tipe');
});

test('draf yang sedang dikirim tidak diubah', () => {
  writeWarehouseDraft(EMAIL, {
    v: 1,
    itemId: 'item1',
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
    rows: [makeExistingRow(whSerial({ id: 'old', serial: 'OLD' }))],
    submission: {
      clientId: 'c1',
      chunkSize: 200,
      sentChunks: 0,
      header: {
        dispatchedOn: '2026-11-26',
        orderNumber: 'SO-1',
        buId: 'bu1',
        customerName: 'PT A',
        itemId: 'item1',
        note: '',
        handoverIds: [],
        total: 1,
        chunkSize: 200,
      },
    },
  });
  expect(() => handOffToDispatch([row(1)], EMAIL)).toThrow('belum selesai');
});
