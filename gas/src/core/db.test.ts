import { beforeEach, expect, test } from 'bun:test';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { TableSchema } from './db';
import {
  applyTextFormats_,
  deleteRow_,
  insertRow_,
  openTable_,
  readTable_,
  TEXT_FORMATS_PROPERTY,
  updateRow_,
} from './db';
import { setPlatform_, withRequestCache_ } from './platform';
import { utf8Length_ } from './table-cache';

const TABLE: TableSchema = { sheetName: 'things', columns: ['id', 'name', 'note'] };
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform();
  setPlatform_(platform);
});

test('membuat sheet beserta header bila belum ada', () => {
  expect(readTable_(TABLE).rows).toEqual([]);
  expect(platform.db.sheet('things').rows).toEqual([['id', 'name', 'note']]);
});

test('menambah kolom yang hilang tanpa mengganggu kolom lama dan kolom manual', () => {
  platform.db.insertSheet('things').rows = [
    ['name', 'manual', 'id'],
    ['Budi', 'x', '1'],
  ];
  const table = readTable_(TABLE);
  expect(table.header).toEqual(['name', 'manual', 'id', 'note']);
  expect(table.rows).toEqual([
    { rowNumber: 2, data: { name: 'Budi', manual: 'x', id: '1', note: '' } },
  ]);
});

test('membaca berdasarkan nama header, melewati baris kosong, dan mengubah sel menjadi string', () => {
  platform.db.insertSheet('things').rows = [
    ['note', 'id', 'name'],
    ['', '', ''],
    ['catatan', 7, 'Ani'],
    [new Date('2026-01-02T03:04:05.000Z'), 'b', 'Budi'],
  ];
  expect(readTable_(TABLE).rows).toEqual([
    { rowNumber: 3, data: { note: 'catatan', id: '7', name: 'Ani' } },
    { rowNumber: 4, data: { note: '2026-01-02T03:04:05.000Z', id: 'b', name: 'Budi' } },
  ]);
});

test('insertRow_ menyimpan teks berawalan = + - @ sebagai teks literal', () => {
  insertRow_(TABLE, { id: '1', name: '=SUM(A1:A2)', note: '@budi' });
  insertRow_(TABLE, { id: '2', name: '+62812', note: '-5' });
  expect(readTable_(TABLE).rows.map((row) => row.data)).toEqual([
    { id: '1', name: '=SUM(A1:A2)', note: '@budi' },
    { id: '2', name: '+62812', note: '-5' },
  ]);
});

test('updateRow_ hanya mengubah kolom yang diberikan dan tetap menjaga teks berbahaya di kolom lain', () => {
  insertRow_(TABLE, { id: '1', name: '=1+1', note: 'lama' });
  updateRow_(TABLE, 2, { note: 'baru' });
  expect(readTable_(TABLE).rows[0]?.data).toEqual({ id: '1', name: '=1+1', note: 'baru' });
});

test('deleteRow_ menghapus baris', () => {
  insertRow_(TABLE, { id: '1', name: 'A', note: '' });
  insertRow_(TABLE, { id: '2', name: 'B', note: '' });
  deleteRow_(TABLE, 2);
  expect(readTable_(TABLE).rows.map((row) => row.data.id)).toEqual(['2']);
});

test('teks mirip angka, tanggal, atau formula tersimpan apa adanya (Sheets tidak menafsirkan ulang)', () => {
  const tricky = ['0815', '1/2', '2026-10-15', '1e3', '007.50', '=1+1', "'kutip", '+62812'];
  tricky.forEach((value, index) => {
    insertRow_(TABLE, { id: String(index), name: value, note: value });
  });
  expect(readTable_(TABLE).rows.map((row) => row.data.name)).toEqual(tricky);
  tricky.forEach((value, index) => {
    updateRow_(TABLE, index + 2, { note: `${value}!` });
  });
  expect(readTable_(TABLE).rows.map((row) => [row.data.name, row.data.note])).toEqual(
    tricky.map((value) => [value, `${value}!`]),
  );
  updateRow_(TABLE, 2, { note: '0815' });
  expect(readTable_(TABLE).rows[0]?.data.note).toBe('0815');
});

function countSheetCalls(): { reads: () => number } {
  const sheet = platform.db.sheet('things');
  return { reads: () => sheet.calls };
}

