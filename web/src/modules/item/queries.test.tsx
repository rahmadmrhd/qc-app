import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rpc', () => ({ rpc: rpcMock }));

import { brandKeys } from '@/modules/brand/keys';
import { useSaveItem } from './queries';

beforeEach(() => {
  rpcMock.mockReset();
});

test('menyimpan item memuat ulang daftar merk (merk baru dapat dibuat inline)', async () => {
  rpcMock.mockResolvedValue({ id: 'i1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(brandKeys.list, []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveItem(), { wrapper });
  result.current.mutate({
    brand: 'Baru',
    model: 'X',
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  });
  await waitFor(() => expect(client.getQueryState(brandKeys.list)?.isInvalidated).toBe(true));
});
