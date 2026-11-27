import type { SerialExistingDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  addSerials,
  applyBulk,
  applyLookup,
  applyLookupCounted,
  type Defaults,
  existingBuProblem,
  existingProblem,
  isExistingBlocked,
  lookupKeyOf,
  rowsToLookup,
  type StagingRow,
  toRowInput,
} from './draft';

// Cek ulang: serial yang sudah tercatat (keunikan se-sistem).

const defaults: Defaults = {
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  buId: 'b1',
  buLabel: 'BU1',
  testDate: '2026-11-12',
  locationId: 'l1',
  locationLabel: 'Jakarta',
  sample: false,
  note: '',
};

function seed(texts: string[]): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    texts.join('\n'),
    defaults,
    () => `id-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
}

function dto(over: Partial<SerialExistingDto> = {}): SerialExistingDto {
  return {
    serial: 'AAA111',
    id: 'sn1',
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: 'b2',
    buCode: 'BU2',
    status: 'good',
    hasOpenCase: false,
    proofRequired: false,
    proofMin: 0,
    recheckBuIds: ['b2', 'b3'],
    ...over,
  };
}

test('applyLookup: serial yang sudah ada menjadi baris Cek ulang (item dikunci, BU saat ini, stiker kosong)', () => {
  const rows = seed(['AAA111', 'BBB222']).map((row) => ({ ...row, sample: true, note: 'catatan' }));
  const next = applyLookup(rows, new Set(['AAA111', 'BBB222']), [dto()]);
  expect(next[0]).toMatchObject({
    serial: 'AAA111',
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: 'b2',
    buLabel: 'BU2',
    sample: false,
    stickers: [],
    note: 'catatan',
    testDate: '2026-11-12',
    existing: {
      id: 'sn1',
      buId: 'b2',
      buCode: 'BU2',
      status: 'good',
      hasOpenCase: false,
      recheckBuIds: ['b2', 'b3'],
      proofMin: 0,
    },
  });
  expect(next[0]?.proofMin).toBeUndefined();
  // Baris yang serialnya belum ada tidak berubah.
  expect(next[1]).toBe(rows[1]);
});

test('applyLookup: BU saat ini di luar hak = BU kosong; minimum foto mengikuti item catatan; hasil lama dibuang', () => {
  const [row] = seed(['AAA111']);
  const marked: StagingRow = {
    ...(row as StagingRow),
    result: 'invalid',
    message: 'x',
    unresolved: ['item', 'stickers', 'location'],
  };
  const [next] = applyLookup([marked], new Set(['AAA111']), [
    dto({ recheckBuIds: ['b3'], proofRequired: true, proofMin: 2 }),
  ]);
  expect(next).toMatchObject({ buId: '', buLabel: '', proofMin: 2, unresolved: ['location'] });
  expect(next?.result).toBeUndefined();
  expect(next?.message).toBeUndefined();
});

test('applyLookup: penyegaran mempertahankan BU yang masih sah dan stiker; larik sama bila tak berubah', () => {
  const [row] = seed(['AAA111']);
  const first = applyLookup([row as StagingRow], new Set(['AAA111']), [dto()]);
  const picked = first.map((entry) => ({
    ...entry,
    buId: 'b3',
    buLabel: 'BU3',
    stickers: [{ stickerId: 's1', name: 'A', qty: 1 }],
  }));
  expect(applyLookup(picked, new Set(['AAA111']), [dto()])).toBe(picked);
  const [refreshed] = applyLookup(picked, new Set(['AAA111']), [dto({ hasOpenCase: true })]);
  expect(refreshed).toMatchObject({
    buId: 'b3',
    stickers: [{ stickerId: 's1', name: 'A', qty: 1 }],
    existing: { hasOpenCase: true },
  });
  // BU pilihan tak lagi sah: kembali ke BU saat ini.
  const [reset] = applyLookup(picked, new Set(['AAA111']), [dto({ recheckBuIds: ['b2'] })]);
  expect(reset).toMatchObject({ buId: 'b2', buLabel: 'BU2' });
});

test('applyLookup: serial yang tak ada lagi membuang penanda Cek ulang; serial tak ditanyakan diabaikan', () => {
  const [row] = seed(['AAA111']);
  const [marked] = applyLookup([row as StagingRow], new Set(['AAA111']), [dto()]);
  const [cleared] = applyLookup([marked as StagingRow], new Set(['AAA111']), []);
  expect(cleared?.existing).toBeUndefined();
  // Kembali jadi baris biasa: stiker ke bawaan (semua yang berlaku).
  expect(cleared?.stickers).toBeNull();
  const rows = [marked as StagingRow];
  expect(applyLookup(rows, new Set(['LAIN']), [])).toBe(rows);
});

test('existingProblem/existingBuProblem/isExistingBlocked: laporan aktif, Rusak, dan BU yang tak sah', () => {
  const [base] = seed(['AAA111']);
  const mk = (over: Partial<SerialExistingDto>) =>
    applyLookup([base as StagingRow], new Set(['AAA111']), [dto(over)])[0] as StagingRow;
  expect(existingProblem(mk({ hasOpenCase: true }))).toBe(
    'Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya.',
  );
  expect(existingProblem(mk({ status: 'broken' }))).toBe('Unit ini sudah dinyatakan rusak.');
  expect(existingProblem(mk({}))).toBeNull();
  expect(isExistingBlocked(mk({}))).toBe(false);
  expect(isExistingBlocked(mk({ hasOpenCase: true }))).toBe(true);
  expect(existingBuProblem(mk({ recheckBuIds: [] }))).toMatch(/belum punya akses/);
  expect(isExistingBlocked(mk({ recheckBuIds: [] }))).toBe(true);
  const odd = { ...mk({}), buId: 'b9', buLabel: 'BU9' };
  expect(existingBuProblem(odd)).toMatch(/tidak bisa dipakai/);
  expect(existingProblem(base as StagingRow)).toBeNull();
  expect(isExistingBlocked(base as StagingRow)).toBe(false);
});

test('applyBulk: baris Cek ulang mengabaikan item dan Sample; ganti BU mengosongkan stiker menjadi [] (bukan null)', () => {
  const rows = applyLookup(seed(['AAA111', 'BBB222']), new Set(['AAA111']), [dto()]);
  const ids = new Set(rows.map((row) => row.clientId));
  const next = applyBulk(rows, ids, {
    itemId: 'i1',
    itemLabel: 'Item Bulk',
    proofMin: 3,
    sample: true,
    buId: 'b3',
    buLabel: 'BU3',
  });
  expect(next[0]).toMatchObject({
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    sample: false,
    buId: 'b3',
    stickers: [],
  });
  expect(next[1]).toMatchObject({
    itemId: 'i1',
    itemLabel: 'Item Bulk',
    sample: true,
    buId: 'b3',
    stickers: null,
  });
});

test('toRowInput: baris Cek ulang mengirim stiker kosong dan BU target', () => {
  const [row] = applyLookup(seed(['AAA111']), new Set(['AAA111']), [dto()]);
  expect(toRowInput(row as StagingRow)).toMatchObject({
    serial: 'AAA111',
    itemId: 'i9',
    buId: 'b2',
    sample: false,
    stickers: [],
  });
});

test('rowsToLookup: baris baru atau serial yang diganti ditanyakan; pasangan yang sudah ditanyakan tidak', () => {
  const rows = seed(['AAA111', 'BBB222']);
  const done = new Set([lookupKeyOf(rows[0] as StagingRow)]);
  expect(rowsToLookup(rows, done).map((row) => row.serial)).toEqual(['BBB222']);
  const edited = [{ ...(rows[0] as StagingRow), serial: 'CCC333' }, rows[1] as StagingRow];
  expect(rowsToLookup(edited, done).map((row) => row.serial)).toEqual(['CCC333', 'BBB222']);
});

test('applyLookupCounted: hanya metadata peringatan berubah = disegarkan tanpa dihitung berubah', () => {
  const [row] = seed(['AAA111']);
  const meta = {
    unitLocationId: 'l1',
    lastEventAt: '2026-11-25T03:00:00.000Z',
    lastActorName: 'Budi',
  };
  const first = applyLookupCounted([row as StagingRow], new Set(['AAA111']), [dto(meta)]);
  expect(first.changed).toBe(1);
  const fresh = {
    unitLocationId: 'l2',
    lastEventAt: '2026-11-26T03:00:00.000Z',
    lastActorName: 'Sari',
  };
  const second = applyLookupCounted(first.rows, new Set(['AAA111']), [dto(fresh)]);
  expect(second.changed).toBe(0);
  expect(second.rows).not.toBe(first.rows);
  expect(second.rows[0]?.existing).toMatchObject(fresh);
  expect(second.rows[0]).toMatchObject({ itemId: 'i9', buId: 'b2', stickers: [] });
  // Metadata sama persis = larik yang sama.
  expect(applyLookupCounted(second.rows, new Set(['AAA111']), [dto(fresh)]).rows).toBe(second.rows);
  // Perubahan struktural tetap dihitung.
  const third = applyLookupCounted(second.rows, new Set(['AAA111']), [
    dto({ ...fresh, status: 'broken' }),
  ]);
  expect(third.changed).toBe(1);
});
