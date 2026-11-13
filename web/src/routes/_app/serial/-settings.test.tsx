import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import { meQueryKey } from '@/modules/auth/queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
// Guard pertama (izin kasar) diganti lolos agar yang diuji hanya penanda dari `auth.me`.
vi.mock('@/modules/auth/permissions', async () => ({
  ...(await vi.importActual<object>('@/modules/auth/permissions')),
  requirePermission: vi.fn(),
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: () => (options: unknown) => ({ options }),
}));

import { Route } from './settings';

type Guard = (args: { context: { queryClient: QueryClient } }) => Promise<void>;
const guard = (Route as unknown as { options: { beforeLoad: Guard } }).options.beforeLoad;

const ME = {
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: false,
  canManageSerialSettings: true,
  permissions: {},
  businessUnits: [],
  locations: [],
};

function clientWith(me: Record<string, unknown> | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (me) client.setQueryData(meQueryKey, me);
  return client;
}

beforeEach(() => {
  apiMock.mockReset();
});

test('penanda true: lolos tanpa memuat ulang', async () => {
  apiMock.mockResolvedValue(ME);
  await expect(guard({ context: { queryClient: clientWith(ME) } })).resolves.toBeUndefined();
});

test('penanda false: dialihkan ke /forbidden', async () => {
  apiMock.mockResolvedValue({ ...ME, canManageSerialSettings: false });
  const attempt = guard({
    context: { queryClient: clientWith({ ...ME, canManageSerialSettings: false }) },
  });
  await expect(attempt).rejects.toMatchObject({ options: { to: '/forbidden' } });
});

test('me lama tanpa penanda: dimuat ulang dari server walau data cache masih baru', async () => {
  const { canManageSerialSettings: _drop, ...legacy } = ME;
  apiMock.mockResolvedValue(ME);
  await expect(guard({ context: { queryClient: clientWith(legacy) } })).resolves.toBeUndefined();
  expect(apiMock).toHaveBeenCalledWith('auth.me', null);
});
