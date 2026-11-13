import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
      <RecordPage />
    </QueryClientProvider>,
  );
}

const locationOptionsCalled = () =>
  apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions');
const field = () => screen.getByRole('combobox', { name: 'Lokasi' });

test('hanya satu lokasi tersedia: otomatis menjadi bawaan rombongan', async () => {
  installApi([JAKARTA]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
});

test('dua lokasi atau lebih, atau nol: bawaan tetap kosong', async () => {
  installApi([JAKARTA, SURABAYA]);
  const view = renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toHaveValue('');
  view.unmount();

  apiMock.mockReset();
  installApi([]);
  renderPage();
  await waitFor(() => expect(locationOptionsCalled()).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toHaveValue('');
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
      status: 'good',
      damage: '',
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

test('dikosongkan manual: tidak terisi lagi', async () => {
  installApi([JAKARTA]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Lokasi' }));
  await waitFor(() => expect(field()).toHaveValue(''));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(field()).toHaveValue('');
  // Memilih ulang tetap bisa.
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  expect(field()).toHaveValue('Jakarta (JKT)');
});

test('pembaca non-editor memakai me.locations: satu lokasi juga menjadi bawaan', async () => {
  me = {
    ...me,
    permissions: { ...me.permissions, serial: 'view' },
    locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] as MeDto['locations'],
  };
  installApi([]);
  renderPage();
  await waitFor(() => expect(field()).toHaveValue('Jakarta (JKT)'));
});
