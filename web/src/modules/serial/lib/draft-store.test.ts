import { afterEach, expect, test, vi } from 'vitest';
import { addSerials, type Defaults, type StagingRow } from './draft';
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from './draft-store';

const defaults: Defaults = {
  itemId: 'i1',
  itemLabel: 'Item',
  buId: 'b1',
  buLabel: 'BU1',
  testDate: '2026-11-12',
  locationId: 'l1',
  locationLabel: 'Jakarta',
  sample: false,
  note: '',
};

function rows(count: number): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    Array.from({ length: count }, (_, index) => `S${index}`).join('\n'),
    defaults,
    () => `id-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test('simpan lalu muat mengembalikan baris yang sama; kunci per pemilik', () => {
  const data = rows(3);
  expect(saveDraft('a@x.com', data)).toBe(true);
  expect(loadDraft('a@x.com')).toEqual(data);
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).not.toBeNull();
  expect(loadDraft('b@x.com')).toEqual([]);
});

test('baris terpilih tidak dipulihkan sebagai terpilih; hasil dan tanda unresolved dipertahankan', () => {
  const [row] = rows(1);
  if (!row) throw new Error('seed');
  saveDraft('a@x.com', [
    {
      ...row,
      selected: true,
      result: 'duplicate',
      message: 'Serial sudah terdaftar',
      unresolved: ['item'],
      stickers: [{ stickerId: 's1', name: 'X', qty: 2 }],
    },
  ]);
  expect(loadDraft('a@x.com')[0]).toMatchObject({
    selected: false,
    result: 'duplicate',
    message: 'Serial sudah terdaftar',
    unresolved: ['item'],
    stickers: [{ stickerId: 's1', name: 'X', qty: 2 }],
  });
});

test('saveDraft memotong ke 1.000 baris', () => {
  expect(saveDraft('a@x.com', rows(1000).concat(rows(5)))).toBe(true);
  expect(loadDraft('a@x.com')).toHaveLength(1000);
});

test('kuota penuh: saveDraft mengembalikan false tanpa melempar', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  expect(saveDraft('a@x.com', rows(2))).toBe(false);
});

test('JSON rusak, bukan larik, atau baris tak valid dan kembar menghasilkan sisa yang sah saja', () => {
  localStorage.setItem('qc.serial.draft:a@x.com', '{rusak');
  expect(loadDraft('a@x.com')).toEqual([]);
  localStorage.setItem('qc.serial.draft:a@x.com', '{"a":1}');
  expect(loadDraft('a@x.com')).toEqual([]);
  const [row] = rows(1);
  localStorage.setItem(
    'qc.serial.draft:a@x.com',
    JSON.stringify([row, row, { clientId: 1 }, null, 'x']),
  );
  expect(loadDraft('a@x.com')).toEqual([row]);
});

test('draf kosong menghapus kunci; clearDraft dan clearAllDrafts hanya menyentuh kunci draf', () => {
  saveDraft('a@x.com', rows(1));
  saveDraft('b@x.com', rows(1));
  localStorage.setItem('qc.cache.v3', '{}');
  saveDraft('a@x.com', []);
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  saveDraft('a@x.com', rows(1));
  clearDraft('a@x.com');
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  expect(localStorage.getItem('qc.serial.draft:b@x.com')).not.toBeNull();
  saveDraft('a@x.com', rows(1));
  clearAllDrafts();
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  expect(localStorage.getItem('qc.serial.draft:b@x.com')).toBeNull();
  expect(localStorage.getItem('qc.cache.v3')).toBe('{}');
});

test('storage yang melempar tidak membuat apa pun gagal', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(loadDraft('a@x.com')).toEqual([]);
  expect(() => clearDraft('a@x.com')).not.toThrow();
  expect(() => clearAllDrafts()).not.toThrow();
});
