import { expect, test } from 'vitest';
import { type StampPreviewInput, stampPreviewLines } from './stamp-preview';

const BASE: StampPreviewInput = {
  serial: 'ABC123',
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'QC',
};

test('empat baris persis spek cap', () => {
  expect(stampPreviewLines(BASE)).toEqual([
    'SN: ABC123',
    'Cisco C9200',
    'BU1 · Surabaya',
    'Disimpan saat Simpan · Budi (QC)',
  ]);
});

test('lokasi kosong: baris 3 hanya BU, tanpa pemisah menggantung', () => {
  expect(stampPreviewLines({ ...BASE, locationLabel: '' })[2]).toBe('BU1');
});

test('label panjang tidak dipotong di sini (pemotongan oleh tampilan)', () => {
  const long = 'X'.repeat(200);
  expect(stampPreviewLines({ ...BASE, itemLabel: long })[1]).toBe(long);
});
