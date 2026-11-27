import { expect, test } from 'vitest';
import { classifyScan, type ScanState } from './scan';
import { whSerial } from './test-support';

const base: ScanState = {
  itemId: 'item1',
  draftSerials: new Set(),
  draftCount: 0,
  filters: { buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20' },
  formBuId: 'bu1',
  referenceTestDate: '',
};

test('sudah ada, satu Tipe, Lolos dan QC: dipilih', () => {
  expect(classifyScan(base, whSerial(), 'SN1')).toEqual({ kind: 'select', warnings: [] });
});

test('Item masih kosong: dipilih (Item diisi pemanggil)', () => {
  expect(classifyScan({ ...base, itemId: '' }, whSerial(), 'SN1').kind).toBe('select');
});

test('Tipe beda tanpa pilihan: konfirmasi Ganti Item', () => {
  expect(classifyScan(base, whSerial({ itemId: 'item2' }), 'SN1').kind).toBe('confirm_switch_item');
});

test('Tipe beda dengan pilihan (Item terkunci): dialog error', () => {
  const state = { ...base, draftCount: 2, draftSerials: new Set(['A', 'B']) };
  expect(classifyScan(state, whSerial({ itemId: 'item2' }), 'SN1').kind).toBe('error_type');
});

test('tanggal uji beda dari serial lain yang dipilih: warning', () => {
  const state = { ...base, draftCount: 1, referenceTestDate: '2026-11-18' };
  expect(classifyScan(state, whSerial(), 'SN1').warnings).toEqual(['test_date_diff']);
});

test('BU saat ini beda dari BU form: warning', () => {
  expect(classifyScan(base, whSerial({ buId: 'bu2' }), 'SN1').warnings).toEqual(['bu_diff']);
});

test('pernah keluar di BU yang sama: warning; di BU lain: hanya info', () => {
  const ref = (buId: string) => ({
    orderId: 'o1',
    orderNumber: 'SO-1',
    buId,
    buCode: 'X',
    dispatchedOn: '2026-11-10',
  });
  expect(classifyScan(base, whSerial({ dispatches: [ref('bu1')] }), 'SN1').warnings).toEqual([
    'prior_same_bu',
  ]);
  expect(classifyScan(base, whSerial({ dispatches: [ref('bu2')] }), 'SN1').warnings).toEqual([
    'prior_other_bu',
  ]);
});

test('status bukan Lolos atau posisi bukan QC: tidak dapat dipilih', () => {
  expect(classifyScan(base, whSerial({ status: 'reported' }), 'SN1').kind).toBe('not_eligible');
  expect(classifyScan(base, whSerial({ custody: 'service' }), 'SN1').kind).toBe('not_eligible');
});

test('belum ada dengan isian lengkap: draf baru', () => {
  expect(classifyScan(base, null, 'SN9')).toEqual({ kind: 'new_draft', warnings: [] });
});

test('belum ada tanpa Item: ditahan dan menyebut Item', () => {
  const outcome = classifyScan({ ...base, itemId: '' }, null, 'SN9');
  expect(outcome.kind).toBe('missing_defaults');
  expect(outcome.missing).toContain('item');
});

test('belum ada tanpa BU, Lokasi, Tanggal uji: ditahan dan menyebut yang kurang', () => {
  const outcome = classifyScan(
    { ...base, filters: { buId: '', locationId: '', testDate: '' } },
    null,
    'SN9',
  );
  expect(outcome.missing).toEqual(['bu', 'location', 'testDate']);
});

test('sudah ada di pilihan sesi ini: diabaikan', () => {
  const state = { ...base, draftSerials: new Set(['SN1']), draftCount: 1 };
  expect(classifyScan(state, whSerial(), 'SN1').kind).toBe('duplicate_in_session');
  expect(classifyScan(state, null, 'SN1').kind).toBe('duplicate_in_session');
});
