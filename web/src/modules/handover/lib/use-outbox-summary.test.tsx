import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { resetOutboxEnv } from '@/test/outbox-env';
import { enqueueCheck } from './check-outbox';
import { enqueueOutbox, OUTBOX_MAX_AGE_MS, readOutbox, removeOutboxEntries } from './outbox';
import { beginSending, beginSendingEntry, resetSendingForTests } from './outbox-status';
import { useAllOutboxCount, useOutboxSummary } from './use-outbox-summary';

const OWNER = 'a@x.com';
const entry = (index: number, taskId = 'h1') => ({
  taskId,
  locationId: 'loc-a',
  index,
  text: `B${index}`,
  checked: true,
  at: Date.now(),
});

beforeEach(() => {
  resetOutboxEnv();
  resetSendingForTests();
});

test('tanpa entri: entries kosong dan sending 0', async () => {
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(0);
  expect(result.current.sending).toBe(0);
});

test('dengan dua entri dan satu sedang dikirim: sending 1', async () => {
  await enqueueCheck(OWNER, entry(0));
  await enqueueCheck(OWNER, entry(1));
  beginSending('h1', 1);
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(2);
  expect(result.current.sending).toBe(1);
});

test('butir sedang dikirim tanpa entri antrean tidak dihitung', async () => {
  await enqueueCheck(OWNER, entry(0));
  beginSending('h1', 5);
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.sending).toBe(0);
});

test('owner kosong: entries kosong', async () => {
  await enqueueCheck(OWNER, entry(0));
  const { result } = renderHook(() => useOutboxSummary(''));
  expect(result.current.entries).toHaveLength(0);
  expect(result.current.sending).toBe(0);
});

test('berubah saat antrean dan penanda kirim berubah', async () => {
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries).toHaveLength(0);
  await act(async () => {
    await enqueueCheck(OWNER, entry(0));
  });
  expect(result.current.entries).toHaveLength(1);
  let end: () => void = () => {};
  act(() => {
    end = beginSending('h1', 0);
  });
  expect(result.current.sending).toBe(1);
  act(() => end());
  expect(result.current.sending).toBe(0);
  await act(async () => {
    await removeOutboxEntries(
      OWNER,
      readOutbox(OWNER).map((e) => e.id),
    );
  });
  expect(result.current.entries).toHaveLength(0);
});

test('entri kedaluwarsa tidak masuk entries dan tidak dihitung sending', async () => {
  await enqueueCheck(OWNER, entry(0));
  await enqueueCheck(OWNER, { ...entry(1), at: Date.now() - OUTBOX_MAX_AGE_MS - 60_000 });
  beginSending('h1', 1);
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries.map((e) => (e.kind === 'check' ? e.index : -1))).toEqual([0]);
  expect(result.current.sending).toBe(0);
});

test('useAllOutboxCount: semua pemilik, tanpa kedaluwarsa, dan hidup mengikuti antrean', async () => {
  await enqueueCheck(OWNER, entry(0));
  await enqueueCheck('b@x.com', entry(0));
  await enqueueCheck('b@x.com', { ...entry(1), at: Date.now() - OUTBOX_MAX_AGE_MS - 60_000 });
  const { result } = renderHook(() => useAllOutboxCount());
  expect(result.current).toBe(2);
  await act(async () => {
    await enqueueCheck(OWNER, entry(2));
  });
  expect(result.current).toBe(3);
  await act(async () => {
    await removeOutboxEntries(
      OWNER,
      readOutbox(OWNER).map((e) => e.id),
    );
  });
  expect(result.current).toBe(1);
});

const commentIn = () => ({
  kind: 'comment' as const,
  clientId: '11111111-1111-4111-8111-111111111111',
  taskId: 'h1',
  locationId: 'loc-a',
  quote: '',
  before: '',
  after: '',
  body: 'halo',
  at: Date.now(),
});
const createIn = () => ({
  kind: 'create' as const,
  locationId: 'loc-a',
  tasks: [{ clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT A', note: 'x' }],
  at: Date.now(),
});

test('entries mencakup tiga jenis; sending per entri untuk komentar dan task baru', async () => {
  await enqueueCheck(OWNER, entry(0));
  await enqueueOutbox(OWNER, commentIn());
  await enqueueOutbox(OWNER, createIn());
  const { result } = renderHook(() => useOutboxSummary(OWNER));
  expect(result.current.entries.map((e) => e.kind).sort()).toEqual(['check', 'comment', 'create']);
  expect(result.current.sending).toBe(0);
  const commentId = result.current.entries.find((e) => e.kind === 'comment')?.id ?? '';
  const createId = result.current.entries.find((e) => e.kind === 'create')?.id ?? '';
  let endA: () => void = () => undefined;
  let endB: () => void = () => undefined;
  act(() => {
    endA = beginSendingEntry(commentId);
    endB = beginSendingEntry(createId);
  });
  expect(result.current.sending).toBe(2);
  act(() => endA());
  expect(result.current.sending).toBe(1);
  act(() => endB());
  expect(result.current.sending).toBe(0);
});

test('useAllOutboxCount menghitung semua jenis dan semua pemilik', async () => {
  await enqueueOutbox(OWNER, commentIn());
  await enqueueOutbox('b@x.com', createIn());
  await enqueueCheck('b@x.com', entry(0));
  const { result } = renderHook(() => useAllOutboxCount());
  expect(result.current).toBe(3);
});
