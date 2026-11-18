import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { pickLink } from '@/test/link-field';
import { addSerials } from '../lib/draft';
import { clearAllDrafts, resumeDraftWrites, saveDraft } from '../lib/draft-store';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const JAKARTA = { id: 'l1', code: 'JKT', name: 'Jakarta' };
const SURABAYA = { id: 'l2', code: 'SBY', name: 'Surabaya' };

function installApi(locations: { id: string; code: string; name: string }[]) {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.locationOptions') return Promise.resolve({ locations });
    if (id === 'serials.itemOptions') return Promise.resolve({ items: [], nextCursor: null });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
}

beforeEach(() => {
  localStorage.clear();
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'edit',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [],
  };
});

afterEach(() => {
  clearAllDrafts();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActiveLocationsProvider>
        <RecordPage />
      </ActiveLocationsProvider>
    </QueryClientProvider>,
  );
}

const access = (location: { id: string; code: string; name: string }) =>
  ({ ...location, permissions: {} }) as unknown as MeDto['locations'][number];

const locationOptionsCalled = () =>
  apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions');
const field = () => screen.getByRole('combobox', { name: 'Lokasi' });

test('hanya satu lokasi yang dapat dipilih: terisi otomatis dan TERKUNCI (tidak dapat diubah)', async () => {
  installApi([JAKARTA]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
  expect(field()).toBeDisabled();
  expect(screen.getByTestId('default-location-lock')).toHaveTextContent(
    'Hanya satu lokasi yang bisa dipilih: Jakarta (JKT)',
  );
  // Tidak ada tombol kosongkan pada field yang terkunci.
  expect(screen.queryByRole('button', { name: 'Kosongkan Lokasi' })).not.toBeInTheDocument();
});

test('dua lokasi dapat dipilih dan tidak ada lokasi aktif tunggal: field bebas dan kosong', async () => {
  installApi([JAKARTA, SURABAYA]);
  me = { ...me, locations: [access(JAKARTA), access(SURABAYA)] };
  renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toHaveValue('');
  expect(field()).toBeEnabled();
  expect(screen.queryByTestId('default-location-lock')).not.toBeInTheDocument();
  await pickLink(screen, 'Lokasi', 'Surabaya (SBY)');
  expect(field()).toHaveValue('Surabaya (SBY)');
});

test('nol lokasi: bawaan tetap kosong dan tidak terkunci', async () => {
  installApi([]);
  renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toHaveValue('');
  expect(field()).toBeEnabled();
});

test('lokasi aktif di header tepat satu: Lokasi terkunci ke lokasi itu walau ada lokasi lain', async () => {
  localStorage.setItem('qc.locations', JSON.stringify(['l2']));
  installApi([JAKARTA, SURABAYA]);
  me = { ...me, locations: [access(JAKARTA), access(SURABAYA)] };
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Surabaya (SBY)'));
  expect(field()).toBeDisabled();
  expect(screen.getByTestId('default-location-lock')).toHaveTextContent(
    'Terkunci ke lokasi aktif: Surabaya (SBY)',
  );
});

test('dua lokasi aktif di header: tidak terkunci', async () => {
  localStorage.setItem('qc.locations', JSON.stringify(['l1', 'l2']));
  installApi([JAKARTA, SURABAYA]);
  me = { ...me, locations: [access(JAKARTA), access(SURABAYA)] };
  renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toBeEnabled();
  expect(field()).toHaveValue('');
});

test('lokasi aktif tunggal yang tidak termasuk pilihan lokasi: tidak dikunci ke lokasi itu', async () => {
  localStorage.setItem('qc.locations', JSON.stringify(['l9']));
  installApi([JAKARTA, SURABAYA]);
  me = { ...me, locations: [access({ id: 'l9', code: 'MDN', name: 'Medan' })] };
  renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toBeEnabled();
  expect(field()).toHaveValue('');
});

test('lokasi terkunci dihitung terisi: gerbang Default tidak menyebut Lokasi', async () => {
  installApi([JAKARTA]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Isi Default dulu: Item, Business Unit',
  );
  expect(screen.getByRole('status')).not.toHaveTextContent('Lokasi');
});

test('draf berlokasi tidak ditimpa: baris draf tetap memakai lokasinya sendiri', async () => {
  installApi([JAKARTA]);
  const { rows } = addSerials(
    [],
    'DRAFT1',
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l9',
      locationLabel: 'Medan (MDN)',
      sample: false,
      note: '',
    },
    () => 'row-00000001',
    () => '2026-11-12T10:00:00.000Z',
  );
  resumeDraftWrites();
  saveDraft('a@gmail.com', rows);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
  expect(screen.getByText('Medan (MDN)')).toBeInTheDocument();
  expect(screen.getAllByDisplayValue('Jakarta (JKT)')).toHaveLength(1);
});

test('pembaca non-editor memakai me.locations: satu lokasi juga terkunci', async () => {
  me = {
    ...me,
    permissions: { ...me.permissions, serial: 'view' },
    locations: [access(JAKARTA)],
  };
  installApi([]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
  expect(field()).toBeDisabled();
});
