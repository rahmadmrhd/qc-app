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
      {
        bu: 'BU A',
        item: 'Alta AP6',
        location: 'Gudang',
        testDate: '2026-11-03',
        stickers: [],
        count: 2,
      },
      {
        bu: 'BU A',
        item: 'Alta AP6-Pro',
        location: 'Gudang',
        testDate: '2026-11-03',
        stickers: [],
        count: 1,
      },
      {
        bu: 'BU B',
        item: 'Alta AP6',
        location: 'Gudang',
        testDate: '2026-11-01',
        stickers: [],
        count: 1,
      },
    ]);
  });

  test('stiker per kartu: daftar stiker dengan qty > 0; kelompok dipisah bila stikernya berbeda', () => {
    const summary = saveConfirmSummaryOf([
      row({
        stickers: [
          { stickerId: 's1', name: 'Stiker A', qty: 2 },
          { stickerId: 's2', name: 'Stiker B', qty: 0 },
        ],
      }),
      row({
        stickers: [
          { stickerId: 's1', name: 'Stiker A', qty: 2 },
          { stickerId: 's2', name: 'Stiker B', qty: 0 },
        ],
      }),
      row({ stickers: [] }),
    ]);
    expect(summary.groups).toEqual([
      {
        bu: 'BU A',
        item: 'Item A',
        location: 'Gudang',
        testDate: '2026-11-01',
        stickers: [{ name: 'Stiker A', qty: 2 }],
        count: 2,
      },
      {
        bu: 'BU A',
        item: 'Item A',
        location: 'Gudang',
        testDate: '2026-11-01',
        stickers: [],
        count: 1,
      },
    ]);
  });
});
