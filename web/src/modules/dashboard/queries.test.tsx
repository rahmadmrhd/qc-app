import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { isPersistedQueryKey } from '@/app/query-persist';
import { dashboardKeys, dashboardOptionsQueryOptions, dashboardQueryOptions } from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const INPUT = {
  filter: { from: '2026-11-01', to: '2026-11-10' },
  widgets: [{ id: 'hs.created' as const }],
};

test('query dashboard tidak masuk whitelist query-persist', () => {
  expect(isPersistedQueryKey(dashboardKeys.query(INPUT))).toBe(false);
  expect(isPersistedQueryKey(dashboardKeys.options)).toBe(false);
});

test('opsi query: dimuat ulang tiap menit, basi setelah semenit, kunci memuat input', () => {
  const options = dashboardQueryOptions(INPUT);
  expect(options.refetchInterval).toBe(60_000);
  expect(options.staleTime).toBe(60_000);
  expect(options.queryKey).toEqual(['dashboard', 'query', INPUT]);
});

test('queryFn memanggil rute dashboard.query dan dashboard.options', async () => {
  apiMock.mockResolvedValue({});
  const client = new QueryClient();
  await client.fetchQuery(dashboardQueryOptions(INPUT));
  await client.fetchQuery(dashboardOptionsQueryOptions());
  expect(apiMock).toHaveBeenCalledWith('dashboard.query', INPUT);
  expect(apiMock).toHaveBeenCalledWith('dashboard.options', null);
});
