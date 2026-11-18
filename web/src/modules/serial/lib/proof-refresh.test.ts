import { expect, test, vi } from 'vitest';
import { makeRow } from '../test-support';
import { applyProofMins, fetchProofMins, uniqueItemIds } from './proof-refresh';

test('uniqueItemIds: satu id per item, melewati yang kosong atau tak dapat ditanyakan', () => {
  const rows = [
    makeRow('A1'),
    makeRow('A2'),
    makeRow('A3', { itemId: 'i2' }),
    makeRow('A4', { itemId: '' }),
    makeRow('A5', { itemId: 'a,b' }),
  ];
  expect(uniqueItemIds(rows)).toEqual(['i1', 'i2']);
});

test('fetchProofMins: satu permintaan per 50 id unik; pecahan gagal dilewati', async () => {
  const ids = Array.from({ length: 120 }, (_, index) => `item${index}`);
  const find = vi.fn(async (chunk: readonly string[]) => {
    if (chunk[0] === 'item50') throw new Error('putus');
    return chunk.map((id) => ({ id, label: id, buOptions: [], proofMin: 2 }));
  });
  const mins = await fetchProofMins(ids, find);
  expect(find).toHaveBeenCalledTimes(3);
  expect(find.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 20]);
  expect(mins.get('item0')).toBe(2);
  expect(mins.has('item50')).toBe(false);
  expect(mins.get('item119')).toBe(2);
});

test('fetchProofMins: tanpa proofMin = 0 (tidak wajib)', async () => {
  const mins = await fetchProofMins(['i1'], async () => [{ id: 'i1', label: 'x', buOptions: [] }]);
  expect(mins.get('i1')).toBe(0);
});

test('applyProofMins: baris tanpa proofMin mendapat minimum item yang wajib foto', () => {
  const rows = [makeRow('A1', { itemId: 'i3' }), makeRow('A2')];
  const next = applyProofMins(rows, new Map([['i3', 3]]));
  expect(next[0]?.proofMin).toBe(3);
  expect(next[1]).toBe(rows[1]);
});

test('applyProofMins: nilai yang sudah diketahui tidak ditimpa kecuali item kini tak wajib', () => {
  const known = makeRow('A1', { itemId: 'i3', proofMin: 3 });
  expect(applyProofMins([known], new Map([['i3', 2]]))[0]?.proofMin).toBe(3);
  const cleared = applyProofMins([known], new Map([['i3', 0]]))[0];
  expect(cleared).toBeDefined();
  expect(cleared && 'proofMin' in cleared).toBe(false);
});

test('applyProofMins: tanpa perubahan mengembalikan larik yang sama; hasil dan foto baris tidak disentuh', () => {
  const rows = [makeRow('A1'), makeRow('A2', { itemId: 'i3', proofMin: 3 })];
  expect(applyProofMins(rows, new Map([['i1', 0]]))).toBe(rows);
  expect(applyProofMins(rows, new Map())).toBe(rows);
  const failed = makeRow('A3', { itemId: 'i3', result: 'invalid', message: 'x' });
  const [out] = applyProofMins([failed], new Map([['i3', 2]]));
  expect(out).toMatchObject({ result: 'invalid', message: 'x', proofMin: 2 });
});
