import type { AddCommentInput, HandoverDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { readOutboxRecords } from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueOutbox, readOutbox, resetOutboxForTests } from './outbox';
import { sendComment } from './send-comment';

const OWNER = 'qc@x.id';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const input = {
  owner: OWNER,
  id: 't1',
  locationId: 'loc-a',
  quote: 'kutipan',
  before: 'sebelum',
  after: 'sesudah',
  body: 'halo',
};
const err = (code: ConstructorParameters<typeof ApiError>[0], message = 'x') =>
  new ApiError(code, message, '-');

beforeEach(() => resetOutboxEnv());

test('online sukses: kembalikan DTO tanpa menulis antrean; clientId dibuat dan dikirim', async () => {
  const dto = makeHandover({ id: 't1' });
  const send = vi.fn(async (_input: AddCommentInput) => dto);
  const result = await sendComment(input, { send, newId: () => CLIENT });
  expect(result).toEqual({ queued: false, dto });
  expect(send).toHaveBeenCalledWith({
    id: 't1',
    locationId: 'loc-a',
    quote: 'kutipan',
    before: 'sebelum',
    after: 'sesudah',
    body: 'halo',
    clientId: CLIENT,
  });
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('UNAVAILABLE mengantre dengan clientId yang SAMA dengan percobaan pertama (timeout setelah server menyimpan: tak ganda)', async () => {
  const sent: Array<string | undefined> = [];
  const send = vi.fn(async (body: AddCommentInput): Promise<HandoverDto> => {
    sent.push(body.clientId);
    throw err('UNAVAILABLE');
  });
  const result = await sendComment(input, { send, newId: () => CLIENT, now: () => 1_234 });
  expect(result).toEqual({ queued: true });
  const [entry] = readOutbox(OWNER);
  expect(entry).toMatchObject({
    kind: 'comment',
    clientId: CLIENT,
    taskId: 't1',
    locationId: 'loc-a',
    quote: 'kutipan',
    before: 'sebelum',
    after: 'sesudah',
    body: 'halo',
    at: 1_234,
  });
  expect(sent).toEqual([CLIENT]);
  // Penguras mengirim ulang clientId yang sama: server mengembalikan DTO tanpa duplikat (diuji di sisi server).
  expect(entry && 'clientId' in entry ? entry.clientId : '').toBe(sent[0]);
});

test('antrean penuh / penulisan gagal melempar galat dan tidak mengantre; isi tidak dibuang dari komposer', async () => {
  const send = vi.fn().mockRejectedValue(err('UNAVAILABLE'));
  const enqueue = vi.fn().mockResolvedValueOnce('full').mockResolvedValueOnce('failed');
  await expect(sendComment(input, { send, enqueue })).rejects.toThrow(/penuh/);
  await expect(sendComment(input, { send, enqueue })).rejects.toBeInstanceOf(ApiError);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('antrean komentar nyata penuh (50): dilempar, tidak ada entri baru', async () => {
  for (let i = 0; i < 50; i++) {
    await enqueueOutbox(OWNER, {
      kind: 'comment',
      clientId: CLIENT,
      taskId: `t${i}`,
      locationId: 'loc-a',
      quote: '',
      before: '',
      after: '',
      body: 'x',
      at: Date.now(),
    });
  }
  const send = vi.fn().mockRejectedValue(err('UNAVAILABLE'));
  await expect(sendComment(input, { send })).rejects.toThrow(/penuh/);
  expect(readOutbox(OWNER)).toHaveLength(50);
});

test('galat selain UNAVAILABLE (VALIDATION, CONFLICT) tidak mengantre dan dilempar apa adanya', async () => {
  for (const code of ['VALIDATION', 'CONFLICT', 'FORBIDDEN'] as const) {
    const failure = err(code, 'ditolak');
    const send = vi.fn().mockRejectedValue(failure);
    await expect(sendComment(input, { send })).rejects.toBe(failure);
  }
  await expect(
    sendComment(input, { send: vi.fn().mockRejectedValue(new Error('aneh')) }),
  ).rejects.toThrow('aneh');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('clientId dibuat otomatis berbentuk UUID huruf kecil bila tidak disuntik', async () => {
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  await sendComment(input, { send });
  expect(send.mock.calls[0]?.[0].clientId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

const queuedComment = (taskId: string, clientId = '22222222-2222-4222-8222-222222222222') => ({
  kind: 'comment' as const,
  clientId,
  taskId,
  locationId: 'loc-a',
  quote: '',
  before: '',
  after: '',
  body: 'lebih dulu',
  at: Date.now() - 1_000,
});

test('A1: task yang masih punya entri antre: komentar baru ikut DIANTREKAN (tidak mendahului), penguras dipicu', async () => {
  await enqueueOutbox(OWNER, queuedComment('t1'));
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  const requestFlush = vi.fn();
  const result = await sendComment(input, { send, newId: () => CLIENT, requestFlush });
  expect(result).toEqual({ queued: true });
  expect(send).not.toHaveBeenCalled();
  const entries = readOutbox(OWNER);
  expect(entries.map((e) => e.kind)).toEqual(['comment', 'comment']);
  expect(entries[1]).toMatchObject({ clientId: CLIENT, taskId: 't1', body: 'halo' });
  expect(requestFlush).toHaveBeenCalledOnce();
});

test('A1: entri centang antre pada task yang sama juga menahan komentar online', async () => {
  await enqueueOutbox(OWNER, {
    kind: 'check',
    taskId: 't1',
    locationId: 'loc-a',
    index: 0,
    text: 'a',
    checked: true,
    at: Date.now() - 1_000,
  });
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  const result = await sendComment(input, { send, requestFlush: vi.fn() });
  expect(result).toEqual({ queued: true });
  expect(send).not.toHaveBeenCalled();
});

test('A1: antrean hanya milik task LAIN: komentar langsung dikirim online', async () => {
  await enqueueOutbox(OWNER, queuedComment('t2'));
  const dto = makeHandover({ id: 't1' });
  const send = vi.fn(async (_body: AddCommentInput) => dto);
  const result = await sendComment(input, { send, requestFlush: vi.fn() });
  expect(result).toEqual({ queued: false, dto });
  expect(send).toHaveBeenCalledOnce();
  expect(readOutbox(OWNER)).toHaveLength(1);
});

test('A1: salinan memori kosong (hidrasi gagal) tetapi toko berisi: disegarkan dari toko lalu diantrekan', async () => {
  await enqueueOutbox(OWNER, queuedComment('t1'));
  resetOutboxForTests();
  expect(readOutbox(OWNER)).toEqual([]);
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  const result = await sendComment(input, { send, newId: () => CLIENT, requestFlush: vi.fn() });
  expect(result).toEqual({ queued: true });
  expect(send).not.toHaveBeenCalled();
  expect(readOutbox(OWNER)).toHaveLength(2);
});

test('A1: toko tak terbaca (null) tidak menahan komentar: tetap dicoba online', async () => {
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  const result = await sendComment(input, {
    send,
    refresh: async () => null,
    requestFlush: vi.fn(),
  });
  expect(result.queued).toBe(false);
  expect(send).toHaveBeenCalledOnce();
});

test('A1: antrean task itu penuh (komentar baru ikut antre tetapi ditolak): dilempar, isi tak dibuang', async () => {
  for (let i = 0; i < 50; i++) await enqueueOutbox(OWNER, queuedComment('t1', CLIENT));
  const send = vi.fn(async (_body: AddCommentInput) => makeHandover());
  await expect(sendComment(input, { send, requestFlush: vi.fn() })).rejects.toThrow(/penuh/);
  expect(send).not.toHaveBeenCalled();
});
