import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: undefined as unknown,
  configGate: Promise.resolve() as Promise<void>,
  derive: vi.fn(),
  relevance: vi.fn(),
  subscribed: Promise.resolve(true) as Promise<boolean>,
}));
vi.mock('@/app/pwa/install', () => ({ useInstall: () => ({ state: 'unavailable' }) }));
vi.mock('@/modules/push/queries', () => ({
  pushConfigQueryOptions: () => ({
    queryKey: ['push', 'config'],
    queryFn: async () => {
      await state.configGate;
      return state.config;
    },
  }),
}));
vi.mock('../catalog/device', () => ({
  deriveDeviceGuides: (options: unknown) => state.derive(options),
  deviceGuideRelevance: (options: unknown) => state.relevance(options),
  readPushSubscribed: () => state.subscribed,
}));

import { useDeviceGuides } from './use-device-guides';

const CONFIG = { enabled: true, publicKey: 'K', userEnabled: true };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.config = CONFIG;
  state.configGate = Promise.resolve();
  state.subscribed = Promise.resolve(true);
  state.derive.mockReset().mockReturnValue(new Map([['perangkat-push', true]]));
  state.relevance.mockReset().mockReturnValue(new Map([['perangkat-push', true]]));
});

describe('useDeviceGuides', () => {
  test('meneruskan konfigurasi push (setelah termuat) dan langganan ke derivasi dan relevansi', async () => {
    const { result } = renderHook(() => useDeviceGuides(), { wrapper });
    await waitFor(() =>
      expect(state.derive).toHaveBeenCalledWith({ pushSubscribed: true, pushConfig: CONFIG }),
    );
    expect(state.relevance).toHaveBeenCalledWith({ pushConfig: CONFIG });
    expect(result.current.derived.get('perangkat-push')).toBe(true);
    expect(result.current.relevant.get('perangkat-push')).toBe(true);
  });

  test('konfigurasi belum termuat: diteruskan sebagai undefined (tak ditawarkan, aman)', async () => {
    let release: () => void = () => undefined;
    state.configGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderHook(() => useDeviceGuides(), { wrapper });
    await waitFor(() =>
      expect(state.derive).toHaveBeenCalledWith(expect.objectContaining({ pushConfig: undefined })),
    );
    expect(state.relevance).toHaveBeenCalledWith({ pushConfig: undefined });
    release();
    await waitFor(() => expect(state.relevance).toHaveBeenCalledWith({ pushConfig: CONFIG }));
  });

  test('langganan push: awalnya tak diketahui, lalu hasil bacaan async diteruskan', async () => {
    state.subscribed = Promise.resolve(false);
    renderHook(() => useDeviceGuides(), { wrapper });
    expect(state.derive).toHaveBeenCalledWith(
      expect.objectContaining({ pushSubscribed: undefined }),
    );
    await waitFor(() =>
      expect(state.derive).toHaveBeenCalledWith(expect.objectContaining({ pushSubscribed: false })),
    );
  });

  test('gagal membaca langganan: tetap tak diketahui, tidak melempar', async () => {
    state.subscribed = Promise.reject(new Error('sw'));
    renderHook(() => useDeviceGuides(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.derive).not.toHaveBeenCalledWith(
      expect.objectContaining({ pushSubscribed: true }),
    );
  });
});
