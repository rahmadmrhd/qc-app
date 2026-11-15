import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { resetOutboxEnv } from '@/test/outbox-env';
import { enqueueOutbox, removeOutboxEntries } from './outbox';
import { beginSendingEntry } from './outbox-status';
import { usePendingCreates } from './use-pending-creates';

const OWNER = 'wh@x.id';
const create = (over: Record<string, unknown> = {}) => ({
  kind: 'create' as const,
  locationId: 'loc-a',
  tasks: [{ clientId: '11111111-1111-4111-8111-111111111111', customerName: 'PT A', note: 'x' }],
  at: Date.now(),
  ...over,
});

beforeEach(() => resetOutboxEnv());

test('tanpa entri: larik kosong identik antar render', () => {
  const { result, rerender } = renderHook(() => usePendingCreates(OWNER, ['loc-a']));
  const first = result.current;
  expect(first).toEqual([]);
  rerender();
  expect(result.current).toBe(first);
});

test('hanya task baru milik pemilik di lokasi yang dipilih dan belum kedaluwarsa; status mengikuti pengiriman', async () => {
  await enqueueOutbox(OWNER, create({ at: Date.now() - 25 * 3600_000 }));
  await enqueueOutbox(OWNER, create({ locationId: 'loc-b' }));
  await enqueueOutbox('lain@x.id', create());
  await enqueueOutbox(OWNER, {
    kind: 'comment',
    clientId: '33333333-3333-4333-8333-333333333333',
    taskId: 't',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'x',
    at: Date.now(),
  });
  const { result } = renderHook(() => usePendingCreates(OWNER, ['loc-a']));
  expect(result.current).toEqual([]);
  await act(async () => {
    await enqueueOutbox(OWNER, create());
  });
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toMatchObject({
    kind: 'create',
    locationId: 'loc-a',
    status: 'waiting',
  });
  const id = result.current[0]?.id ?? '';
  let end: () => void = () => undefined;
  act(() => {
    end = beginSendingEntry(id);
  });
  expect(result.current[0]?.status).toBe('sending');
  act(() => end());
  await act(async () => {
    await removeOutboxEntries(OWNER, [id]);
  });
  expect(result.current).toEqual([]);
});

test('owner kosong tidak membaca antrean', async () => {
  await enqueueOutbox(OWNER, create());
  const { result } = renderHook(() => usePendingCreates('', ['loc-a']));
  expect(result.current).toEqual([]);
});
