import { beforeEach, expect, test } from 'vitest';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck, hasEntriesForTask, overlayPendingChecks } from './check-outbox';
import { enqueueOutbox, readOutbox } from './outbox';

// Fasad centang di atas antrean umum; inti antrean (batas, hidrasi, migrasi, siaran) diuji di `outbox.test.ts`.
const OWNER = 'a@x.com';

function entry(over: Partial<Parameters<typeof enqueueCheck>[1]> = {}) {
  return {
    taskId: 't1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
    at: 1_000,
    ...over,
  };
}

beforeEach(() => resetOutboxEnv());

test('enqueueCheck menandai jenis centang dan mengembalikan hasil penulisan', async () => {
  expect(await enqueueCheck(OWNER, entry({ index: 0 }))).toBe('ok');
  expect(await enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }))).toBe('ok');
  expect(readOutbox(OWNER).map((e) => e.kind)).toEqual(['check', 'check']);
});

test('gabung per task+indeks: nilai terakhir menang dan pindah ke akhir', async () => {
  await enqueueCheck(OWNER, entry({ index: 0, checked: true }));
  await enqueueCheck(OWNER, entry({ index: 1, text: 'B = 2' }));
  await enqueueCheck(OWNER, entry({ index: 0, checked: false, at: 2_000 }));
  const list = readOutbox(OWNER);
  expect(list.map((e) => (e.kind === 'check' ? [e.index, e.checked] : null))).toEqual([
    [1, true],
    [0, false],
  ]);
});

test('hasEntriesForTask: semua jenis entri, per pemilik', async () => {
  await enqueueCheck(OWNER, entry({ taskId: 't1' }));
  expect(hasEntriesForTask(OWNER, 't1')).toBe(true);
  expect(hasEntriesForTask(OWNER, 't2')).toBe(false);
  expect(hasEntriesForTask('b@x.com', 't1')).toBe(false);
  await enqueueOutbox(OWNER, {
    kind: 'comment',
    clientId: '11111111-1111-4111-8111-111111111111',
    taskId: 't2',
    locationId: 'loc-a',
    quote: '',
    before: '',
    after: '',
    body: 'halo',
    at: 1_000,
  });
  expect(hasEntriesForTask(OWNER, 't2')).toBe(true);
});

test('overlayPendingChecks: teks cocok mencentang butir; teks beda, task lain, atau jenis lain diabaikan', () => {
  const dto = makeHandover({ id: 'h1' });
  const base = { kind: 'check' as const, locationId: 'loc-a', checked: true, at: 1 };
  const entries = [
    { ...base, id: '1', taskId: 'h1', index: 0, text: 'A = 1' },
    { ...base, id: '2', taskId: 'h1', index: 1, text: 'sudah berubah' },
    { ...base, id: '3', taskId: 'lain', index: 1, text: 'B = 2' },
    {
      kind: 'comment' as const,
      id: '4',
      clientId: 'c',
      taskId: 'h1',
      locationId: 'loc-a',
      quote: '',
      before: '',
      after: '',
      body: 'x',
      at: 1,
    },
  ];
  const out = overlayPendingChecks(dto, entries, 'qc@x', '2026-11-13T00:00:00.000Z');
  expect(out.checklist[0]).toMatchObject({ checked: true, by: 'qc@x' });
  expect(out.checklist[1]?.checked).toBe(false);
  expect(overlayPendingChecks(dto, [], 'qc@x', 'x')).toBe(dto);
});
