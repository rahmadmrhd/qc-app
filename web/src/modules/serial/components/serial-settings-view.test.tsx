import type { MeDto, SerialServiceSettingsDto, SerialSettingsDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { pickLink } from '@/test/link-field';
import { addMailAddress, BCC_FIELD, CC_FIELD, TO_FIELD, typeInMailField } from '@/test/mail-lists';

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
let serviceState: SerialServiceSettingsDto;

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
    countrylock: 'none',
    dashboard: 'none',
  },
  businessUnits: [],
  locations: [],
});

const onCancel = vi.fn();
const onTabChange = vi.fn();

function renderView(tab?: 'email' | 'lokasi') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SerialSettingsView {...(tab ? { tab } : {})} onTabChange={onTabChange} onCancel={onCancel} />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

beforeEach(() => {
  apiMock.mockReset();
  onCancel.mockReset();
  onTabChange.mockReset();
  me = meWith('none');
  state = {
    alert: { enabled: false, recipients: [], cc: [], bcc: [] },
    updatedAt: 'v1',
    smtpConfigured: true,
  };
  serviceState = { locationIds: [], updatedAt: 's1' };
  apiMock.mockImplementation(
    (id: string, input: { alert?: SerialSettingsDto['alert']; locationIds?: string[] }) => {
      switch (id) {
        case 'serialServiceSettings.get':
          return Promise.resolve(structuredClone(serviceState));
        case 'serialServiceSettings.save':
          serviceState = { locationIds: input.locationIds ?? [], updatedAt: 's2' };
          return Promise.resolve(structuredClone(serviceState));
        case 'serials.locationOptions':
          return Promise.resolve({
            locations: [
              { id: 'l1', code: 'JKT', name: 'Jakarta' },
              { id: 'l2', code: 'SBY', name: 'Surabaya' },
            ],
          });
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
    },
  );
});

test('judul, saklar, dan simpan mengirim expectedUpdatedAt dengan penerima email', async () => {
  renderView();
  expect(
    await screen.findByRole('heading', { name: 'Pengaturan Serial Number' }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('checkbox', { name: 'Kirim email saat Serial Number dinyatakan rusak' }),
  );
  await addMailAddress(TO_FIELD, 'qc@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('serialSettings.save')).toHaveLength(1));
  expect(calls('serialSettings.save')[0]?.[1]).toEqual({
    expectedUpdatedAt: 'v1',
    alert: { enabled: true, recipients: ['qc@x.com'], cc: [], bcc: [] },
  });
});

test('CC dan BCC ikut terkirim pada payload simpan', async () => {
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  await addMailAddress(TO_FIELD, 'to@x.com');
  await addMailAddress(CC_FIELD, 'CC@x.com');
  await addMailAddress(BCC_FIELD, 'bcc@x.com');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('serialSettings.save')).toHaveLength(1));
  expect(calls('serialSettings.save')[0]?.[1]).toEqual({
    expectedUpdatedAt: 'v1',
    alert: { enabled: false, recipients: ['to@x.com'], cc: ['cc@x.com'], bcc: ['bcc@x.com'] },
  });
});

test('penerima: alamat tak sah tidak jadi chip, yang sudah dipilih tidak ditawarkan, batas 20', async () => {
  state = {
    ...state,
    alert: {
      enabled: true,
      recipients: Array.from({ length: 20 }, (_, i) => `u${i}@x.com`),
      cc: [],
      bcc: [],
    },
  };
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  await typeInMailField(CC_FIELD, 'bukan-email');
  expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  await userEvent.clear(screen.getByRole('combobox', { name: CC_FIELD }));
  await typeInMailField(CC_FIELD, 'u1@x.com');
  expect(screen.queryByRole('option', { name: 'u1@x.com' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  expect(await screen.findByText(/Maksimal 20 pilihan/)).toBeInTheDocument();
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
        alert: { enabled: true, recipients: ['lain@x.com'], cc: [], bcc: [] },
        updatedAt: 'v9',
        smtpConfigured: true,
      };
      return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
    }
    return original?.(id, input);
  });
  await addMailAddress(TO_FIELD, 'qc@x.com');
  const before = calls('serialSettings.get').length;
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
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
  expect(screen.getByRole('combobox', { name: TO_FIELD })).toBeInTheDocument();
});

test('tanpa izin Akses daftar user tidak dimuat dan placeholder meminta email manual', async () => {
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  expect(calls('access.users.list')).toHaveLength(0);
});

test('lokasi tim servis: dimuat kosong dengan keterangan, dipilih lalu disimpan dengan ETag', async () => {
  renderView('lokasi');
  const form = await screen.findByRole('form', { name: 'Lokasi tim servis' });
  expect(form).toHaveTextContent('Kosong berarti semua lokasi dianggap lokasi servis');
  await pickLink(screen, 'Lokasi tim servis', 'Surabaya (SBY)');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('serialServiceSettings.save')).toHaveLength(1));
  expect(calls('serialServiceSettings.save')[0]?.[1]).toEqual({
    expectedUpdatedAt: 's1',
    locationIds: ['l2'],
  });
  // Versi baru dimuat: isian mengikuti data tersimpan.
  expect(await screen.findByText('Surabaya (SBY)')).toBeInTheDocument();
});

test('lokasi tim servis: lokasi tersimpan yang sudah nonaktif tampil sebagai Lokasi tidak aktif dan bisa dihapus', async () => {
  serviceState = { locationIds: ['l1', 'l-lama'], updatedAt: 's1' };
  renderView('lokasi');
  await screen.findByRole('form', { name: 'Lokasi tim servis' });
  expect(await screen.findByText('Jakarta (JKT)')).toBeInTheDocument();
  expect(screen.getByText('Lokasi tidak aktif')).toBeInTheDocument();
});

test('lokasi tim servis: versi usang (412) menampilkan pesan dan memuat ulang', async () => {
  renderView('lokasi');
  await screen.findByRole('form', { name: 'Lokasi tim servis' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serialServiceSettings.save') {
      serviceState = { locationIds: ['l1'], updatedAt: 's9' };
      return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
    }
    return original?.(id, input);
  });
  await pickLink(screen, 'Lokasi tim servis', 'Surabaya (SBY)');
  const before = calls('serialServiceSettings.get').length;
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  await waitFor(() => expect(calls('serialServiceSettings.get').length).toBeGreaterThan(before));
  expect(await screen.findByText('Jakarta (JKT)')).toBeInTheDocument();
});

test('dua tab: Email rusak dan Lokasi tim servis; klik tab memberi tahu rute dan Batal kembali', async () => {
  renderView();
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  expect(screen.getByRole('tab', { name: 'Email rusak' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('tab', { name: 'Lokasi tim servis' }));
  expect(onTabChange).toHaveBeenCalledWith('lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('Simpan di bar judul mengikuti tab: tab Lokasi menyimpan lokasi, bukan email', async () => {
  renderView('lokasi');
  await screen.findByRole('form', { name: 'Lokasi tim servis' });
  expect(screen.getByRole('button', { name: 'Simpan' })).toHaveAttribute(
    'form',
    'serial-service-settings',
  );
  await pickLink(screen, 'Lokasi tim servis', 'Jakarta (JKT)');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('serialServiceSettings.save')).toHaveLength(1));
  expect(calls('serialSettings.save')).toHaveLength(0);
});

test('Simpan pada tab Email menunjuk form email', async () => {
  renderView('email');
  await screen.findByRole('heading', { name: 'Pengaturan Serial Number' });
  expect(screen.getByRole('button', { name: 'Simpan' })).toHaveAttribute(
    'form',
    'serial-alert-settings',
  );
});
