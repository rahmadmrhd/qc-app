import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));

import { useLogout } from './use-logout';

afterEach(() => {
  localStorage.clear();
  navigate.mockClear();
});

test('keluar membuang draf tabel sementara Serial Number semua pemilik', async () => {
  localStorage.setItem('qc.serial.draft:a@x.com', '[]');
  localStorage.setItem('qc.serial.draft:b@x.com', '[]');
  localStorage.setItem('tema', 'gelap');
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useLogout(), { wrapper });
  act(() => result.current());
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(localStorage.getItem('qc.serial.draft:a@x.com')).toBeNull();
  expect(localStorage.getItem('qc.serial.draft:b@x.com')).toBeNull();
  expect(localStorage.getItem('tema')).toBe('gelap');
});
