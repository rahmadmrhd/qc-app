import type { AddCommentInput, HandoverDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { readOutboxRecords } from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueOutbox, readOutbox } from './outbox';
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