test('cache permintaan: pembacaan tabel kedua dalam satu permintaan tidak menyentuh Sheets; hasilnya salinan', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  const calls = countSheetCalls();
  withRequestCache_(() => {
    const first = readTable_(TABLE);
    const afterFirst = calls.reads();
    first.rows[0]!.data.name = 'DIUBAH'; // mengubah salinan tidak boleh merusak cache
    const second = readTable_(TABLE);
    expect(calls.reads()).toBe(afterFirst);
    expect(second.rows[0]?.data.name).toBe('Ani');
  });
});

test('cache permintaan: tulis lewat db membuang cache tabel (insert, update, delete)', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  withRequestCache_(() => {
    expect(readTable_(TABLE).rows).toHaveLength(1);
    insertRow_(TABLE, { id: '2', name: 'Budi' });
    expect(readTable_(TABLE).rows).toHaveLength(2);
    updateRow_(TABLE, 2, { name: 'Ani B' });
    expect(readTable_(TABLE).rows[0]?.data.name).toBe('Ani B');
    deleteRow_(TABLE, 2);
    expect(readTable_(TABLE).rows.map((row) => row.data.id)).toEqual(['2']);
  });
});

test('cache permintaan: masuk dan keluar lock membuang cache sehingga pembacaan di dalam lock selalu segar', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  withRequestCache_(() => {
    expect(readTable_(TABLE).rows).toHaveLength(1);
    // eksekusi lain menulis langsung ke sheet sebelum lock diambil
    platform.db.sheet('things').rows.push(['2', 'Budi', '']);
    expect(readTable_(TABLE).rows).toHaveLength(1); // di luar lock boleh basi
    platform.withLock(() => {
      expect(readTable_(TABLE).rows).toHaveLength(2);
      platform.db.sheet('things').rows.push(['3', 'Cici', '']);
    });
    expect(readTable_(TABLE).rows).toHaveLength(3);
  });
});

test('tanpa withRequestCache_ (mis. tes yang memanggil repo langsung) tidak ada cache', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  expect(readTable_(TABLE).rows).toHaveLength(1);
  platform.db.sheet('things').rows.push(['2', 'Budi', '']);
  expect(readTable_(TABLE).rows).toHaveLength(2);
});

const SHARED: TableSchema = {
  sheetName: 'shared_things',
  columns: ['id', 'name'],
  sharedCache: true,
};

test('baca tabel = SATU panggilan Sheets (getDataRange), termasuk header', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  const sheet = platform.db.sheet('things');
  const before = sheet.calls;
  expect(readTable_(TABLE).rows).toHaveLength(1);
  expect(sheet.calls - before).toBe(1);
});

test('tulis memperbarui cache permintaan di tempat: pembacaan sesudah tulis tidak menyentuh Sheets', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani' });
  withRequestCache_(() => {
    readTable_(TABLE);
    const sheet = platform.db.sheet('things');
    insertRow_(TABLE, { id: '2', name: 'Budi' });
    updateRow_(TABLE, 2, { name: 'Ani B' });
    deleteRow_(TABLE, 2);
    const before = sheet.calls;
    const table = readTable_(TABLE);
    expect(sheet.calls).toBe(before);
    expect(table.rows).toEqual([{ rowNumber: 2, data: { id: '2', name: 'Budi', note: '' } }]);
    // isi cache sama dengan isi sheet sesungguhnya
    expect(withRequestCache_(() => readTable_(TABLE)).rows).toEqual(table.rows);
  });
  expect(readTable_(TABLE).rows).toEqual([
    { rowNumber: 2, data: { id: '2', name: 'Budi', note: '' } },
  ]);
});

test('update memakai baris dari cache (tanpa membaca baris lagi) dan mempertahankan kolom yang tidak disebut', () => {
  insertRow_(TABLE, { id: '1', name: 'Ani', note: 'catatan' });
  withRequestCache_(() => {
    readTable_(TABLE);
    const sheet = platform.db.sheet('things');
    const before = sheet.calls;
    updateRow_(TABLE, 2, { name: 'Ani B' });
    // hanya 1 panggilan: setValues (tanpa membaca baris, format teks per tulis memakai panggilan yang sama)
    expect(sheet.calls - before).toBeLessThanOrEqual(1);
  });
  expect(readTable_(TABLE).rows[0]?.data).toEqual({ id: '1', name: 'Ani B', note: 'catatan' });
});

