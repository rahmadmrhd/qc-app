import type { SerialRowResult } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  addSerials,
  applyBulk,
  applyResults,
  type Defaults,
  fromQcsnRows,
  isProofRejection,
  missingDefaults,
  proofIdsOf,
  removeRows,
  type StagingRow,
  toBatches,
  toRowInput,
} from './draft';

const defaults: Defaults = {
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  buId: 'b1',
  buLabel: 'BU1',
  testDate: '2026-11-12',
  locationId: 'l1',
  locationLabel: 'Jakarta',
  sample: false,
  note: '',
};

function counter() {
  let n = 0;
  return () => `id-${String(++n).padStart(8, '0')}`;
}
const now = () => '2026-11-12T10:00:00.000Z';

function seed(texts: string[]): StagingRow[] {
  return addSerials([], texts.join('\n'), defaults, counter(), now).rows;
}

test('addSerials: dua serial dalam satu isi QR menambah dua baris dengan bawaan rombongan', () => {
  const { rows, report } = addSerials([], 'abc123\nxyz789', defaults, counter(), now);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.serial)).toEqual(['ABC123', 'XYZ789']);
  expect(rows[0]).toMatchObject({
    itemId: 'i1',
    buId: 'b1',
    testDate: '2026-11-12',
    locationId: 'l1',
    sample: false,
    source: 'manual',
    stickers: null,
    selected: false,
    capturedAt: '2026-11-12T10:00:00.000Z',
  });
  expect(report).toEqual({ added: 2, duplicates: 0, rejected: [], truncated: false });
});

test('addSerials: serial yang sudah ada (termasuk varian MAC) dan ganda dalam teks dihitung duplikat', () => {
  const first = seed(['4C5E0C1A2B3D', 'SN-1']);
  const { rows, report } = addSerials(
    first,
    '4c:5e:0c:1a:2b:3d\nSN-1\nSN-2\nsn-2',
    defaults,
    counter(),
    now,
  );
  expect(rows.map((row) => row.serial)).toEqual(['4C5E0C1A2B3D', 'SN-1', 'SN-2']);
  expect(report.added).toBe(1);
  expect(report.duplicates).toBe(3);
});

test('addSerials: baris ditolak dilaporkan, batas 1.000 baris menandai truncated', () => {
  const rejected = addSerials([], 'ok1\nbad\u0007x', defaults, counter(), now);
  expect(rejected.report.rejected).toEqual(['bad\u0007x']);
  expect(rejected.rows).toHaveLength(1);

  const many = Array.from({ length: 1000 }, (_, index) => `S${index}`);
  const full = addSerials([], many.join('\n'), defaults, counter(), now);
  expect(full.rows).toHaveLength(1000);
  expect(full.report.truncated).toBe(false);
  const over = addSerials(full.rows, 'EXTRA', defaults, counter(), now);
  expect(over.rows).toHaveLength(1000);
  expect(over.report).toMatchObject({ added: 0, truncated: true });
  const paste = addSerials([], `${many.join('\n')}\nEXTRA`, defaults, counter(), now);
  expect(paste.rows).toHaveLength(1000);
  expect(paste.report.truncated).toBe(true);
});

test('applyBulk: hanya baris terpilih berubah; ganti item mengosongkan stiker ke null', () => {
  const rows = seed(['A1', 'A2', 'A3']).map((row) => ({
    ...row,
    stickers: [{ stickerId: 's1', name: 'Stiker', qty: 2 }],
  }));
  const ids = new Set([rows[0]?.clientId ?? '', rows[2]?.clientId ?? '']);
  const next = applyBulk(rows, ids, { locationId: 'l2', locationLabel: 'Surabaya' });
  expect(next.map((row) => row.locationId)).toEqual(['l2', 'l1', 'l2']);
  expect(next[0]?.stickers).toEqual([{ stickerId: 's1', name: 'Stiker', qty: 2 }]);
  const swapped = applyBulk(rows, ids, { itemId: 'i2', itemLabel: 'Lain' });
  expect(swapped.map((row) => row.stickers === null)).toEqual([true, false, true]);
  expect(swapped[1]).toBe(rows[1]);
});

test('applyBulk: mengatur ulang item/lokasi membersihkan tanda unresolved yang bersangkutan', () => {
  const rows = seed(['A1']).map((row) => ({
    ...row,
    unresolved: ['item', 'location'] as ('item' | 'location')[],
  }));
  const ids = new Set([rows[0]?.clientId ?? '']);
  const next = applyBulk(rows, ids, { itemId: 'i9' });
  expect(next[0]?.unresolved).toEqual(['location']);
});

test('removeRows membuang baris terpilih', () => {
  const rows = seed(['A1', 'A2']);
  expect(removeRows(rows, new Set([rows[0]?.clientId ?? ''])).map((row) => row.serial)).toEqual([
    'A2',
  ]);
});

