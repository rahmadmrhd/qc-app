import { expect, test } from 'bun:test';
import {
  customerKey,
  dateKeyOf,
  deriveHandoverStatus,
  HANDOVER_LIMITS,
  handoverNumber,
  nextHandoverSequence,
} from './handover';

test('deriveHandoverStatus: Baru, Dikerjakan, Selesai, Dibatalkan', () => {
  const p = (total: number, done: number, completed: boolean) => ({ total, done, completed });
  expect(deriveHandoverStatus('open', p(2, 0, false))).toBe('new');
  expect(deriveHandoverStatus('open', p(2, 1, false))).toBe('in_progress');
  expect(deriveHandoverStatus('open', p(2, 2, false))).toBe('done');
  expect(deriveHandoverStatus('open', p(0, 0, true))).toBe('done');
  expect(deriveHandoverStatus('open', p(0, 0, false))).toBe('new');
  expect(deriveHandoverStatus('cancelled', p(2, 2, true))).toBe('cancelled');
});

test('dateKeyOf memakai zona WIB (UTC+7): lewat tengah malam WIB sudah hari berikutnya', () => {
  expect(dateKeyOf(Date.parse('2026-10-15T16:59:59.000Z'))).toBe('20261015');
  expect(dateKeyOf(Date.parse('2026-10-15T17:00:00.000Z'))).toBe('20261016');
  expect(dateKeyOf(Date.parse('2026-12-31T20:00:00.000Z'))).toBe('20270101');
});

test('nomor task ST-YYYYMMDD-NNN dan urutan berikutnya per hari', () => {
  expect(handoverNumber('20261015', 1)).toBe('ST-20261015-001');
  expect(handoverNumber('20261015', 42)).toBe('ST-20261015-042');
  expect(handoverNumber('20261015', 1234)).toBe('ST-20261015-1234');
  expect(nextHandoverSequence([], '20261015')).toBe(1);
  expect(
    nextHandoverSequence(['ST-20261015-001', 'ST-20261015-007', 'ST-20261014-099'], '20261015'),
  ).toBe(8);
  expect(nextHandoverSequence(['ST-20261014-099', 'rusak', 'ST-20261015-abc'], '20261015')).toBe(1);
});

test('batas task', () => {
  expect(HANDOVER_LIMITS).toMatchObject({
    note: 5000,
    customerName: 100,
    comment: 1000,
    comments: 50,
    batch: 30,
    stateJson: 40000,
  });
});

test('customerKey: tanda baca DIBUANG (bukan jadi spasi), spasi dirapikan, huruf kecil (FC1)', () => {
  expect(customerKey('C.V. Abadi')).toBe('cv abadi');
  expect(customerKey('CV Abadi')).toBe('cv abadi');
  expect(customerKey('A.B.C')).toBe(customerKey('ABC'));
  expect(customerKey('  PT.  Maju   Jaya, ')).toBe('pt maju jaya');
  expect(customerKey('Tipe 7Å')).toBe('tipe 7å');
  expect(customerKey('--  . ')).toBe('');
  expect(customerKey('')).toBe('');
});

test('customerKey mempertahankan huruf non-Latin', () => {
  expect(customerKey('PT. 小米 Indonesia')).toBe('pt 小米 indonesia');
});
