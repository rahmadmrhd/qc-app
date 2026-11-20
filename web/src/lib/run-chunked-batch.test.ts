import { expect, test, vi } from 'vitest';
import { ApiError } from './api/api-error';
import { batchSummary, runChunkedBatch } from './run-chunked-batch';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

test('250 id dikirim tiga tahap berurutan (100, 100, 50)', async () => {
  const sizes: number[] = [];
  const send = vi.fn(async (chunk: string[]) => {
    sizes.push(chunk.length);
    return chunk.map((id) => ({ id }));
  });
  const outcome = await runChunkedBatch(ids(250), send);
  expect(sizes).toEqual([100, 100, 50]);
  expect(outcome.doneIds).toHaveLength(250);
  expect(outcome.results).toHaveLength(250);
  expect(outcome.failedIds).toEqual([]);
  expect(batchSummary(outcome, 'dinonaktifkan')).toEqual({
    kind: 'success',
    message: '250 item dinonaktifkan',
  });
});

test('tahap kedua gagal: tahap ketiga tidak dikirim, tahap pertama tetap berlaku', async () => {
  const send = vi
    .fn<(chunk: string[]) => Promise<{ id: string }[]>>()
    .mockImplementationOnce(async (chunk) => chunk.map((id) => ({ id })))
    .mockRejectedValueOnce(new ApiError('CONFLICT', 'Data berubah', 'r1'));
  const outcome = await runChunkedBatch(ids(250), send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(outcome.doneIds).toHaveLength(100);
  expect(outcome.failedIds).toHaveLength(150);
  expect(outcome.notFound).toBe(false);
  const summary = batchSummary(outcome, 'dinonaktifkan');
  expect(summary.kind).toBe('partial');
  expect(summary.message).toBe('100 dari 250 berhasil; sisanya gagal: Data berubah');
});

test('galat NOT_FOUND menandai notFound', async () => {
  const send = vi.fn().mockRejectedValue(new ApiError('NOT_FOUND', 'Tidak ada', 'r2'));
  const outcome = await runChunkedBatch(ids(3), send);
  expect(outcome.notFound).toBe(true);
  expect(outcome.failedIds).toHaveLength(3);
  expect(batchSummary(outcome, 'dihapus').kind).toBe('error');
});

test('size dapat diubah', async () => {
  const send = vi.fn(async (chunk: string[]) => chunk);
  await runChunkedBatch(ids(5), send, { size: 2 });
  expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([2, 2, 1]);
});
