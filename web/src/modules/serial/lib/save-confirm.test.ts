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
  test('menghitung serial, serial baru, label, dan rentang tanggal uji', () => {
    const summary = saveConfirmSummaryOf([
      row({ serial: 'A', testDate: '2026-11-03' }),
      row({ serial: 'B', testDate: '2026-11-01', existing: { id: 'x' } as never }),
      row({ serial: 'C', testDate: '2026-11-02', buLabel: 'BU B' }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.newCount).toBe(2);
    expect(summary.buLabels).toEqual(['BU A', 'BU B']);
    expect(summary.itemLabels).toEqual(['Item A']);
    expect(summary.locationLabels).toEqual(['Gudang']);
    expect(summary.testDateFrom).toBe('2026-11-01');
    expect(summary.testDateTo).toBe('2026-11-03');
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
