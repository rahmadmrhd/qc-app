import { expect, test } from 'vitest';
import {
  buildBatchInput,
  type EntryRow,
  emptyEntryRow,
  newEntryClientId,
  rowError,
  rowPieces,
  rowWarning,
  summarize,
} from './entry-rows';

function counted(sheets: number, perSheet: number, loose = 0): EntryRow {
  return { count: { rows: [{ sheets, perSheet }], loose }, delta: '' };
}

test('rowPieces: masuk/keluar = lembar x isi + butir; koreksi = selisih bertanda, kosong/bukan bulat = null', () => {
  expect(rowPieces('in', counted(2, 50, 3))).toBe(103);
  expect(rowPieces('out', emptyEntryRow())).toBe(0);
  expect(rowPieces('adjust', { ...emptyEntryRow(), delta: ' -5 ' })).toBe(-5);
  expect(rowPieces('adjust', { ...emptyEntryRow(), delta: '' })).toBeNull();
  expect(rowPieces('adjust', { ...emptyEntryRow(), delta: '1.5' })).toBeNull();
});

test('rowError masuk/keluar: minimal 1 butir dan maksimal qtyMax', () => {
  expect(rowError('in', emptyEntryRow())).toBe('Hitungan minimal 1 butir');
  expect(rowError('in', counted(1, 10))).toBeNull();
  expect(rowError('out', counted(1000, 5000))).toBe('Jumlah butir maksimal 1000000');
});

test('rowError koreksi: wajib, bukan 0, bilangan bulat, batas mutlak qtyMax (boleh negatif)', () => {
  const row = (delta: string): EntryRow => ({ ...emptyEntryRow(), delta });
  expect(rowError('adjust', row(''))).toBe('Perubahan wajib diisi (bukan 0)');
  expect(rowError('adjust', row('0'))).toBe('Perubahan wajib diisi (bukan 0)');
  expect(rowError('adjust', row('2.5'))).toBe('Perubahan harus bilangan bulat');
  expect(rowError('adjust', row('-1000001'))).toBe('Perubahan maksimal 1000000 (boleh negatif)');
  expect(rowError('adjust', row('-5'))).toBeNull();
  expect(rowError('adjust', row('10'))).toBeNull();
});

test('rowWarning: hanya mode keluar yang melebihi stok tercatat; bukan galat', () => {
  expect(rowWarning('out', counted(1, 10), 5)).toBe('Melebihi stok tercatat (5 butir)');
  expect(rowWarning('out', counted(1, 10), 10)).toBeNull();
  expect(rowWarning('in', counted(1, 10), 0)).toBeNull();
  expect(rowWarning('adjust', { ...emptyEntryRow(), delta: '-50' }, 0)).toBeNull();
});

test('summarize: jumlah stiker dan total butir; koreksi menjumlah selisih bertanda', () => {
  expect(summarize('in', [counted(1, 10), counted(0, 0, 4)])).toEqual({ stickers: 2, total: 14 });
  const rows: EntryRow[] = [
    { ...emptyEntryRow(), delta: '10' },
    { ...emptyEntryRow(), delta: '-4' },
    { ...emptyEntryRow(), delta: '' },
  ];
  expect(summarize('adjust', rows)).toEqual({ stickers: 3, total: 6 });
});

test('buildBatchInput masuk/keluar: kind, alasan dipangkas, hitungan dibersihkan dari baris kosong', () => {
  const input = buildBatchInput('out', 'l-a', '  rusak  ', [
    {
      stickerId: 's1',
      row: {
        count: {
          rows: [
            { sheets: 2, perSheet: 10 },
            { sheets: 0, perSheet: 5 },
          ],
          loose: 3,
        },
        delta: '',
      },
    },
  ]);
  expect(input).toEqual({
    kind: 'out',
    reason: 'rusak',
    rows: [
      {
        stickerId: 's1',
        locationId: 'l-a',
        count: { rows: [{ sheets: 2, perSheet: 10 }], loose: 3 },
      },
    ],
  });
});

test('buildBatchInput koreksi: tanpa kind, delta menjadi angka', () => {
  const input = buildBatchInput('adjust', 'l-a', 'selisih opname', [
    { stickerId: 's1', row: { ...emptyEntryRow(), delta: ' -7 ' } },
    { stickerId: 's2', row: { ...emptyEntryRow(), delta: '12' } },
  ]);
  expect(input).toEqual({
    reason: 'selisih opname',
    rows: [
      { stickerId: 's1', locationId: 'l-a', delta: -7 },
      { stickerId: 's2', locationId: 'l-a', delta: 12 },
    ],
  });
  expect('kind' in input).toBe(false);
});

test('buildBatchInput menyertakan clientId per baris bila ada (K1) dan tidak menambah kunci bila tak ada', () => {
  const withId = buildBatchInput('adjust', 'l-a', 'opname', [
    { stickerId: 's1', row: { ...emptyEntryRow(), delta: '2' }, clientId: 'c-1' },
    { stickerId: 's2', row: { ...emptyEntryRow(), delta: '-1' } },
  ]);
  expect(withId.rows[0]).toMatchObject({ clientId: 'c-1' });
  expect('clientId' in (withId.rows[1] ?? {})).toBe(false);
});

test('newEntryClientId: UUID v4 huruf kecil, unik', () => {
  const a = newEntryClientId();
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(newEntryClientId()).not.toBe(a);
});
