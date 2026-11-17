import { SERIAL_LIMITS } from '@shared/serials';
import { expect, test } from 'vitest';
import {
  addScanned,
  editRow,
  hasProblem,
  rowProblems,
  rowsToScan,
  SCAN_TABLE_LIMIT,
  type ScanRow,
} from './scan-table';

let counter = 0;
const newId = () => `r${++counter}`;
const never = () => false;
const row = (text: string, id = newId()): ScanRow => ({ id, text });

test('batas tabel mengikuti batas baris draft yang ada', () => {
  expect(SCAN_TABLE_LIMIT).toBe(SERIAL_LIMITS.tableRows);
});

test('serial baru ditambahkan di akhir, dipecah per baris dan dinormalkan', () => {
  const result = addScanned([row('AAA')], 'bbb\nccc', never, newId);
  expect(result.feedback).toBe('added');
  expect(result.rows.map((r) => r.text)).toEqual(['AAA', 'BBB', 'CCC']);
  expect(result.added).toEqual(result.rows.slice(1).map((r) => r.id));
});

test('serial yang sudah ada di tabel (bentuk ternormalisasi, termasuk MAC) tidak ditambahkan: duplicate', () => {
  const rows = [row('AABBCCDDEEFF')];
  const result = addScanned(rows, 'aa:bb:cc:dd:ee:ff', never, newId);
  expect(result.feedback).toBe('duplicate');
  expect(result.rows).toBe(rows);
  expect(result.added).toEqual([]);
});

test('serial yang sudah ada di draft (isKnown) tidak ditambahkan: duplicate; sebagian baru tetap masuk', () => {
  const known = (serial: string) => serial === 'DRAFT1';
  expect(addScanned([], 'draft1', known, newId).feedback).toBe('duplicate');
  const mixed = addScanned([], 'draft1\nbaru1', known, newId);
  expect(mixed.feedback).toBe('added');
  expect(mixed.rows.map((r) => r.text)).toEqual(['BARU1']);
});

test('tanpa serial sah (kosong, karakter kontrol, terlalu panjang): rejected', () => {
  expect(addScanned([], '   ', never, newId).feedback).toBe('rejected');
  expect(addScanned([], 'a\u0007b', never, newId).feedback).toBe('rejected');
  expect(addScanned([], 'x'.repeat(SERIAL_LIMITS.serialMax + 1), never, newId).feedback).toBe(
    'rejected',
  );
});

test('batas jumlah baris: yang masih muat masuk, sisanya ditolak (rejected); penuh = rejected', () => {
  const nearlyFull = Array.from({ length: SCAN_TABLE_LIMIT - 1 }, (_, i) => row(`S${i}`));
  const partial = addScanned(nearlyFull, 'baru1\nbaru2', never, newId);
  expect(partial.feedback).toBe('rejected');
  expect(partial.rows).toHaveLength(SCAN_TABLE_LIMIT);
  expect(partial.rows[SCAN_TABLE_LIMIT - 1]?.text).toBe('BARU1');
  const full = addScanned(partial.rows, 'lagi', never, newId);
  expect(full.feedback).toBe('rejected');
  expect(full.rows).toBe(partial.rows);
});

test('rowProblems: kosong, tidak valid, duplikat baris sebelumnya, sudah ada di draft, atau null', () => {
  const rows = [row('A1'), row('  '), row('a1'), row('K1'), row('x'.repeat(65)), row('a')];
  const known = (serial: string) => serial === 'K1';
  const problems = rowProblems(rows, known);
  expect(problems[0]).toBeNull();
  expect(problems[1]?.kind).toBe('empty');
  // Duplikat ditandai pada kemunculan KEDUA dan seterusnya (yang pertama tetap sah).
  expect(problems[2]?.kind).toBe('duplicate');
  expect(problems[3]?.kind).toBe('known');
  expect(problems[4]?.kind).toBe('invalid');
  expect(problems[5]?.kind).toBe('invalid');
  for (const problem of problems.slice(1)) expect(problem?.message).toBeTruthy();
  expect(hasProblem(rows, known)).toBe(true);
  expect(hasProblem([row('A1'), row('B2')], known)).toBe(false);
  expect(hasProblem([], known)).toBe(false);
});

test('editRow mengganti teks satu baris tanpa menyentuh baris lain', () => {
  const rows = [row('A', 'a'), row('B', 'b')];
  const next = editRow(rows, 'b', 'C');
  expect(next.map((r) => r.text)).toEqual(['A', 'C']);
  expect(next[0]).toBe(rows[0]);
});

test('rowsToScan: teks ternormalisasi menurut urutan tabel', () => {
  expect(rowsToScan([row(' a1 '), row('aa:bb:cc:dd:ee:ff')])).toEqual(['A1', 'AABBCCDDEEFF']);
});

test('maxRows=1: scan baru MENGGANTIKAN baris yang ada (bukan ditolak); serial sama = duplicate', () => {
  const rows = [row('AAA1', 'a')];
  const replaced = addScanned(rows, 'bbb2', never, newId, 1);
  expect(replaced.feedback).toBe('added');
  expect(replaced.rows.map((r) => r.text)).toEqual(['BBB2']);
  expect(replaced.added).toEqual([replaced.rows[0]?.id]);
  // Serial yang sama dengan baris yang ada tidak mengganti apa pun.
  const same = addScanned(rows, 'aaa1', never, newId, 1);
  expect(same.feedback).toBe('duplicate');
  expect(same.rows).toBe(rows);
  // Serial yang sudah ada di draft tetap ditolak sebagai duplicate dan baris lama dipertahankan.
  const known = addScanned(rows, 'draft1', (s) => s === 'DRAFT1', newId, 1);
  expect(known.feedback).toBe('duplicate');
  expect(known.rows).toBe(rows);
});

test('maxRows=1: payload banyak serial memakai yang pertama dan bernada rejected (sisanya diabaikan)', () => {
  const result = addScanned([], 'aaa1\nbbb2', never, newId, 1);
  expect(result.rows.map((r) => r.text)).toEqual(['AAA1']);
  expect(result.feedback).toBe('rejected');
});
