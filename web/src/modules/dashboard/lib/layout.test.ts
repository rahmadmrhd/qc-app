import { WIDGETS } from '@shared/dashboard';
import { describe, expect, test } from 'vitest';
import { cellClass, rowsOf } from './layout';

const group = (id: string) => WIDGETS.filter((meta) => meta.group === id);

describe('rowsOf', () => {
  test('widget berurutan dengan row sama satu baris; urutan registri dipertahankan', () => {
    const rows = rowsOf(group('handover'));
    expect(rows.flat().map((meta) => meta.id)).toEqual(group('handover').map((meta) => meta.id));
    // Number card dikelompokkan di baris paling atas, satu baris (task dibuat, aktif, rata-rata penyelesaian).
    expect(rows[0]?.every((meta) => meta.visual === 'number')).toBe(true);
    expect(rows[0]?.map((meta) => meta.id)).toContain('hs.avgDuration');
  });

  test('tiap baris hanya satu jenis tampilan, kecuali baris split Laporan rusak', () => {
    for (const id of ['handover', 'serial', 'report', 'sticker']) {
      for (const row of rowsOf(group(id))) {
        const numbers = row.filter((meta) => meta.visual === 'number').length;
        expect([id, row[0]?.row, numbers === 0 || numbers === row.length]).toEqual([
          id,
          row[0]?.row,
          true,
        ]);
      }
    }
    const split = rowsOf(group('report')).find((row) => row[0]?.row === 'split');
    expect(split?.map((meta) => meta.id)).toEqual(['rp.result', 'rp.oldest']);
    expect(split?.map((meta) => meta.span)).toEqual([5, 7]);
  });

  test('daftar kosong = tanpa baris', () => {
    expect(rowsOf([])).toEqual([]);
  });
});

describe('cellClass', () => {
  test('number card: satu kolom di ponsel (ganjil terakhir selebar dua), menurut span di >= 768 px', () => {
    const meta = WIDGETS.find((entry) => entry.id === 'hs.created');
    expect(cellClass(meta as NonNullable<typeof meta>)).toContain('md:col-span-4');
    expect(cellClass(meta as NonNullable<typeof meta>)).toContain('col-span-1');
  });

  test('kartu lain: selebar dua kolom di ponsel; Hasil penutupan 5 dan Laporan terlama 7 berdampingan di layar lebar', () => {
    const result = WIDGETS.find((entry) => entry.id === 'rp.result');
    const oldest = WIDGETS.find((entry) => entry.id === 'rp.oldest');
    expect(cellClass(result as NonNullable<typeof result>)).toContain('xl:col-span-5');
    expect(cellClass(oldest as NonNullable<typeof oldest>)).toContain('xl:col-span-7');
    expect(cellClass(result as NonNullable<typeof result>)).toContain('col-span-2');
  });
});
