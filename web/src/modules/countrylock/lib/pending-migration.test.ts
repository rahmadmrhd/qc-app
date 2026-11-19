import type { PendingEntry } from '@countrylock/pending';
import { SERIAL_LIMITS } from '@shared/serials';
import { describe, expect, test } from 'vitest';
import { mergePending, pendingToRow } from './pending-migration';

const entry = (serial: string, extra: Partial<PendingEntry> = {}): PendingEntry => ({
  serial,
  brand: 'mikrotik',
  tipe: 'RB-750',
  date: '2026-11-17',
  timestamp: '2026-11-17T08:00:00.000Z',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
  itemId: 'item-1',
  clientId: `cid-${serial}-00000000`,
  ...extra,
});

let n = 0;
const newId = () => `new-${String(++n).padStart(8, '0')}`;

describe('pendingToRow', () => {
  test('entri lengkap: clientId lama dipakai ulang, tanggal dan waktu dari entri', () => {
    const row = pendingToRow(entry('ab12'), newId);
    expect(row).toMatchObject({
      clientId: 'cid-ab12-00000000',
      serial: 'AB12',
      itemId: 'item-1',
      itemLabel: 'RB-750',
      buId: 'bu-1',
      locationId: 'loc-1',
      testDate: '2026-11-17',
      capturedAt: '2026-11-17T08:00:00.000Z',
      source: 'countrylock',
      stickers: null,
    });
    expect(row).not.toHaveProperty('unresolved');
  });

  test('tanpa Tipe, lokasi, dan clientId: unresolved dan clientId baru', () => {
    const row = pendingToRow(
      entry('OLD1', {
        itemId: undefined,
        locationId: undefined,
        locationLabel: undefined,
        clientId: undefined,
      }),
      newId,
    );
    expect(row.unresolved).toEqual(['item', 'location']);
    expect(row.clientId).toMatch(/^new-/);
    expect(row.locationLabel).toBe('');
  });
});

describe('mergePending', () => {
  test('menambah entri baru dan menandainya absorbed', () => {
    const { rows, absorbed } = mergePending([], [entry('AA11'), entry('BB22')], newId);
    expect(rows.map((row) => row.serial)).toEqual(['AA11', 'BB22']);
    expect(absorbed).toHaveLength(2);
  });

  test('serial atau clientId yang sudah ada di draft tidak ditambah tetapi tetap absorbed', () => {
    const existing = pendingToRow(entry('AA11'), newId);
    const sameSerial = entry('aa11', { clientId: 'lain-0000000000' });
    const sameId = entry('ZZ99', { clientId: existing.clientId });
    const { rows, absorbed } = mergePending([existing], [sameSerial, sameId], newId);
    expect(rows).toHaveLength(1);
    expect(absorbed).toEqual([sameSerial, sameId]);
  });

  test('batas baris draft: yang tak muat tidak absorbed', () => {
    const full = Array.from({ length: SERIAL_LIMITS.tableRows }, (_, i) =>
      pendingToRow(entry(`S${i}`, { clientId: `cid-full-${i}-000000` }), newId),
    );
    const { rows, absorbed } = mergePending(full, [entry('EXTRA')], newId);
    expect(rows).toHaveLength(SERIAL_LIMITS.tableRows);
    expect(absorbed).toEqual([]);
  });
});
