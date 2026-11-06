import { beforeEach, expect, test } from 'bun:test';
import {
  createMemoryBridgePlatform,
  type MemoryBridgePlatform,
  signForTest,
} from '@bridge-test/memory-platform';
import { handleBridge_ } from './dispatch';
import { setBridgePlatform_ } from './platform';

let platform: MemoryBridgePlatform;

function call(action: string, payload: unknown): Record<string, unknown> {
  platform.setNow(platform.now() + 1);
  const ts = platform.now();
  return JSON.parse(
    handleBridge_(JSON.stringify({ action, ts, sig: signForTest(action, ts, payload), payload })),
  );
}

beforeEach(() => {
  platform = createMemoryBridgePlatform({ properties: { SPREADSHEET_ID: 'SS' } });
  setBridgePlatform_(platform);
  const book = new Map<string, string[][]>();
  book.set('brands', [
    ['id', 'name'],
    ['b1', 'Acme'],
  ]);
  book.set('items', [
    ['id', 'model'],
    ['i1', 'X'],
  ]);
  book.set('export_old', [['x']]);
  platform.sheets.set('SS', book);
  platform.effects.length = 0;
});

test('sheets.dump mengembalikan semua sheet sumber (header di baris pertama), tanpa sheet ekspor', () => {
  expect(call('sheets.dump', {})).toEqual({
    ok: true,
    data: {
      tables: {
        brands: [
          ['id', 'name'],
          ['b1', 'Acme'],
        ],
        items: [
          ['id', 'model'],
          ['i1', 'X'],
        ],
      },
    },
  });
  expect(platform.effects).toEqual([]);
});

test('sheets.dump dapat dibatasi ke nama sheet tertentu', () => {
  const reply = call('sheets.dump', { sheets: ['items'] }) as { data: { tables: object } };
  expect(Object.keys(reply.data.tables)).toEqual(['items']);
  expect(call('sheets.dump', { sheets: 'items' }).error).toBe('VALIDATION');
});

test('ekspor 1.200 baris dalam 3 potongan: header sekali, urutan terjaga', () => {
  const columns = ['id', 'nama'];
  const rows = Array.from({ length: 1200 }, (_, i) => [`id${i}`, `nama ${i}`]);
  const chunks = [rows.slice(0, 500), rows.slice(500, 1000), rows.slice(1000)];
  chunks.forEach((chunk, index) => {
    const reply = call('sheets.export', {
      sheet: 'export_items',
      columns,
      rows: chunk,
      mode: index === 0 ? 'replace' : 'append',
    });
    expect(reply).toEqual({ ok: true, data: { written: chunk.length } });
  });
  const written = platform.sheets.get('SS')?.get('export_items') as string[][];
  expect(written).toHaveLength(1201);
  expect(written[0]).toEqual(columns);
  expect(written.filter((row) => row[0] === 'id'.toString() && row[1] === 'nama')).toHaveLength(1);
  expect(written.slice(1)).toEqual(rows);
});

test('replace menimpa isi sebelumnya', () => {
  call('sheets.export', {
    sheet: 'export_a',
    columns: ['k'],
    rows: [['1'], ['2']],
    mode: 'replace',
  });
  call('sheets.export', { sheet: 'export_a', columns: ['k'], rows: [['9']], mode: 'replace' });
  expect(platform.sheets.get('SS')?.get('export_a')).toEqual([['k'], ['9']]);
});

test('ekspor tidak pernah menulis ke sheet sumber impor', () => {
  for (const sheet of [
    'brands',
    'items',
    'users',
    'Export_x',
    'export_',
    'export_UPPER',
    'export-x',
    '../x',
  ]) {
    const reply = call('sheets.export', { sheet, columns: ['id'], rows: [['1']], mode: 'replace' });
    expect(reply.error).toBe('VALIDATION');
  }
  expect(platform.effects).toEqual([]);
  expect(platform.sheets.get('SS')?.get('brands')).toEqual([
    ['id', 'name'],
    ['b1', 'Acme'],
  ]);
});

test('append ke sheet yang belum ada -> NOT_FOUND; baris tak sesuai kolom -> VALIDATION', () => {
  expect(
    call('sheets.export', { sheet: 'export_baru', columns: ['a'], rows: [['1']], mode: 'append' })
      .error,
  ).toBe('NOT_FOUND');
  expect(
    call('sheets.export', {
      sheet: 'export_baru',
      columns: ['a', 'b'],
      rows: [['1']],
      mode: 'replace',
    }).error,
  ).toBe('VALIDATION');
  expect(
    call('sheets.export', { sheet: 'export_baru', columns: ['a'], rows: [[1]], mode: 'replace' })
      .error,
  ).toBe('VALIDATION');
  expect(
    call('sheets.export', { sheet: 'export_baru', columns: ['a'], rows: [], mode: 'tambah' }).error,
  ).toBe('VALIDATION');
});

test('ekspor memakai EXPORT_SPREADSHEET_ID bila diisi', () => {
  platform.properties.set('EXPORT_SPREADSHEET_ID', 'EXP');
  call('sheets.export', { sheet: 'export_t', columns: ['a'], rows: [['1']], mode: 'replace' });
  expect(platform.sheets.get('EXP')?.get('export_t')).toEqual([['a'], ['1']]);
  expect(platform.sheets.get('SS')?.has('export_t')).toBe(false);
});