test('penanda format teks: setelah kolom diformat, tulis memakai appendRow dan teks mirip angka/formula tetap teks', () => {
  openTable_(TABLE);
  applyTextFormats_(TABLE);
  platform.setProperty(TEXT_FORMATS_PROPERTY, '1');
  insertRow_(TABLE, { id: '1', name: '0815', note: '=1+1' });
  updateRow_(TABLE, 2, { name: '1/2' });
  expect(readTable_(TABLE).rows[0]?.data).toEqual({ id: '1', name: '1/2', note: '=1+1' });
  expect(platform.db.sheet('things').rows[1]).toEqual(['1', '1/2', '=1+1']);
});

test('tanpa penanda: tulis tetap memformat teks per baris (data lama sebelum setup aman)', () => {
  insertRow_(TABLE, { id: '1', name: '0815', note: '=1+1' });
  expect(platform.db.sheet('things').rows[1]).toEqual(['1', '0815', '=1+1']);
});

test('tabel melewati batas baris sheet: baris ditambah dulu agar tulis tidak gagal (tanpa penanda)', () => {
  openTable_(TABLE);
  const sheet = platform.db.sheet('things');
  sheet.maxRows = 2; // header + 1 baris
  insertRow_(TABLE, { id: '1', name: 'A' });
  insertRow_(TABLE, { id: '2', name: 'B' });
  insertRow_(TABLE, { id: '3', name: 'C' });
  expect(sheet.getMaxRows()).toBeGreaterThanOrEqual(4);
  expect(readTable_(TABLE).rows.map((row) => row.data.id)).toEqual(['1', '2', '3']);
});

test('cache lintas request: permintaan kedua tidak menyentuh Sheets; tulis mengganti versi', () => {
  insertRow_(SHARED, { id: '1', name: 'Ani' });
  const sheet = platform.db.sheet('shared_things');
  withRequestCache_(() => readTable_(SHARED)); // mengisi cache lintas request
  const before = sheet.calls;
  const second = withRequestCache_(() => readTable_(SHARED));
  expect(sheet.calls).toBe(before);
  expect(second.rows[0]?.data.name).toBe('Ani');
  // tulis (dalam lock) → permintaan berikutnya membaca Sheets lagi dan melihat data baru
  withRequestCache_(() => platform.withLock(() => insertRow_(SHARED, { id: '2', name: 'Budi' })));
  const third = withRequestCache_(() => readTable_(SHARED));
  expect(third.rows.map((row) => row.data.id)).toEqual(['1', '2']);
});

test('cache lintas request: versi diganti lagi setelah flush di akhir lock (pembaca yang menyusup tidak mengunci data basi)', () => {
  insertRow_(SHARED, { id: '1', name: 'Ani' });
  const versions: string[] = [];
  platform.withLock(() => {
    insertRow_(SHARED, { id: '2', name: 'Budi' });
    versions.push(platform.cacheGet('tblv:shared_things') ?? '');
  });
  versions.push(platform.cacheGet('tblv:shared_things') ?? '');
  expect(versions[0]).not.toBe('');
  expect(versions[1]).not.toBe(versions[0]);
});

test('cache lintas request: tabel di atas batas ukuran tidak disimpan; panjang UTF-8 dihitung benar', () => {
  expect(utf8Length_('abc')).toBe(3);
  expect(utf8Length_('é')).toBe(2);
  expect(utf8Length_('€')).toBe(3);
  expect(utf8Length_('😀')).toBe(4);
  const big = 'x'.repeat(95_000);
  insertRow_(SHARED, { id: '1', name: big });
  withRequestCache_(() => readTable_(SHARED));
  const sheet = platform.db.sheet('shared_things');
  const before = sheet.calls;
  withRequestCache_(() => readTable_(SHARED));
  expect(sheet.calls).toBeGreaterThan(before); // tidak ada di cache → membaca Sheets lagi
});

test('cache lintas request diabaikan bila skema punya kolom baru yang belum ada di cache', () => {
  insertRow_(SHARED, { id: '1', name: 'Ani' });
  withRequestCache_(() => readTable_(SHARED));
  const wider: TableSchema = { ...SHARED, columns: ['id', 'name', 'extra'] };
  const table = withRequestCache_(() => readTable_(wider));
  expect(table.header).toEqual(['id', 'name', 'extra']);
  expect(table.rows[0]?.data.extra).toBe('');
});
