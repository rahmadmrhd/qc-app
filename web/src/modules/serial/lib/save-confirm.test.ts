import { describe, expect, test } from 'vitest';
import type { StagingRow } from './draft';
import { saveConfirmSummaryOf } from './save-confirm';

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
  test('satu kartu per kombinasi unik BU, Item, Lokasi, dan Tanggal uji, dengan jumlah serialnya', () => {
    const summary = saveConfirmSummaryOf([
      row({ serial: 'A', itemLabel: 'Alta AP6', testDate: '2026-11-03' }),
      row({ serial: 'B', itemLabel: 'Alta AP6', testDate: '2026-11-03' }),
      row({
        serial: 'C',
        itemLabel: 'Alta AP6-Pro',
        testDate: '2026-11-03',
        existing: { id: 'x' } as never,
      }),
      row({ serial: 'D', itemLabel: 'Alta AP6', buLabel: 'BU B', testDate: '2026-11-01' }),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.newCount).toBe(3);
    expect(summary.groups).toEqual([
      { bu: 'BU A', item: 'Alta AP6', location: 'Gudang', testDate: '2026-11-03', count: 2 },
      { bu: 'BU A', item: 'Alta AP6-Pro', location: 'Gudang', testDate: '2026-11-03', count: 1 },
      { bu: 'BU B', item: 'Alta AP6', location: 'Gudang', testDate: '2026-11-01', count: 1 },
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
});
