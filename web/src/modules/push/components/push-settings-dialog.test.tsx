import type { PushConfigDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: { enabled: true, publicKey: 'KUNCI', userEnabled: true } as PushConfigDto,
  api: vi.fn(),
  sync: vi.fn(),
  linked: false,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => ({ email: 'a@qc.local', name: 'U' }) }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/sync', () => ({ syncThisDevice: (...args: unknown[]) => state.sync(...args) }));
vi.mock('../lib/subscribe', () => ({
  getPushRegistration: () =>
    Promise.resolve({
      pushManager: { getSubscription: () => Promise.resolve(state.linked ? {} : null) },
    }),
}));

import { toast } from 'sonner';
import { markSynced } from '../lib/storage';
import { deviceKind, PushSettingsDialog } from './push-settings-dialog';

type Permission = 'default' | 'granted' | 'denied';

function device(options: { permission: Permission; standalone?: boolean; supported?: boolean }) {
  const requestPermission = vi.fn(() => Promise.resolve('granted' as Permission));
  if (options.supported !== false) {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission: options.permission, requestPermission });
  }
  window.matchMedia = vi.fn(
    () => ({ matches: options.standalone ?? true }) as MediaQueryList,
  ) as unknown as typeof window.matchMedia;
  return { requestPermission };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PushSettingsDialog onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  state.config = { enabled: true, publicKey: 'KUNCI', userEnabled: true };
  state.linked = false;
  state.api.mockReset();
  state.api.mockImplementation(async (id: string, input: { enabled?: boolean }) => {
    if (id === 'push.config') return state.config;
    if (id === 'push.setPreference') return { enabled: input.enabled };
    if (id === 'push.reportPermission') return { ok: true };
    throw new Error(`tak terduga: ${id}`);
  });
  state.sync.mockReset();
  state.sync.mockResolvedValue('subscribed');
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe('deviceKind', () => {
  const base = {
    config: { enabled: true, publicKey: 'K', userEnabled: true },
    permission: 'granted' as const,
    standalone: true,
    ios: false,
    linked: true,
  };
  test('urutan keputusan status perangkat', () => {
    expect(deviceKind({ ...base, config: { ...base.config, enabled: false } })).toBe('server-off');
    expect(deviceKind({ ...base, permission: 'unsupported', ios: true, standalone: false })).toBe(
      'ios-install',
    );
    expect(deviceKind({ ...base, permission: 'unsupported', ios: true })).toBe('unsupported');
    expect(deviceKind({ ...base, permission: 'unsupported' })).toBe('unsupported');
    expect(deviceKind({ ...base, permission: 'denied' })).toBe('denied');
    expect(deviceKind({ ...base, permission: 'default' })).toBe('default');
    expect(deviceKind({ ...base, linked: undefined })).toBe('checking');
    expect(deviceKind(base)).toBe('linked');
    expect(deviceKind({ ...base, linked: false })).toBe('unlinked');
  });
});

describe('PushSettingsDialog', () => {
  test('saklar mengikuti preferensi; mengubahnya memanggil push.setPreference', async () => {
    device({ permission: 'granted' });
    state.linked = true;
    markSynced('a@qc.local');
    mount();
    const box = await screen.findByRole('checkbox', { name: 'Terima notifikasi push' });
    expect(box).toBeChecked();
    expect(await screen.findByText('Aktif di perangkat ini.')).toBeInTheDocument();
    await userEvent.click(box);
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('push.setPreference', { enabled: false }),
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Terima notifikasi push' })).not.toBeChecked(),
    );
    expect(screen.getByTestId('push-device-status')).toHaveTextContent('dimatikan untuk akunmu');
  });

  test('laporan izin dari dialog hanya dari PWA terpasang: tab peramban biasa tidak melaporkan', async () => {
    const { requestPermission } = device({ permission: 'default', standalone: false });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Aktifkan di perangkat ini' }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.sync).toHaveBeenCalled());
    expect(state.api.mock.calls.filter(([id]) => id === 'push.reportPermission')).toHaveLength(0);
  });

  test('penautan selesai saat dialog terbuka: status ikut menjadi aktif tanpa render ulang manual', async () => {
    device({ permission: 'granted' });
    mount();
    expect(await screen.findByText(/belum tertaut/)).toBeInTheDocument();
    state.linked = true;
    act(() => markSynced('a@qc.local'));
    expect(await screen.findByText('Aktif di perangkat ini.')).toBeInTheDocument();
  });

  test('preferensi dimatikan: hanya alasan yang tampil, bukan "belum tertaut"', async () => {
    state.config = { enabled: true, publicKey: 'KUNCI', userEnabled: false };
    device({ permission: 'granted' });
    mount();
    expect(await screen.findByTestId('push-device-status')).toHaveTextContent(
      'dimatikan untuk akunmu',
    );
    expect(screen.getByTestId('push-device-status')).not.toHaveTextContent('belum tertaut');
  });

  test('izin ditolak: langkah menyalakan kembali tampil dan tombol aktifkan TIDAK ada', async () => {
    const { requestPermission } = device({ permission: 'denied' });
    mount();
    expect(await screen.findByTestId('push-device-status')).toHaveTextContent('Izin ditolak');
    expect(screen.getByTestId('push-device-status')).toHaveTextContent('gembok');
    expect(
      screen.queryByRole('button', { name: 'Aktifkan di perangkat ini' }),
    ).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test('izin belum ditentukan: tombol aktifkan meminta izin, menautkan, dan melaporkan', async () => {
    const { requestPermission } = device({ permission: 'default' });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Aktifkan di perangkat ini' }));
    await waitFor(() => expect(state.sync).toHaveBeenCalledWith(state.config, 'a@qc.local'));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(state.api).toHaveBeenCalledWith('push.reportPermission', { state: 'granted' });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  test('izin ada tetapi perangkat belum tertaut: tombol hanya menautkan, tanpa meminta izin lagi', async () => {
    const { requestPermission } = device({ permission: 'granted' });
    mount();
    expect(await screen.findByText(/belum tertaut/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aktifkan di perangkat ini' }));
    await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test('langganan peramban ada tetapi akun ini belum disinkronkan: belum dianggap aktif', async () => {
    device({ permission: 'granted' });
    state.linked = true; // langganan milik akun lain di perangkat yang sama
    mount();
    expect(await screen.findByText(/belum tertaut/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktifkan di perangkat ini' })).toBeInTheDocument();
  });

  test('gagal menautkan: toast galat, tidak melempar', async () => {
    device({ permission: 'granted' });
    state.sync.mockRejectedValue(new Error('layanan push tak terjangkau'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Aktifkan di perangkat ini' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  test('iOS di Safari biasa: menjelaskan harus dipasang ke layar utama', async () => {
    device({ permission: 'default', supported: false, standalone: false });
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    );
    mount();
    expect(await screen.findByTestId('push-device-status')).toHaveTextContent('layar utama');
    expect(
      screen.queryByRole('button', { name: 'Aktifkan di perangkat ini' }),
    ).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  test('server tanpa VAPID: pesan belum disiapkan dan saklar nonaktif', async () => {
    state.config = { enabled: false, publicKey: '', userEnabled: true };
    device({ permission: 'default' });
    mount();
    expect(await screen.findByTestId('push-device-status')).toHaveTextContent('belum disiapkan');
    expect(screen.getByRole('checkbox', { name: 'Terima notifikasi push' })).toBeDisabled();
  });

  test('Tutup memanggil onClose', async () => {
    device({ permission: 'default' });
    const { onClose } = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalled();
  });
});
