import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { raiseOutdatedLevel, resetOutdatedForTests } from '@/app/pwa/client-outdated';
import { refreshServerApis, resetServerApisForTests } from '@/lib/api/versions';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { useDesktopBlock } from './use-desktop-block';

function installBridge(overrides: Parameters<typeof createFakeBridge>[0] = {}) {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge(overrides);
}

function ping(minClient: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify({ apis: {}, minClient })),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
  resetServerApisForTests();
  resetOutdatedForTests();
});
afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
  resetServerApisForTests();
  resetOutdatedForTests();
});

describe('useDesktopBlock', () => {
  test('peramban (tanpa jembatan) tidak pernah menahan, walau level outdated', async () => {
    raiseOutdatedLevel('outdated');
    await refreshServerApis(ping({ desktop: '9.0.0' }));
    const { result } = renderHook(() => useDesktopBlock());
    expect(result.current).toEqual({ blocked: false, installed: null });
  });

  test('desktop v10: versi terpasang di bawah minClient = menahan', async () => {
    installBridge({ app: { version: async () => '1.0.0' } });
    await refreshServerApis(ping({ desktop: '1.2.0' }));
    const { result } = renderHook(() => useDesktopBlock());
    await waitFor(() => expect(result.current).toEqual({ blocked: true, installed: '1.0.0' }));
  });

  test('versi terpasang sama dengan minClient = tidak menahan', async () => {
    installBridge({ app: { version: async () => '1.2.0' } });
    await refreshServerApis(ping({ desktop: '1.2.0' }));
    const { result } = renderHook(() => useDesktopBlock());
    await waitFor(() => expect(result.current.installed).toBe('1.2.0'));
    expect(result.current.blocked).toBe(false);
  });

  test('minClient belum diketahui = tidak menahan', async () => {
    installBridge({ app: { version: async () => '0.0.1' } });
    const { result } = renderHook(() => useDesktopBlock());
    await waitFor(() => expect(result.current.installed).toBe('0.0.1'));
    expect(result.current.blocked).toBe(false);
  });

  test('app.version() menolak: jalur minClient tidak menahan, jalur outdated tetap', async () => {
    installBridge({
      app: {
        version: async () => {
          throw new Error('gagal');
        },
      },
    });
    await refreshServerApis(ping({ desktop: '9.0.0' }));
    const { result } = renderHook(() => useDesktopBlock());
    // Beri kesempatan promise ditolak diselesaikan sebelum menegaskan.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ blocked: false, installed: null });
    act(() => raiseOutdatedLevel('outdated'));
    expect(result.current.blocked).toBe(true);
  });

  test('jembatan v9 (tanpa app) tidak menahan walau outdated', async () => {
    installBridge({ version: 9 });
    raiseOutdatedLevel('outdated');
    const { result } = renderHook(() => useDesktopBlock());
    expect(result.current).toEqual({ blocked: false, installed: null });
  });

  test('level outdated + jembatan v10 menahan meski minClient null', async () => {
    installBridge({ app: { version: async () => '1.0.0' } });
    raiseOutdatedLevel('outdated');
    const { result } = renderHook(() => useDesktopBlock());
    expect(result.current.blocked).toBe(true);
  });

  test('ping segar yang menaikkan minClient memicu hitung ulang', async () => {
    installBridge({ app: { version: async () => '1.0.0' } });
    await refreshServerApis(ping({ desktop: '1.0.0' }));
    const { result } = renderHook(() => useDesktopBlock());
    await waitFor(() => expect(result.current.installed).toBe('1.0.0'));
    expect(result.current.blocked).toBe(false);
    await act(async () => {
      await refreshServerApis(ping({ desktop: '1.5.0' }));
    });
    expect(result.current.blocked).toBe(true);
  });
});
