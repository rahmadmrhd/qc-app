import type { MeDto } from '@shared/contract';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEntry } from './types';

const state = vi.hoisted(() => ({
  ready: true,
  done: new Map<string, number>(),
  catalog: [] as GuideEntry[],
  derive: vi.fn(),
  subscribed: Promise.resolve(true) as Promise<boolean>,
}));
vi.mock('@/modules/auth/use-me', () => ({
  useMe: () =>
    ({
      email: 'a@qc.local',
      name: 'A',
      isSuperAdmin: false,
      permissions: { item: 'view' },
      locations: [],
      businessUnits: [],
      sharedAccount: false,
    }) as unknown as MeDto,
}));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ available: [], selectedIds: [], toggle: () => undefined }),
}));
vi.mock('@/app/pwa/install', () => ({ useInstall: () => ({ state: 'unavailable' }) }));
vi.mock('./use-guide-store', () => ({
  useGuideStore: () => ({ ready: state.ready, done: state.done, mark: vi.fn(), reset: vi.fn() }),
}));
vi.mock('../catalog', () => ({
  get GUIDE_CATALOG() {
    return state.catalog;
  },
}));
vi.mock('../catalog/device', () => ({
  deriveDeviceGuides: (options: unknown) => state.derive(options),
  readPushSubscribed: () => state.subscribed,
}));

import { useOfferedGuides } from './use-offered-guides';

function entry(overrides: Partial<GuideEntry>): GuideEntry {
  return {
    id: 'dasar-layout',
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: 'T',
    steps: [{ target: 'x', text: 't', advance: 'next' }],
    ...overrides,
  };
}

beforeEach(() => {
  state.ready = true;
  state.done = new Map();
  state.catalog = [entry({})];
  state.subscribed = Promise.resolve(true);
  state.derive.mockReset();
  state.derive.mockReturnValue(new Map());
});

describe('useOfferedGuides', () => {
  test('ready dan belum selesai: panduan ditawarkan', async () => {
    const { result } = renderHook(() => useOfferedGuides());
    await waitFor(() => expect(state.derive).toHaveBeenCalledWith({ pushSubscribed: true }));
    expect(result.current.ready).toBe(true);
    expect(result.current.offers.map((offer) => offer.entry.id)).toEqual(['dasar-layout']);
  });

  test('belum ready: tidak ada penawaran apa pun', () => {
    state.ready = false;
    const { result } = renderHook(() => useOfferedGuides());
    expect(result.current.ready).toBe(false);
    expect(result.current.offers).toEqual([]);
  });

  test('sudah selesai: tidak ditawarkan', () => {
    state.done = new Map([['dasar-layout', 1]]);
    const { result } = renderHook(() => useOfferedGuides());
    expect(result.current.offers).toEqual([]);
  });

  test('panduan diturunkan ditawarkan menurut derivasi perangkat', () => {
    state.catalog = [entry({ id: 'perangkat-pwa', status: 'diturunkan' })];
    state.derive.mockReturnValue(new Map([['perangkat-pwa', true]]));
    const { result } = renderHook(() => useOfferedGuides());
    expect(result.current.offers.map((offer) => offer.entry.id)).toEqual(['perangkat-pwa']);
  });

  test('langganan push: awalnya tak diketahui, lalu hasil bacaan async diteruskan', async () => {
    state.subscribed = Promise.resolve(false);
    renderHook(() => useOfferedGuides());
    expect(state.derive).toHaveBeenCalledWith({ pushSubscribed: undefined });
    await waitFor(() => expect(state.derive).toHaveBeenCalledWith({ pushSubscribed: false }));
  });

  test('gagal membaca langganan: tetap tak diketahui, tidak melempar', async () => {
    state.subscribed = Promise.reject(new Error('sw'));
    const { result } = renderHook(() => useOfferedGuides());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.ready).toBe(true);
    expect(state.derive).not.toHaveBeenCalledWith({ pushSubscribed: true });
  });
});
