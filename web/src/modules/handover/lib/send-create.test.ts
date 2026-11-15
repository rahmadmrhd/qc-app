import type { HandoverDto, SaveHandoverBatchInput } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { readOutboxRecords } from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueOutbox, readOutbox } from './outbox';
import { sendCreate } from './send-create';

const OWNER = 'wh@x.id';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const input = {
  owner: OWNER,
  locationId: 'loc-a',
  tasks: [
    { customerName: 'PT A', note: 'catatan A' },
    { customerName: 'PT B', note: 'catatan B' },
  ],
};
const err = (code: ConstructorParameters<typeof ApiError>[0], message = 'x') =>
  new ApiError(code, message, '-');
const ids = () => {
  const queue = [ID_A, ID_B];
  return () => queue.shift() ?? 'habis';
};

beforeEach(() => resetOutboxEnv());

test('online sukses: kembalikan DTO tanpa antrean; clientId per task dikirim', async () => {
  const dtos = [makeHandover({ id: 'n1' }), makeHandover({ id: 'n2' })];
  const send = vi.fn(async (_input: SaveHandoverBatchInput) => dtos);
  const result = await sendCreate(input, { send, newId: ids() });
  expect(result).toEqual({ queued: false, dtos });
  expect(send).toHaveBeenCalledWith({
    locationId: 'loc-a',
    tasks: [
      { customerName: 'PT A', note: 'catatan A', clientId: ID_A },
      { customerName: 'PT B', note: 'catatan B', clientId: ID_B },
    ],
  });
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('UNAVAILABLE mengantre clientId per task yang SAMA dengan percobaan pertama (urutan task dipertahankan)', async () => {
  const sent: SaveHandoverBatchInput[] = [];
  const send = vi.fn(async (body: SaveHandoverBatchInput): Promise<HandoverDto[]> => {
    sent.push(body);
    throw err('UNAVAILABLE');
  });
  const result = await sendCreate(input, { send, newId: ids(), now: () => 4_321 });
  expect(result).toEqual({ queued: true });
  const [entry] = readOutbox(OWNER);
  expect(entry).toMatchObject({
    kind: 'create',
    locationId: 'loc-a',
    at: 4_321,
    tasks: [
      { clientId: ID_A, customerName: 'PT A', note: 'catatan A' },
      { clientId: ID_B, customerName: 'PT B', note: 'catatan B' },
    ],
  });
  expect(sent[0]?.tasks.map((task) => task.clientId)).toEqual([ID_A, ID_B]);
});

test('clientId yang sudah ada pada input dipertahankan', async () => {
  const send = vi.fn(async (_input: SaveHandoverBatchInput) => []);
  await sendCreate(
    { ...input, tasks: [{ customerName: 'PT A', note: 'x', clientId: ID_B }] },
    { send, newId: () => ID_A },
  );
  expect(send.mock.calls[0]?.[0].tasks[0]?.clientId).toBe(ID_B);
});

test('antrean penuh / penulisan gagal melempar galat dan tidak mengantre', async () => {
  const send = vi.fn().mockRejectedValue(err('UNAVAILABLE'));
  const enqueue = vi.fn().mockResolvedValueOnce('full').mockResolvedValueOnce('failed');
  await expect(sendCreate(input, { send, enqueue })).rejects.toThrow(/penuh/);
  await expect(sendCreate(input, { send, enqueue })).rejects.toBeInstanceOf(ApiError);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('antrean tulis nyata penuh (50 entri gabungan): dilempar, tidak ada entri baru', async () => {
  for (let i = 0; i < 50; i++) {
    await enqueueOutbox(OWNER, {
      kind: 'create',
      locationId: 'loc-a',
      tasks: [{ clientId: ID_A, customerName: `PT ${i}`, note: 'x' }],
      at: Date.now(),
    });
  }
  const send = vi.fn().mockRejectedValue(err('UNAVAILABLE'));
  await expect(sendCreate(input, { send })).rejects.toThrow(/penuh/);
  expect(readOutbox(OWNER)).toHaveLength(50);
});

test('galat selain UNAVAILABLE (VALIDATION, CONFLICT) tidak mengantre dan dilempar apa adanya', async () => {
  for (const code of ['VALIDATION', 'CONFLICT', 'FORBIDDEN'] as const) {
    const failure = err(code, 'ditolak');
    await expect(sendCreate(input, { send: vi.fn().mockRejectedValue(failure) })).rejects.toBe(
      failure,
    );
  }
  expect(readOutbox(OWNER)).toEqual([]);
});
