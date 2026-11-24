import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { addSerials, type StagingRow } from '../lib/draft';
import { saveDraft } from '../lib/draft-store';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const ITEMS = [
  {
    id: 'i1',
    label: 'Cisco C9200',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: false,
    proofMin: 1,
  },
];

let respond: (row: { clientId: string }) => { result: string; message: string };

beforeEach(() => {
  localStorage.clear();
  for (const item of ITEMS) {
    item.proofRequired = false;
    item.proofMin = 1;
  }
  respond = () => ({ result: 'created', message: '' });
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({
        locations: [
          { id: 'l1', code: 'JKT', name: 'Jakarta' },
          { id: 'l2', code: 'SBY', name: 'Surabaya' },
        ],
      });
    }
    if (id === 'serials.itemOptions') {
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? ITEMS.filter((item) => ids.includes(item.id)) : ITEMS,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') return Promise.resolve({ stickers: [] });
    if (id === 'serials.saveBatch') {
      const rows = input.rows as { clientId: string }[];
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, ...respond(row) })),
      });
    }
    if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
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
      dashboard: 'none',
    },
    businessUnits: [],
    locations: [],
  };
});

afterEach(() => {
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

const scanField = () => screen.getByLabelText('Scan atau tempel serial (satu per baris)');

function seedRow(over: Partial<StagingRow>) {
  const [row] = addSerials(
    [],
    'AAA111',
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta (JKT)',
      sample: false,
      note: '',
      stickers: [],
    },
    () => 'id-00000001',
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  if (!row) throw new Error('seed');
  saveDraft('a@gmail.com', [{ ...row, ...over }]);
}

test('Default kosong: kolom scan terkunci dan petunjuk menyebut field yang kosong', async () => {
  renderPage();
  expect(scanField()).toBeDisabled();
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Isi Default dulu: Lokasi, Item, Business Unit',
  );
});

test('petunjuk menyempit sesuai field yang masih kosong dan hilang setelah Default lengkap', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  // Item satu BU: BU otomatis; tinggal Lokasi.
  expect(await screen.findByRole('status')).toHaveTextContent('Isi Default dulu: Lokasi');
  expect(scanField()).toBeDisabled();
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await waitFor(() => expect(scanField()).toBeEnabled());
  expect(screen.queryByText(/Isi Default dulu/)).not.toBeInTheDocument();
});

test('tanggal uji dikosongkan: scan terkunci lagi dan petunjuk menyebut Tanggal uji', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await waitFor(() => expect(scanField()).toBeEnabled());
  await userEvent.clear(screen.getByLabelText('Tanggal uji'));
  expect(scanField()).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Isi Default dulu: Tanggal uji');
});

test('fokus awal ke field Default pertama yang kosong (urutan form: Lokasi lebih dulu)', async () => {
  renderPage();
  await waitFor(() => expect(document.activeElement?.id).toBe('default-location'));
});

test('draft lama tanpa proofMin tetap dimuat dan baris dapat disimpan', async () => {
  seedRow({});
  renderPage();
  expect(await screen.findByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  expect(await screen.findByText(/Dibuat 1/)).toBeInTheDocument();
});

test('baris item wajib foto yang fotonya kurang berstatus "Butuh n foto lagi" dan memblokir Simpan', async () => {
  // Item kini wajib foto (min 2): draft lama tanpa proofMin disegarkan dari server dan baris ditandai.
  for (const item of ITEMS) {
    item.proofRequired = true;
    item.proofMin = 2;
  }
  seedRow({});
  renderPage();
  expect(await screen.findByText('Butuh 2 foto lagi')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(screen.getByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(apiMock.mock.calls.filter((call) => call[0] === 'serials.saveBatch')).toHaveLength(0);
});

test('penolakan server "wajib foto bukti" tampil di baris tanpa mengosongkan foto atau menghilangkan baris', async () => {
  const photo = { id: 'p1', mime: 'image/webp', size: 1, thumbUrl: '/api/v1/serial-proofs/p1' };
  seedRow({ proofPhotos: [photo] });
  respond = () => ({ result: 'invalid', message: 'Item ini wajib foto bukti minimal 2' });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan 1 serial/ }));
  expect(await screen.findByText('Item ini wajib foto bukti minimal 2')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeInTheDocument();
  expect(apiMock.mock.calls.some((call) => call[0] === 'serialProofs.remove')).toBe(false);
});
