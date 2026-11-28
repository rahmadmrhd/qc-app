import { describe, expect, test } from 'vitest';
import type { StagingRow } from './draft';
import { formatCounted, saveConfirmSummaryOf } from './save-confirm';

const row = (over: Partial<StagingRow>): StagingRow =>
  ({
    clientId: 'c',
    serial: 'S',
    itemId: 'i1',
    itemLabel: 'Item A',
    buId: 'b1',
    buLabel: 'BU A',
    testDate: '2026-11-01',
    locationId: 'l1',
    locationLabel: 'Gudang',
    sample: false,
    note: '',
    capturedAt: '',
    source: 'manual',
    stickers: [],
    proofPhotos: [],
    selected: false,
    unresolved: [],
    ...over,
  }) as StagingRow;

describe('saveConfirmSummaryOf', () => {
  test('setiap nilai berbeda disertai jumlah serialnya', () => {
    const summary = saveConfirmSummaryOf([
      row({ serial: 'A', itemLabel: 'Alta AP6', testDate: '2026-11-03' }),
      row({
        serial: 'B',
        itemLabel: 'Alta AP6-Pro',
        testDate: '2026-11-03',
        existing: { id: 'x' } as never,
      }),
      row({ serial: 'C', itemLabel: 'Alta AP6', buLabel: 'BU B', testDate: '2026-11-01' }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.newCount).toBe(2);
    expect(summary.bu).toEqual([
      { label: 'BU A', count: 2 },
      { label: 'BU B', count: 1 },
    ]);
    expect(summary.item).toEqual([
      { label: 'Alta AP6', count: 2 },
      { label: 'Alta AP6-Pro', count: 1 },
    ]);
    expect(summary.testDate).toEqual([
      { label: '2026-11-01', count: 1 },
      { label: '2026-11-03', count: 2 },
    ]);
  });

  test('stiker: jenis dan qty dihitung; baris bawaan (null) dihitung terpisah', () => {
    const summary = saveConfirmSummaryOf([
      row({
        stickers: [
          { stickerId: 's1', name: 'A', qty: 2 },
          { stickerId: 's2', name: 'B', qty: 0 },
        ],
      }),
      row({ stickers: null }),
    ]);
    expect(summary.stickerKinds).toBe(1);
    expect(summary.stickerQty).toBe(2);
    expect(summary.stickerPending).toBe(1);
  });

  test('formatCounted: "nilai (n), nilai (n)"; kosong menjadi "-"', () => {
    expect(
      formatCounted([
        { label: 'Alta AP6', count: 1 },
        { label: 'Alta AP6-Pro', count: 1 },
      ]),
    ).toBe('Alta AP6 (1), Alta AP6-Pro (1)');
    expect(formatCounted([])).toBe('-');
  });
});