test('applyResults: created dibuang, lainnya ditandai, urutan terjaga', () => {
  const rows = seed(['A1', 'A2', 'A3', 'A4']);
  const id = (n: number) => rows[n]?.clientId ?? '';
  const results: SerialRowResult[] = [
    { clientId: id(0), result: 'created', message: '' },
    { clientId: id(1), result: 'duplicate', message: 'Serial sudah terdaftar' },
    { clientId: id(2), result: 'invalid', message: 'Item tidak ditemukan' },
  ];
  const next = applyResults(rows, results);
  expect(next.map((row) => row.serial)).toEqual(['A2', 'A3', 'A4']);
  expect(next[0]).toMatchObject({ result: 'duplicate', message: 'Serial sudah terdaftar' });
  expect(next[1]).toMatchObject({ result: 'invalid' });
  expect(next[2]?.result).toBeUndefined();
});

test('toRowInput: stiker null melempar; selain itu bentuk kiriman server', () => {
  const [row] = seed(['A1']);
  if (!row) throw new Error('seed');
  expect(() => toRowInput(row)).toThrow();
  expect(toRowInput({ ...row, stickers: [{ stickerId: 's1', name: 'X', qty: 2 }] })).toEqual({
    clientId: row.clientId,
    serial: 'A1',
    itemId: 'i1',
    buId: 'b1',
    testDate: '2026-11-12',
    locationId: 'l1',
    sample: false,
    note: '',
    stickers: [{ stickerId: 's1', qty: 2 }],
  });
});

