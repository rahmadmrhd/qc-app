import { expect, test } from 'vitest';
import { makeRow } from '../test-support';
import type { StagingExisting } from './draft';
import { findRescanWarnings, RESCAN_LIST_MAX } from './rescan';

function existing(over: Partial<StagingExisting> = {}): StagingExisting {
  return {
    id: 'sn1',
    itemId: 'i1',
    itemLabel: 'Cisco C9200',
    buId: 'b1',
    buCode: 'BU1',
    status: 'good',
    hasOpenCase: false,
    recheckBuIds: ['b1'],
    proofMin: 0,
    unitLocationId: 'l1',
    lastEventAt: '2026-11-25T03:00:00.000Z',
    lastActorName: 'Budi',
    ...over,
  };
}

test('BU dan lokasi sama = peringatan dengan pelaku dan waktu', () => {
  const rows = [makeRow('AB12', { existing: existing() })];
  expect(findRescanWarnings(rows)).toEqual([
    {
      clientId: rows[0]?.clientId,
      serial: 'AB12',
      actorName: 'Budi',
      at: '2026-11-25T03:00:00.000Z',
    },
  ]);
});

test('BU baris beda atau lokasi beda = tidak ada peringatan', () => {
  expect(findRescanWarnings([makeRow('A', { existing: existing(), buId: 'b2' })])).toEqual([]);
  expect(findRescanWarnings([makeRow('A', { existing: existing(), locationId: 'l2' })])).toEqual(
    [],
  );
});

test('field lokasi unit kosong atau baris biasa = tidak ada peringatan', () => {
  expect(
    findRescanWarnings([makeRow('A', { existing: existing({ unitLocationId: undefined }) })]),
  ).toEqual([]);
  expect(findRescanWarnings([makeRow('A')])).toEqual([]);
  expect(
    findRescanWarnings([makeRow('A', { existing: existing({ unitLocationId: '' }) })]),
  ).toEqual([]);
});

test('pelaku kosong menjadi Admin', () => {
  const [warning] = findRescanWarnings([
    makeRow('A', { existing: existing({ lastActorName: undefined, lastEventAt: undefined }) }),
  ]);
  expect(warning).toMatchObject({ serial: 'A', actorName: 'Admin', at: '' });
});

test('batas daftar dialog adalah 20', () => {
  expect(RESCAN_LIST_MAX).toBe(20);
});
