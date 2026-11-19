import { expect, test } from 'vitest';
import { choicesFor } from './recheck-bu-field';

const BUS = [
  { id: 'b1', code: 'BU1' },
  { id: 'b2', code: 'BU2' },
];

test('choicesFor: label selalu kode BU; id yang kodenya tidak diketahui disembunyikan, bukan ditampilkan mentah', () => {
  expect(choicesFor(['b2', 'b-gaib', 'b1'], BUS)).toEqual([
    { id: 'b2', code: 'BU2' },
    { id: 'b1', code: 'BU1' },
  ]);
});

test('choicesFor: daftar BU belum termuat memakai fallback (BU saat ini) saja', () => {
  expect(choicesFor(['b2', 'b3'], null, [{ id: 'b2', code: 'BU2' }])).toEqual([
    { id: 'b2', code: 'BU2' },
  ]);
});
