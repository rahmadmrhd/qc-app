import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueOutbox } from './outbox';

const mocks = vi.hoisted(() => ({ send: vi.fn(), info: vi.fn() }));
vi.mock('../queries', () => ({ useAddComment: () => ({ mutateAsync: mocks.send }) }));
vi.mock('sonner', () => ({ toast: { info: mocks.info, success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/outbox-sync', () => ({ requestOutboxFlush: vi.fn() }));

import { useSendComment } from './send-comment';

const OWNER = 'qc@x.id';
const input = {
  id: 't1',
  locationId: 'loc-a',
  quote: '',
  before: '',
  after: '',
  body: 'halo',
};

beforeEach(() => {
  resetOutboxEnv();
  mocks.send.mockReset();
  mocks.info.mockReset();
});

test('antre karena server tak terjangkau: toast menjanjikan "saat tersambung"', async () => {
  mocks.send.mockRejectedValue(new ApiError('UNAVAILABLE', 'x', '-'));
  const { result } = renderHook(() => useSendComment(OWNER));
  await result.current(input);
  expect(mocks.info).toHaveBeenCalledOnce();
  expect(mocks.info.mock.calls[0]?.[0]).toMatch(/saat tersambung/);
});

test('antre karena mengikuti entri task (perangkat online): toast netral tanpa janji "saat tersambung"', async () => {
  await enqueueOutbox(OWNER, {
    kind: 'comment',
    clientId: '22222222-2222-4222-8222-222222222222',
    taskId: 't1',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'lebih dulu',
    at: Date.now(),
  });
  mocks.send.mockResolvedValue(makeHandover());
  const { result } = renderHook(() => useSendComment(OWNER));
  await result.current(input);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledOnce();
  const text = String(mocks.info.mock.calls[0]?.[0]);
  expect(text).toMatch(/berurutan/);
  expect(text).not.toMatch(/tersambung/);
});

test('kirim online sukses: tanpa toast antrean', async () => {
  mocks.send.mockResolvedValue(makeHandover());
  const { result } = renderHook(() => useSendComment(OWNER));
  await result.current(input);
  expect(mocks.info).not.toHaveBeenCalled();
});