test('toBatches: 450 baris menjadi 200/200/50', () => {
  const batches = toBatches(Array.from({ length: 450 }, (_, index) => index));
  expect(batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
  expect(toBatches([])).toEqual([]);
});

test('fromQcsnRows: melewati serial dan clientId yang sudah ada', () => {
  const existing = seed(['A1']);
  const base = {
    testDate: '2026-11-12',
    itemId: 'i1',
    itemLabel: 'C',
    buId: 'b1',
    buLabel: 'BU1',
    locationId: 'l1',
    locationLabel: 'J',
    status: 'good' as const,
    capturedAt: 'x',
  };
  const imported = [
    {
      ...base,
      clientId: 'imp-00000001',
      serial: 'A1',
      sample: false,
      note: '',
      status: 'good' as const,
      source: 'manual' as const,
    },
    {
      ...base,
      clientId: 'imp-00000002',
      serial: 'B2',
      sample: true,
      note: 'n',
      status: 'good' as const,
      source: 'countrylock' as const,
      stickers: [{ stickerId: 's1', stickerLabel: 'Stiker', qty: 3 }],
    },
  ];
  const result = fromQcsnRows(existing, imported);
  expect(result).toMatchObject({ added: 1, skipped: 1, truncated: false });
  expect(result.rows[1]).toMatchObject({
    serial: 'B2',
    sample: true,
    source: 'countrylock',
    stickers: [{ stickerId: 's1', name: 'Stiker', qty: 3 }],
  });
});

test('addSerials: bawaan stickers disalin per baris (bukan referensi bersama); tanpa bawaan = null', () => {
  const picks = [{ stickerId: 's1', name: 'Stiker A', qty: 2 }];
  const withPicks = addSerials([], 'A1\nB2', { ...defaults, stickers: picks }, counter(), now);
  const [first, second] = withPicks.rows;
  expect(first?.stickers).toEqual(picks);
  expect(second?.stickers).toEqual(picks);
  expect(first?.stickers).not.toBe(picks);
  expect(first?.stickers).not.toBe(second?.stickers);
  const plain = addSerials([], 'C3', defaults, counter(), now);
  expect(plain.rows[0]?.stickers).toBeNull();
});

test('toRowInput tidak mengirim status atau damage; source hanya untuk countrylock', () => {
  const [row] = addSerials([], 'A1', defaults, counter(), now).rows.map((entry) => ({
    ...entry,
    stickers: [],
  }));
  const input = toRowInput(row as StagingRow);
  expect(input).not.toHaveProperty('status');
  expect(input).not.toHaveProperty('damage');
  expect(input).not.toHaveProperty('source');
  expect(toRowInput({ ...(row as StagingRow), source: 'countrylock' }).source).toBe('countrylock');
});

const photo = (id: string) => ({
  id,
  mime: 'image/webp',
  size: 100,
  thumbUrl: `/api/v1/serial-proofs/${id}`,
});

test('baris baru (tempel, impor .qcsn) mulai tanpa foto bukti', () => {
  const [row] = seed(['A1']);
  expect(row?.proofPhotos).toEqual([]);
  const imported = fromQcsnRows(
    [],
    [
      {
        clientId: 'imp-00000001',
        serial: 'B2',
        testDate: '2026-11-12',
        itemId: 'i1',
        itemLabel: 'C',
        buId: 'b1',
        buLabel: 'BU1',
        locationId: 'l1',
        locationLabel: 'J',
        sample: false,
        note: '',
        status: 'good',
        source: 'manual',
        capturedAt: 'x',
      },
    ],
  );
  expect(imported.rows[0]?.proofPhotos).toEqual([]);
});

test('toRowInput: proofPhotoIds hanya dikirim bila ada foto, urut sesuai baris', () => {
  const [row] = seed(['A1']);
  if (!row) throw new Error('seed');
  const base = { ...row, stickers: [] };
  expect(toRowInput(base)).not.toHaveProperty('proofPhotoIds');
  expect(toRowInput({ ...base, proofPhotos: [photo('p2'), photo('p1')] })).toMatchObject({
    proofPhotoIds: ['p2', 'p1'],
  });
});

test('proofIdsOf mengumpulkan id foto semua baris', () => {
  const rows = seed(['A1', 'A2', 'A3']).map((row, index) =>
    index === 2 ? row : { ...row, proofPhotos: [photo(`p${index}a`), photo(`p${index}b`)] },
  );
  expect(proofIdsOf(rows)).toEqual(['p0a', 'p0b', 'p1a', 'p1b']);
  expect(proofIdsOf([])).toEqual([]);
});

test('applyResults: foto kedaluwarsa atau tak dikenal membuang foto baris (baris tetap, pesan server dipertahankan)', () => {
  const rows = seed(['A1', 'A2', 'A3']).map((row) => ({
    ...row,
    proofPhotos: [photo(`p-${row.serial}`)],
  }));
  const id = (n: number) => rows[n]?.clientId ?? '';
  const next = applyResults(rows, [
    { clientId: id(0), result: 'invalid', message: 'Foto sudah kedaluwarsa, unggah ulang' },
    {
      clientId: id(1),
      result: 'invalid',
      message: 'Ada foto yang tidak dikenal atau sudah dipakai',
    },
    { clientId: id(2), result: 'invalid', message: 'Item tidak ditemukan' },
  ]);
  expect(next).toHaveLength(3);
  expect(next[0]).toMatchObject({
    result: 'invalid',
    message: 'Foto sudah kedaluwarsa, unggah ulang',
    proofPhotos: [],
  });
  expect(next[1]).toMatchObject({ result: 'invalid', proofPhotos: [] });
  // Galat lain: foto tetap melekat agar tak hilang tanpa sebab.
  expect(next[2]?.proofPhotos).toHaveLength(1);
});

test('missingDefaults: daftar label field Default yang kosong menurut urutan form', () => {
  const full = { itemId: 'i1', buId: 'b1', locationId: 'l1', testDate: '2026-11-12' };
  expect(missingDefaults(full)).toEqual([]);
  expect(missingDefaults({ itemId: '', buId: '', locationId: '', testDate: '' })).toEqual([
    'Lokasi',
    'Tanggal uji',
    'Item',
    'Business Unit',
  ]);
  expect(missingDefaults({ ...full, locationId: '' })).toEqual(['Lokasi']);
  expect(missingDefaults({ ...full, buId: '', testDate: '' })).toEqual([
    'Tanggal uji',
    'Business Unit',
  ]);
});

test('addSerials menyalin proofMin dari Defaults; tanpa wajib foto kuncinya tidak ada', () => {
  const strict = addSerials([], 'A1', { ...defaults, proofMin: 3 }, counter(), now).rows;
  expect(strict[0]?.proofMin).toBe(3);
  const plain = addSerials([], 'A1', { ...defaults, proofMin: 0 }, counter(), now).rows;
  expect(plain[0]).not.toHaveProperty('proofMin');
});

test('applyBulk: ganti item memperbarui proofMin baris terpilih saja', () => {
  const rows = addSerials(
    [],
    `A1${String.fromCharCode(10)}B2`,
    { ...defaults, proofMin: 2 },
    counter(),
    now,
  ).rows;
  const [first, second] = rows;
  if (!first || !second) throw new Error('seed');
  const next = applyBulk(rows, new Set([first.clientId]), {
    itemId: 'i2',
    itemLabel: 'Aruba',
    buId: 'b1',
    buLabel: 'BU1',
    proofMin: 0,
  });
  expect(next[0]?.proofMin).toBe(0);
  expect(next[1]?.proofMin).toBe(2);
});

test('isProofRejection tidak mengenali pesan wajib foto (foto baris tidak boleh dikosongkan)', () => {
  expect(isProofRejection('Item ini wajib foto bukti minimal 2')).toBe(false);
  expect(isProofRejection('Foto sudah kedaluwarsa, unggah ulang')).toBe(true);
});
