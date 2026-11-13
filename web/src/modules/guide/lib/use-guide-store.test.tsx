import type { GuideProgressDto } from '@shared/guides';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  email: 'a@qc.local',
  sharedAccount: false,
  api: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () => ({ email: state.email, name: 'U', sharedAccount: state.sharedAccount }),
}));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));

import { readDone, writeDone } from './device-store';
import { useGuideStore } from './use-guide-store';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const calls = (id: string) => state.api.mock.calls.filter(([called]) => called === id);

let server: GuideProgressDto[];

// Spy pada Storage.prototype tak boleh bocor ke tes berikutnya bila sebuah asersi gagal sebelum pemulihan.
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  state.email = 'a@qc.local';
  state.sharedAccount = false;
  server = [];
  state.api.mockReset();
  state.api.mockImplementation(async (id: string, input: { id?: string; version?: number }) => {
    if (id === 'guides.list') return [...server];
    if (id === 'guides.mark') {
      server = [...server.filter((row) => row.id !== input.id), input as GuideProgressDto];
      return [...server];
    }
    if (id === 'guides.reset') {
      server = server.filter((row) => row.id !== input.id);
      return [...server];
    }
    throw new Error(`tak terduga: ${id}`);
  });
});

describe('akun individu (server)', () => {
  test('ready false sebelum termuat, lalu done dari guides.list', async () => {
    server = [{ id: 'dasar-layout', version: 1 }];
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    expect(result.current.ready).toBe(false);
    expect(result.current.done.size).toBe(0);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.done.get('dasar-layout')).toBe(1);
    expect(calls('guides.list')).toHaveLength(1);
    expect(calls('guides.list')[0]?.[1]).toBeNull();
  });

  test('Review Focus 1: guides.list gagal = ready tetap false, bukan peta kosong siap', async () => {
    state.api.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await waitFor(() => expect(calls('guides.list').length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.ready).toBe(false);
    expect(result.current.done.size).toBe(0);
  });

  test('mark memanggil guides.mark dan memperbarui cache tanpa memuat ulang daftar', async () => {
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.mark('handover-dasar', 1));
    expect(calls('guides.mark')).toEqual([['guides.mark', { id: 'handover-dasar', version: 1 }]]);
    await waitFor(() => expect(result.current.done.get('handover-dasar')).toBe(1));
    expect(calls('guides.list')).toHaveLength(1);
  });

  test('mark dengan covers: SATU panggilan server tanpa covers (server yang memperluas)', async () => {
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.mark('handover-dasar', 1, ['tip-handover-tempel-wa']));
    expect(calls('guides.mark')).toHaveLength(1);
    expect(calls('guides.mark')[0]?.[1]).toEqual({ id: 'handover-dasar', version: 1 });
  });

  test('reset memanggil guides.reset dan memperbarui cache', async () => {
    server = [{ id: 'dasar-layout', version: 1 }];
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.reset('dasar-layout'));
    expect(calls('guides.reset')).toEqual([['guides.reset', { id: 'dasar-layout' }]]);
    await waitFor(() => expect(result.current.done.has('dasar-layout')).toBe(false));
  });

  test('tidak menyentuh localStorage perangkat', async () => {
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.mark('dasar-layout', 1));
    expect(readDone('a@qc.local').size).toBe(0);
  });
});

describe('akun bersama (perangkat)', () => {
  beforeEach(() => {
    state.sharedAccount = true;
  });

  test('ready seketika dari localStorage dan TIDAK memanggil api', async () => {
    writeDone('a@qc.local', { 'dasar-layout': 1 });
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    expect(result.current.ready).toBe(true);
    expect(result.current.done.get('dasar-layout')).toBe(1);
    await act(() => result.current.mark('handover-dasar', 1));
    await act(() => result.current.reset('dasar-layout'));
    expect(state.api).not.toHaveBeenCalled();
    expect(Object.fromEntries(readDone('a@qc.local'))).toEqual({ 'handover-dasar': 1 });
    // Pembaruan cache sampai ke observer secara asinkron (notifyManager): tunggu, jangan baca sinkron.
    await waitFor(() =>
      expect(Object.fromEntries(result.current.done)).toEqual({ 'handover-dasar': 1 }),
    );
  });

  test('Review Focus 5: baris di server diabaikan dan guides.list tak pernah dipanggil', async () => {
    server = [{ id: 'dasar-layout', version: 1 }];
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.done.size).toBe(0);
    expect(calls('guides.list')).toHaveLength(0);
    expect(server).toEqual([{ id: 'dasar-layout', version: 1 }]);
  });

  test('mark dengan covers menulis id tercakup dalam SATU kali tulis', async () => {
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await act(() => result.current.mark('handover-dasar', 1, ['tip-handover-tempel-wa']));
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    expect(Object.fromEntries(readDone('a@qc.local'))).toEqual({
      'handover-dasar': 1,
      'tip-handover-tempel-wa': 1,
    });
    await waitFor(() => expect(result.current.done.get('tip-handover-tempel-wa')).toBe(1));
  });

  test('dua pemakai hook di pohon yang sama melihat perubahan yang sama', async () => {
    const Wrapper = wrapper();
    const { result } = renderHook(() => ({ a: useGuideStore(), b: useGuideStore() }), {
      wrapper: Wrapper,
    });
    await act(() => result.current.a.mark('dasar-layout', 1));
    await waitFor(() => expect(result.current.b.done.get('dasar-layout')).toBe(1));
  });

  test('penyimpanan terblokir: mark tidak melempar dan done sesi ini tetap terisi', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('penuh');
    });
    const { result } = renderHook(() => useGuideStore(), { wrapper: wrapper() });
    await act(() => result.current.mark('dasar-layout', 1));
    await waitFor(() => expect(result.current.done.get('dasar-layout')).toBe(1));
    vi.restoreAllMocks();
  });
});
