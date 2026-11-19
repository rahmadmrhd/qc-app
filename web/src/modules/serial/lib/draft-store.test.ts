import { afterEach, expect, test, vi } from 'vitest';
import { addSerials, type Defaults, type StagingRow } from './draft';
import {
  clearAllDrafts,
  clearDraft,
  loadDraft,
  NOT_GOOD_MESSAGE,
  parseDraftRows,
  resumeDraftWrites,
  saveDraft,
} from './draft-store';

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
  resumeDraftWrites();
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

test('setelah clearAllDrafts penulisan draf ditahan sampai resumeDraftWrites', () => {
  const data = rows(2);
  clearAllDrafts();
  expect(saveDraft('a@x.com', data)).toBe(true);
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  resumeDraftWrites();
  expect(saveDraft('a@x.com', data)).toBe(true);
  expect(loadDraft('a@x.com')).toEqual(data);
});

test('draf lama tanpa status dipulihkan; baris berstatus selain Lolos (draf 5b) menjadi baris bermasalah, tidak dibuang', () => {
  const [first, second] = rows(2) as [StagingRow, StagingRow];
  const problem = (row: StagingRow): StagingRow => ({
    ...row,
    result: 'invalid',
    message: NOT_GOOD_MESSAGE,
  });
  localStorage.setItem(
    'qc.serial.draft:a@x.com',
    JSON.stringify([first, { ...second, status: 'failed', damage: 'Port mati' }]),
  );
  expect(loadDraft('a@x.com')).toEqual([first, problem(second)]);
  localStorage.setItem(
    'qc.serial.draft:a@x.com',
    JSON.stringify([
      { ...first, status: 'good' },
      { ...second, status: 'broken', result: 'duplicate', message: 'x' },
    ]),
  );
  expect(loadDraft('a@x.com')).toEqual([first, problem(second)]);
  expect(NOT_GOOD_MESSAGE).toContain('Lapor Rusak');
});

test('foto bukti: bolak-balik simpan-muat, draf lama tanpa field = tanpa foto, entri rusak dibuang', () => {
  const [row] = rows(1);
  if (!row) throw new Error('seed');
  const photo = { id: 'p1', mime: 'image/webp', size: 100, thumbUrl: '/api/v1/serial-proofs/p1' };
  saveDraft('a@x.com', [{ ...row, proofPhotos: [photo] }]);
  expect(loadDraft('a@x.com')[0]?.proofPhotos).toEqual([photo]);

  // Draf lama (sebelum fitur ini): kunci proofPhotos tidak ada.
  const { proofPhotos: _drop, ...legacy } = row;
  localStorage.setItem('qc.serial.draft:a@x.com', JSON.stringify([legacy]));
  expect(loadDraft('a@x.com')[0]?.proofPhotos).toEqual([]);

  // Entri rusak dibuang satu per satu; maksimal 5 foto yang dipulihkan.
  const many = Array.from({ length: 8 }, (_, index) => ({ ...photo, id: `p${index}` }));
  localStorage.setItem(
    'qc.serial.draft:a@x.com',
    JSON.stringify([
      {
        ...row,
        proofPhotos: [
          { id: 5 },
          null,
          'x',
          { ...photo, size: 'besar' },
          { ...photo, thumbUrl: 7 },
          ...many,
        ],
      },
    ]),
  );
  expect(loadDraft('a@x.com')[0]?.proofPhotos.map((entry) => entry.id)).toEqual([
    'p0',
    'p1',
    'p2',
    'p3',
    'p4',
  ]);
  localStorage.setItem('qc.serial.draft:a@x.com', JSON.stringify([{ ...row, proofPhotos: 'x' }]));
  expect(loadDraft('a@x.com')[0]?.proofPhotos).toEqual([]);
});

test('proofMin baris dipulihkan; draft lama tanpa proofMin tetap dimuat tanpa nilai itu; nilai tak sah dibuang', () => {
  const base = {
    clientId: 'c1',
    serial: 'A1',
    itemId: 'i1',
    itemLabel: 'Cisco',
    buId: 'b1',
    buLabel: 'BU1',
    testDate: '2026-11-12',
    locationId: 'l1',
    locationLabel: 'Jakarta',
    sample: false,
    note: '',
    capturedAt: '2026-11-12T10:00:00.000Z',
    source: 'manual',
    stickers: null,
    proofPhotos: [],
  };
  localStorage.setItem(
    'qc.serial.draft:p@x.com',
    JSON.stringify([
      { ...base, clientId: 'a', proofMin: 2 },
      { ...base, clientId: 'b' },
      { ...base, clientId: 'c', proofMin: 99 },
      { ...base, clientId: 'd', proofMin: 'dua' },
    ]),
  );
  const rows = loadDraft('p@x.com');
  expect(rows.map((row) => row.proofMin)).toEqual([2, undefined, undefined, undefined]);
});

test('parseDraftRows: bukan larik = kosong; entri rusak dan clientId kembar dibuang; dibatasi 1.000 baris', () => {
  expect(parseDraftRows(null)).toEqual([]);
  expect(parseDraftRows({ rows: [] })).toEqual([]);
  const good = rows(2).map(({ selected: _selected, ...row }) => row);
  const parsed = parseDraftRows([good[0], 'rusak', { serial: 1 }, good[0], good[1]]);
  expect(parsed.map((row) => row.serial)).toEqual(rows(2).map((row) => row.serial));
  expect(parsed.every((row) => row.selected === false)).toBe(true);
  expect(parseDraftRows(rows(1005))).toHaveLength(1000);
});
