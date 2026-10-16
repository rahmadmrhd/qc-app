import { expect, test } from 'bun:test';
import { editDistance, similarNames, suggestMatches } from './suggest';

interface Row {
  brand: string;
  model: string;
  aliases: string[];
}
const rows: Row[] = [
  { brand: 'Samsung', model: 'Galaxy S24', aliases: ['S24 Ultra'] },
  { brand: 'Ubiquiti', model: 'ES 24 250W', aliases: ['ES24'] },
  { brand: 'Mikrotik', model: 'hAP ac2', aliases: [] },
  { brand: 'Ubiquiti', model: 'AF 5XHD', aliases: ['AirFiber 5XHD'] },
];
const texts = (row: Row) => [row.brand, row.model, ...row.aliases];
const find = (query: string, limit?: number) =>
  suggestMatches(rows, query, texts, limit).map((row) => `${row.brand} ${row.model}`);

test('editDistance: sama, satu sisip/hapus/ganti, dan berhenti di batas', () => {
  expect(editDistance('samsung', 'samsung', 2)).toBe(0);
  expect(editDistance('samsng', 'samsung', 2)).toBe(1);
  expect(editDistance('samsunk', 'samsung', 2)).toBe(1);
  expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  expect(editDistance('a', 'abcdef', 2)).toBeGreaterThan(2);
});

test('urutan kata bebas dan tidak peka huruf besar atau tanda baca', () => {
  expect(find('galaxy samsung')).toEqual(['Samsung Galaxy S24']);
  expect(find('SAMSUNG, galaxy!')).toEqual(['Samsung Galaxy S24']);
});

test('typo ringan ditoleransi; token pendek tidak menghasilkan saran sampah', () => {
  expect(find('samsng')).toEqual(['Samsung Galaxy S24']);
  expect(find('mikrotk hap')).toEqual(['Mikrotik hAP ac2']);
  expect(find('xq')).toEqual([]);
  expect(find('zzzzzz')).toEqual([]);
});

test('"es24" menemukan "ES 24" (kata tanpa spasi), alias ikut dicocokkan, awalan kata cocok', () => {
  expect(find('es24')).toEqual(['Ubiquiti ES 24 250W']);
  expect(find('airfiber')).toEqual(['Ubiquiti AF 5XHD']);
  expect(find('ubi')).toEqual(['Ubiquiti ES 24 250W', 'Ubiquiti AF 5XHD']);
});

test('ketikan kosong atau hanya tanda baca tidak menghasilkan saran; limit dihormati; cocok tepat lebih dulu', () => {
  expect(find('')).toEqual([]);
  expect(find('  -- ')).toEqual([]);
  expect(find('ubi', 1)).toHaveLength(1);
  const typo = suggestMatches([{ n: 'Samsung' }, { n: 'Samsong Lama' }], 'samsung', (row) => [
    row.n,
  ]).map((row) => row.n);
  expect(typo[0]).toBe('Samsung');
});

test('similarNames: urutan kata berbeda atau typo = mirip; kunci sama persis dan nama jauh bukan', () => {
  const names = ['PT Maju Jaya', 'Budi Santoso', 'Totally Different'];
  expect(similarNames('Maju Jaya PT', names)).toEqual(['PT Maju Jaya']);
  expect(similarNames('PT Mju Jaya', names)).toEqual(['PT Maju Jaya']);
  expect(similarNames('PT. Maju Jaya', names)).toEqual([]); // kunci sama persis: bukan "mirip", itu orang yang sama
  expect(similarNames('Zzzz Qqqq', names)).toEqual([]);
  expect(similarNames('', names)).toEqual([]);
  expect(similarNames('Budi Santso', names, 1)).toEqual(['Budi Santoso']);
});
