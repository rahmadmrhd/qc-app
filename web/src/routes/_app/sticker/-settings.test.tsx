import type { PostelSettingsDto, StickerSettingsDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { Route } from './settings';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ME = {
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: {
    access: 'none',
    item: 'none',
    qrcode: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
    sticker: 'manage',
    stickerstock: 'none',
  },
  businessUnits: [],
  locations: [],
};

let stickerState: StickerSettingsDto;
let postelState: PostelSettingsDto;

beforeEach(() => {
  apiMock.mockReset();
  stickerState = {
    alert: { enabled: false, recipients: [], digestHour: 8 },
    types: [{ id: 't1', name: 'QC Hijau', systemKind: '', defaultMinQty: 0 }],
    updatedAt: 'sticker-v1',
    smtpConfigured: true,
  };
  postelState = {
    alert: {
      enabled: false,
      recipients: [],
      sendHour: 8,
      thresholds: [90, 60, 30],
      repeatEveryDays: 7,
    },
    updatedAt: 'postel-v1',
    smtpConfigured: true,
  };
  apiMock.mockImplementation((id: string, input: { alert?: unknown }) => {
    switch (id) {
      case 'auth.me':
        return Promise.resolve(ME);
      case 'stickerSettings.get':
        return Promise.resolve(stickerState);
      case 'postelSettings.get':
        return Promise.resolve(postelState);
      case 'stickerSettings.save':
        stickerState = { ...stickerState, updatedAt: 'sticker-v2' };
        return Promise.resolve(stickerState);
      case 'postelSettings.save':
        postelState = {
          ...postelState,
          alert: input.alert as PostelSettingsDto['alert'],
          updatedAt: 'postel-v2',
        };
        return Promise.resolve(postelState);
      default:
        return Promise.reject(new Error(`tak terduga: ${id}`));
    }
  });
});

/** Komponen rute dipecah otomatis (lazy): dimuat dulu agar render pertama langsung memakai isinya. */
async function mount() {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <Component />
      </Suspense>
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter(([name]) => name === id).length;

test('menyimpan peringatan Postel tidak mereset draf Konfigurasi Stiker', async () => {
  await mount();
  const min = await screen.findByLabelText('Minimum bawaan QC Hijau');
  await userEvent.clear(min);
  await userEvent.type(min, '25');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '3');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan peringatan Postel' }));
  await waitFor(() => expect(calls('postelSettings.save')).toBe(1));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'postelSettings.save',
      expect.objectContaining({ expectedUpdatedAt: 'postel-v1' }),
    ),
  );
  // form Postel dimuat ulang dari hasil simpan (versi baru), draf stok tetap utuh dan tanpa simpan stok
  expect(screen.getByLabelText('Minimum bawaan QC Hijau')).toHaveValue(25);
  expect(calls('stickerSettings.save')).toBe(0);
  expect(screen.getByLabelText('Ulangi setiap (hari)')).toHaveValue(3);
});

test('menyimpan Konfigurasi Stiker tidak mereset draf peringatan Postel', async () => {
  await mount();
  const repeat = await screen.findByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '3');
  const first = screen.getByLabelText('Pengingat 1 (hari sebelum habis)');
  await userEvent.clear(first);
  await userEvent.type(first, '120');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('stickerSettings.save')).toBe(1));
  // katalog stiker dimuat ulang (versi baru); pengaturan Postel tidak ikut dimuat ulang dan draf-nya tetap
  await waitFor(() => expect(calls('stickerSettings.get')).toBeGreaterThanOrEqual(2));
  expect(calls('postelSettings.get')).toBe(1);
  expect(calls('postelSettings.save')).toBe(0);
  expect(screen.getByLabelText('Ulangi setiap (hari)')).toHaveValue(3);
  expect(screen.getByLabelText('Pengingat 1 (hari sebelum habis)')).toHaveValue(120);
});
