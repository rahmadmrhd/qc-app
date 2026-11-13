import type { MeDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { requireAnyPermission } from './permissions';
import { meQueryOptions } from './queries';

function clientWith(permissions: Record<string, string>): QueryClient {
  const client = new QueryClient();
  const me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    locations: [
      {
        id: 'l1',
        code: 'A',
        name: 'A',
        permissions: {
          handover: 'none',
          qc: 'none',
          stock: 'none',
          stickerstock: 'none',
          ...permissions,
        },
      },
    ],
  } as MeDto;
  client.setQueryData(meQueryOptions().queryKey, me);
  return client;
}

const either = [
  { module: 'handover', level: 'view' },
  { module: 'qc', level: 'edit' },
] as const;

test('requireAnyPermission lolos bila salah satu alternatif terpenuhi di minimal satu lokasi', async () => {
  await expect(
    requireAnyPermission(clientWith({ handover: 'view' }), either),
  ).resolves.toBeUndefined();
  await expect(requireAnyPermission(clientWith({ qc: 'edit' }), either)).resolves.toBeUndefined();
});

test('requireAnyPermission mengalihkan ke /forbidden bila tak satu pun terpenuhi', async () => {
  await expect(requireAnyPermission(clientWith({}), either)).rejects.toMatchObject({
    options: { to: '/forbidden' },
  });
});
