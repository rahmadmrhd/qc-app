import { beforeEach, expect, test } from 'bun:test';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { TableSchema } from './db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from './db';
import { setPlatform_ } from './platform';

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
