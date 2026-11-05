import type { JobDto } from '@shared/rpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { RpcError } from '@/lib/rpc/rpc-error';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: rpcMock }));

import { awaitJob, jobPollDelay, useJob } from './queries';

const job = (status: JobDto['status'], extra: Partial<JobDto> = {}): JobDto => ({
  id: 'j1',
  kind: 'qr_export',
  status,
  progress: status === 'done' ? 100 : 10,
  ...extra,
});

beforeEach(() => {
  rpcMock.mockReset();
});

test('jeda polling bertahap 1 -> 2 -> 5 detik', () => {
  expect([0, 1, 2, 3, 10].map(jobPollDelay)).toEqual([1000, 2000, 5000, 5000, 5000]);
});

test('awaitJob mengulang jobs.get dengan jeda bertahap sampai done dan melaporkan kemajuan', async () => {
  rpcMock
    .mockResolvedValueOnce(job('queued'))
    .mockResolvedValueOnce(job('running'))
    .mockResolvedValueOnce(job('running'))
    .mockResolvedValueOnce(job('done'));
  const sleep = vi.fn(async (_ms: number) => undefined);
  const progress = vi.fn();
  await expect(awaitJob('j1', { sleep, onProgress: progress })).resolves.toMatchObject({
    status: 'done',
  });
  expect(rpcMock).toHaveBeenCalledWith('jobs.get', { id: 'j1' });
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 5000]);
  expect(progress).toHaveBeenCalledTimes(4);
});

test('job gagal dilempar sebagai RpcError dengan pesan server (dapat diulang oleh pemanggil)', async () => {
  rpcMock.mockResolvedValue(job('failed', { error: 'Jembatan Drive tidak menjawab' }));
  const error = await awaitJob('j1', { sleep: async () => undefined }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcError);
  expect((error as RpcError).message).toBe('Jembatan Drive tidak menjawab');
});

test('useJob berhenti polling setelah job selesai', async () => {
  rpcMock.mockResolvedValue(job('done'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender } = renderHook(({ id }) => useJob(id), {
    wrapper,
    initialProps: { id: null as string | null },
  });
  expect(rpcMock).not.toHaveBeenCalled();
  rerender({ id: 'j1' });
  await waitFor(() => expect(result.current.data?.status).toBe('done'));
  expect(rpcMock).toHaveBeenCalledTimes(1);
});
