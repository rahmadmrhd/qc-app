import type { HandoverDto } from '@shared/rpc';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { applySavedHandover, handoverKeys } from './queries';

const task = (id: string, locationId: string, createdAt: string): HandoverDto =>
  ({
    id,
    number: `ST-${id}`,
    locationId,
    createdAt,
    note: '',
    checklist: [],
    comments: [],
  }) as unknown as HandoverDto;

test('hasil simpan dipasang ke papan yang memuat lokasinya, terbaru dahulu, tanpa muat ulang', () => {
  const client = new QueryClient();
  const old = task('1', 'loc-a', '2026-10-01T00:00:00.000Z');
  client.setQueryData(handoverKeys.board(['loc-a']), [old]);
  client.setQueryData(handoverKeys.board(['loc-b']), []);
  client.setQueryData(handoverKeys.board(['loc-a', 'loc-b']), [old]);
  const fresh = task('2', 'loc-a', '2026-10-02T00:00:00.000Z');
  applySavedHandover(client, fresh);
  expect(
    client.getQueryData<HandoverDto[]>(handoverKeys.board(['loc-a']))?.map((t) => t.id),
  ).toEqual(['2', '1']);
  expect(client.getQueryData<HandoverDto[]>(handoverKeys.board(['loc-b']))).toEqual([]);
  expect(
    client.getQueryData<HandoverDto[]>(handoverKeys.board(['loc-a', 'loc-b']))?.map((t) => t.id),
  ).toEqual(['2', '1']);
});

test('menyimpan ulang task yang sama menggantikan entri dan memperbarui cache detail', () => {
  const client = new QueryClient();
  const old = task('1', 'loc-a', '2026-10-01T00:00:00.000Z');
  client.setQueryData(handoverKeys.board(['loc-a']), [old]);
  client.setQueryData(handoverKeys.one('1', ['loc-a']), old);
  const edited = { ...old, note: 'baru' };
  applySavedHandover(client, edited);
  expect(client.getQueryData<HandoverDto[]>(handoverKeys.board(['loc-a']))).toEqual([edited]);
  expect(client.getQueryData(handoverKeys.one('1', ['loc-a']))).toEqual(edited);
});
