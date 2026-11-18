import { describe, expect, test } from 'vitest';
import { todayWib } from '@/modules/serial/lib/locations';
import { buildInjectedRow, type InjectedRowInput } from './injected-row';

const input: InjectedRowInput = {
  serial: 'ab12',
  itemId: 'item-1',
  itemLabel: 'RB-750',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
};
const now = new Date('2026-11-18T08:00:00.000Z');
const ctx = { clientId: '3f2b8c1e-5a4d-4e6f-9a1b-0c2d3e4f5a6b', now };

describe('buildInjectedRow', () => {
  test('baris countrylock lengkap: serial dinormalisasi, tanggal uji WIB, stiker belum dimuat', () => {
    const row = buildInjectedRow(input, ctx);
    expect(row).toMatchObject({
      clientId: ctx.clientId,
      serial: 'AB12',
      itemId: 'item-1',
      itemLabel: 'RB-750',
      buId: 'bu-1',
      buLabel: 'DEF - BU',
      locationId: 'loc-1',
      locationLabel: 'QC-A - QC',
      testDate: todayWib(now.getTime()),
      capturedAt: '2026-11-18T08:00:00.000Z',
      sample: false,
      note: '',
      source: 'countrylock',
      stickers: null,
      proofPhotos: [],
      selected: false,
    });
    expect(row).not.toHaveProperty('result');
    expect(row).not.toHaveProperty('unresolved');
  });

  test('MAC dengan pemisah menjadi heksadesimal polos (bentuk web)', () => {
    expect(buildInjectedRow({ ...input, serial: 'aa:bb:cc:dd:ee:ff' }, ctx).serial).toBe(
      'AABBCCDDEEFF',
    );
  });

  test('serial tak sah tetap menjadi baris bermasalah (tidak hilang)', () => {
    const empty = buildInjectedRow({ ...input, serial: '   ' }, ctx);
    expect(empty).toMatchObject({ result: 'invalid', message: 'Serial tidak boleh kosong' });
    const control = buildInjectedRow({ ...input, serial: 'AB\u0007CD' }, ctx);
    expect(control).toMatchObject({ result: 'invalid', message: 'Serial tidak sah' });
  });

  test('item atau lokasi kosong ditandai unresolved', () => {
    expect(buildInjectedRow({ ...input, itemId: '' }, ctx).unresolved).toEqual(['item']);
    expect(buildInjectedRow({ ...input, locationId: '' }, ctx).unresolved).toEqual(['location']);
    expect(buildInjectedRow({ ...input, itemId: '', locationId: '' }, ctx).unresolved).toEqual([
      'item',
      'location',
    ]);
  });
});
