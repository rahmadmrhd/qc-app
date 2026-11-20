import { afterEach, expect, test } from 'vitest';
import { addSerials, type StagingRow } from './draft';
import { loadDraft, resumeDraftWrites, saveDraft } from './draft-store';

function oneRow(): StagingRow {
  const [row] = addSerials(
    [],
    'S1',
    {
      itemId: 'i1',
      itemLabel: 'Item',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta',
      sample: false,
      note: '',
    },
    () => 'id-00000001',
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  return row as StagingRow;
}

afterEach(() => {
  resumeDraftWrites();
  localStorage.clear();
});

test('penanda Cek ulang (existing) tersimpan dan dipulihkan; draf lama tanpa field itu tetap terbaca', () => {
  const existing = {
    id: 'sn1',
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: 'b2',
    buCode: 'BU2',
    status: 'good' as const,
    hasOpenCase: false,
    recheckBuIds: ['b2', 'b3'],
    proofMin: 2,
  };
  saveDraft('a@x.com', [{ ...oneRow(), existing }]);
  expect(loadDraft('a@x.com')[0]?.existing).toEqual(existing);

  // Draf lama: tanpa kunci existing sama sekali.
  const plain = JSON.parse(localStorage.getItem('qc.serial.draft:a@x.com') ?? '[]');
  delete plain[0].existing;
  localStorage.setItem('qc.serial.draft:a@x.com', JSON.stringify(plain));
  const loaded = loadDraft('a@x.com');
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.existing).toBeUndefined();
});

test('existing yang rusak dibuang tetapi barisnya tetap dipulihkan', () => {
  const broken = {
    ...oneRow(),
    existing: { id: 'sn1', status: 'aneh', recheckBuIds: 'bukan-larik' },
  };
  localStorage.setItem('qc.serial.draft:a@x.com', JSON.stringify([broken]));
  const loaded = loadDraft('a@x.com');
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.existing).toBeUndefined();
});
