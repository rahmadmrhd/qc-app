import type { MeDto, SerialSettingsDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { SerialSettingsView } from './serial-settings-view';

let state: SerialSettingsDto;

const meWith = (access: 'none' | 'view'): MeDto => ({
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: false,
  canManageSerialSettings: false,
  sharedAccount: false,
  permissions: {
    access,
    item: 'none',
    qrcode: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
    sticker: 'none',
    stickerstock: 'none',
    serial: 'manage',
    serialservice: 'none',
  },
  businessUnits: [],
  locations: [],
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SerialSettingsView />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

beforeEach(() => {
  apiMock.mockReset();
  me = meWith('none');
  state = {
    alert: { enabled: false, recipients: [] },
    updatedAt: 'v1',
    smtpConfigured: true,
  };
  apiMock.mockImplementation((id: string, input: { alert?: SerialSettingsDto['alert'] }) => {
    switch (id) {
      case 'serialSettings.get':
        return Promise.resolve(structuredClone(state));
      case 'serialSettings.save': {
        state = { ...state, alert: input.alert as SerialSettingsDto['alert'], updatedAt: 'v2' };
        return Promise.resolve(structuredClone(state));
      }
      case 'access.users.list':
        return Promise.resolve([
          {
            id: 'u1',
            email: 'budi@x.com',
            name: 'Budi',
            status: 'active',
            roleIds: [],
            assignments: [],
            buAssignments: [],
          },
        ]);
      default:
        return Promise.reject(new Error(`api tak dikenal: ${id}`));
    }
  });
});

test('judul, saklar, dan simpan mengirim expectedUpdatedAt dengan penerima email', async () => {
  renderView();
  expect(
    await screen.findByRole('heading', { name: 'Pengaturan Serial Number' }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Kirim email saat Serial Number dinyatakan rusak' }),
  );
  await userEvent.type(screen.getByLabelText('Email lain'), 'qc@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));
  await waitFor(() => expect(calls('serialSettings.save')).toHaveLength(1));
  expect(calls('serialSettings.save')[0]?.[1]).toEqual({
    expectedUpdatedAt: 'v1',
    alert: { enabled: true, recipients: ['qc@x.com'] },
  });
});

test('penerima: format salah, ganda, dan melebihi 20 ditolak di klien', async () => {
  state = {
    ...state,
    alert: { enabled: true, recipients: Array.from({ length: 20 }, (_, i) => `u${i}@x.com`) },
  };
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  const extra = screen.getByLabelText('Email lain');
  await userEvent.type(extra, 'bukan-email');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Format email tidak valid');
  await userEvent.clear(extra);
  await userEvent.type(extra, 'u1@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Email sudah ada dalam daftar');
  await userEvent.clear(extra);
  await userEvent.type(extra, 'baru@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Maksimal 20 penerima');
  expect(calls('serialSettings.save')).toHaveLength(0);
});

test('peringatan SMTP tampil saat smtpConfigured false', async () => {
  state = { ...state, smtpConfigured: false };
  renderView();
  expect(await screen.findByRole('status')).toHaveTextContent('SMTP belum diatur di server');
});

test('versi usang (412): pesan tampil dan pengaturan dimuat ulang ke data terbaru', async () => {
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serialSettings.save') {
      // Orang lain menyimpan lebih dulu: server kini di v9 dengan satu penerima.
      state = {
        alert: { enabled: true, recipients: ['lain@x.com'] },
        updatedAt: 'v9',
        smtpConfigured: true,
      };
      return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
    }
    return original?.(id, input);
  });
  await userEvent.type(screen.getByLabelText('Email lain'), 'qc@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  const before = calls('serialSettings.get').length;
  await userEvent.click(screen.getByRole('button', { name: 'Simpan pengaturan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  await waitFor(() => expect(calls('serialSettings.get').length).toBeGreaterThan(before));
  // Isian mengikuti data terbaru dan pesan tetap tampil.
  expect(await screen.findByText('lain@x.com')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
});

test('galat FORBIDDEN dari server tetap tampil sebagai pesan', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serialSettings.get'
      ? Promise.reject(
          new ApiError(
            'FORBIDDEN',
            'Pengaturan ini hanya untuk pengelola Serial Number di semua BU',
            '-',
          ),
        )
      : Promise.reject(new Error(`api tak dikenal: ${id}`)),
  );
  renderView();
  expect(await screen.findByRole('alert')).toHaveTextContent('hanya untuk pengelola Serial Number');
});

test('saran penerima dari daftar user hanya bagi yang boleh melihat Akses', async () => {
  me = meWith('view');
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  await waitFor(() => expect(calls('access.users.list').length).toBeGreaterThan(0));
  expect(screen.getByRole('combobox', { name: 'Penerima email' })).toBeInTheDocument();
});

test('tanpa izin Akses daftar user tidak dimuat dan placeholder meminta email manual', async () => {
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  expect(calls('access.users.list')).toHaveLength(0);
});
