import type { PushConfigDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  email: 'a@qc.local',
  config: { enabled: true, publicKey: 'KUNCI', userEnabled: true } as PushConfigDto,
  api: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => ({ email: state.email, name: 'U' }) }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));
vi.mock('../lib/sync', () => ({ syncThisDevice: (...args: unknown[]) => state.sync(...args) }));

import { markAsked, markSynced } from '../lib/storage';
import { PushOnboarding, useBlockingOnboardingActive } from './push-onboarding';

type Permission = 'default' | 'granted' | 'denied';

/** Menyiapkan peramban palsu: dukungan push, izin, dan mode terpasang (standalone). */
function device(options: { permission: Permission; standalone: boolean; supported?: boolean }) {
  const requestPermission = vi.fn(() => Promise.resolve('granted' as Permission));
  if (options.supported !== false) {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: options.permission, requestPermission });
  }
  window.matchMedia = vi.fn(
    () => ({ matches: options.standalone }) as MediaQueryList,
  ) as unknown as typeof window.matchMedia;
  return { requestPermission };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PushOnboarding />
    </QueryClientProvider>,
  );
}

const reportCalls = () => state.api.mock.calls.filter(([id]) => id === 'push.reportPermission');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  state.email = 'a@qc.local';
  state.config = { enabled: true, publicKey: 'KUNCI', userEnabled: true };
  state.api.mockReset();
  state.api.mockImplementation(async (id: string) => {
    if (id === 'push.config') return state.config;
    if (id === 'push.reportPermission') return { ok: true };
    throw new Error(`tak terduga: ${id}`);
  });
  state.sync.mockReset();
  state.sync.mockResolvedValue('subscribed');
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('dialog pra-izin', () => {
  test('PWA terpasang + izin belum ditentukan: dialog tampil; Aktifkan meminta izin SEKALI lalu menautkan perangkat', async () => {
    const { requestPermission } = device({ permission: 'default', standalone: true });
    mount();
    expect(await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' })).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
    await waitFor(() => expect(state.sync).toHaveBeenCalledWith(state.config, 'a@qc.local'));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('push.reportPermission', { state: 'granted' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Nanti: tak meminta izin dan tak ditanya lagi pada muat berikutnya', async () => {
    const { requestPermission } = device({ permission: 'default', standalone: true });
    const first = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nanti' }));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    first.unmount();
    mount();
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('push.config', null));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('bukan PWA terpasang: tak ada dialog dan izin tak diminta', async () => {
    const { requestPermission } = device({ permission: 'default', standalone: false });
    mount();
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('push.config', null));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Tab peramban biasa tidak melaporkan izin: tidak boleh menimpa nilai satu pengguna dari perangkat lain.
    expect(reportCalls()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByTestId('push-denied-banner')).not.toBeInTheDocument();
  });

  test('akun yang sudah pernah ditanya tak ditanya lagi, tetapi akun lain di perangkat sama tetap ditanya', async () => {
    device({ permission: 'default', standalone: true });
    markAsked('a@qc.local');
    state.email = 'b@qc.local';
    mount();
    expect(await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' })).toBeInTheDocument();
  });
});

describe('laporan izin ke server', () => {
  test('izin default tidak dilaporkan; denied dari tab peramban biasa juga tidak (tak menimpa perangkat lain)', async () => {
    device({ permission: 'default', standalone: true });
    const first = mount();
    await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' });
    expect(reportCalls()).toHaveLength(0);
    first.unmount();
    device({ permission: 'denied', standalone: false });
    mount();
    expect(await screen.findByTestId('push-denied-banner')).toHaveAttribute('data-app-banner');
    expect(reportCalls()).toHaveLength(0);
  });
});

describe('izin ditolak', () => {
  test('banner tampil, izin TIDAK pernah diminta ulang, dilaporkan denied; Tutup menyembunyikan dan 7 hari tak muncul lagi', async () => {
    const { requestPermission } = device({ permission: 'denied', standalone: true });
    const first = mount();
    const banner = await screen.findByTestId('push-denied-banner');
    expect(banner).toHaveTextContent('Notifikasi push belum aktif');
    expect(banner).toHaveTextContent('gembok');
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('push.reportPermission', { state: 'denied' }),
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByTestId('push-denied-banner')).not.toBeInTheDocument();
    first.unmount();
    mount();
    await waitFor(() => expect(reportCalls().length).toBeGreaterThan(1));
    expect(screen.queryByTestId('push-denied-banner')).not.toBeInTheDocument();
  });

  test('banner tampil lagi setelah 7 hari', async () => {
    device({ permission: 'denied', standalone: true });
    localStorage.setItem('qc.push.banner:a@qc.local', String(Date.now() - 7 * 24 * 3600 * 1000));
    mount();
    expect(await screen.findByTestId('push-denied-banner')).toBeInTheDocument();
  });
});

describe('izin sudah diberikan', () => {
  test('menautkan perangkat diam-diam tanpa dialog, sekali per sesi', async () => {
    device({ permission: 'granted', standalone: true });
    const first = mount();
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem('qc.push.synced:a@qc.local')).toBe('1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    first.unmount();
    mount();
    await waitFor(() => expect(reportCalls().length).toBeGreaterThan(1));
    expect(state.sync).toHaveBeenCalledTimes(1);
  });

  test('akun kedua di perangkat yang sama: ikut ditautkan tanpa dialog', async () => {
    device({ permission: 'granted', standalone: true });
    markSynced('a@qc.local');
    state.email = 'b@qc.local';
    mount();
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('gagal berlangganan lalu jendela fokus lagi: dicoba ulang dalam sesi yang sama', async () => {
    device({ permission: 'granted', standalone: true });
    state.sync.mockRejectedValueOnce(new Error('belum siap'));
    mount();
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem('qc.push.synced:a@qc.local')).toBeNull());
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sessionStorage.getItem('qc.push.synced:a@qc.local')).toBe('1'));
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state.sync).toHaveBeenCalledTimes(2);
  });

  test('gagal terus: dicoba ulang saat fokus paling banyak 3 kali; berpindah ke latar tidak memicu percobaan', async () => {
    device({ permission: 'granted', standalone: true });
    state.sync.mockRejectedValue(new Error('host ditolak'));
    mount();
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(state.sync).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    for (let i = 0; i < 6; i++) {
      window.dispatchEvent(new Event('focus'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state.sync).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });

  test('gagal berlangganan: tidak ditandai tersinkron dan tidak melempar', async () => {
    device({ permission: 'granted', standalone: true });
    state.sync.mockRejectedValue(new Error('layanan push tak terjangkau'));
    mount();
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem('qc.push.synced:a@qc.local')).toBeNull());
  });
});

describe('push tidak tersedia atau dimatikan', () => {
  test('preferensi dimatikan pengguna: tanpa dialog, tanpa banner, tanpa berlangganan', async () => {
    state.config = { enabled: true, publicKey: 'KUNCI', userEnabled: false };
    for (const permission of ['default', 'denied', 'granted'] as const) {
      device({ permission, standalone: true });
      const view = mount();
      await waitFor(() => expect(state.api).toHaveBeenCalledWith('push.config', null));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByTestId('push-denied-banner')).not.toBeInTheDocument();
      expect(state.sync).not.toHaveBeenCalled();
      view.unmount();
      state.api.mockClear();
    }
  });

  test('server tanpa VAPID: tak ada apa pun dan izin tak dilaporkan', async () => {
    state.config = { enabled: false, publicKey: '', userEnabled: true };
    const { requestPermission } = device({ permission: 'default', standalone: true });
    mount();
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('push.config', null));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(reportCalls()).toHaveLength(0);
    expect(state.sync).not.toHaveBeenCalled();
  });

  test('peramban tanpa dukungan push: tak ada apa pun dan tak ada galat', async () => {
    device({ permission: 'default', standalone: true, supported: false });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reportCalls()).toHaveLength(0);
    expect(state.sync).not.toHaveBeenCalled();
  });
});

describe('useBlockingOnboardingActive', () => {
  function Probe() {
    return <span data-testid="blocking">{String(useBlockingOnboardingActive())}</span>;
  }
  function mountWithProbe() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <PushOnboarding />
        <Probe />
      </QueryClientProvider>,
    );
  }

  test('true selama dialog pra-izin tampil, false setelah Nanti', async () => {
    device({ permission: 'default', standalone: true });
    mountWithProbe();
    await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' });
    expect(screen.getByTestId('blocking')).toHaveTextContent('true');
    await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
    await waitFor(() => expect(screen.getByTestId('blocking')).toHaveTextContent('false'));
  });

  test('true selama banner izin ditolak tampil, false setelah Tutup', async () => {
    device({ permission: 'denied', standalone: true });
    mountWithProbe();
    await screen.findByTestId('push-denied-banner');
    expect(screen.getByTestId('blocking')).toHaveTextContent('true');
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.getByTestId('blocking')).toHaveTextContent('false'));
  });

  test('false bila push tidak tersedia (tak ada dialog/banner) setelah konfigurasi termuat', async () => {
    state.config = { enabled: false, publicKey: '', userEnabled: true };
    device({ permission: 'default', standalone: true });
    mountWithProbe();
    await waitFor(() => expect(screen.getByTestId('blocking')).toHaveTextContent('false'));
  });

  test('M14: localStorage terblokir: setelah Nanti sinyal kembali false (tak macet true)', async () => {
    device({ permission: 'default', standalone: true });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('terblokir');
    });
    mountWithProbe();
    await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' });
    await userEvent.click(screen.getByRole('button', { name: 'Nanti' }));
    await waitFor(() => expect(screen.getByTestId('blocking')).toHaveTextContent('false'));
    vi.restoreAllMocks();
  });

  test('M14: localStorage terblokir: setelah menutup banner izin ditolak sinyal kembali false', async () => {
    device({ permission: 'denied', standalone: true });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('terblokir');
    });
    mountWithProbe();
    await screen.findByTestId('push-denied-banner');
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    await waitFor(() => expect(screen.getByTestId('blocking')).toHaveTextContent('false'));
    vi.restoreAllMocks();
  });

  test('kembali false saat PushOnboarding dilepas', async () => {
    device({ permission: 'default', standalone: true });
    const view = mountWithProbe();
    await screen.findByRole('dialog', { name: 'Aktifkan notifikasi?' });
    view.unmount();
    expect(render(<Probe />).getByTestId('blocking')).toHaveTextContent('false');
  });
});
