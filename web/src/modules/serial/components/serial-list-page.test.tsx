import type { MeDto, SerialSummaryDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
import { type SerialSearch, serialSearchSchema } from '../lib/list-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { SerialListPage } from './serial-list-page';

const row = (over: Partial<SerialSummaryDto>): SerialSummaryDto => ({
  id: 's1',
  buId: 'b1',
  buCode: 'BU1',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Jakarta',
  status: 'good',
  custody: 'qc',
  createdAt: '2026-11-10T03:00:00.000Z',
  ...over,
});

const PAGE_1 = [row({}), row({ id: 's2', serial: 'XYZ789', sample: true, status: 'failed' })];

function Harness({ onOpen = () => undefined }: { onOpen?: (id: string) => void }) {
  const [search, setSearch] = useState<SerialSearch>(serialSearchSchema.parse({}));
  return (
    <SerialListPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      onOpen={onOpen}
    />
  );
}

function renderPage(onOpen?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...(onOpen ? { onOpen } : {})} />
    </QueryClientProvider>,
  );
}

const listCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'serials.list');
const lastListInput = () => listCalls().at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
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
      serial: 'view',
      serialservice: 'none',
    },
    businessUnits: [],
    locations: [
      {
        id: 'l1',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  };
  apiMock.mockImplementation((id: string, input: { cursor?: string }) => {
    if (id === 'serials.list') {
      return Promise.resolve(
        input.cursor
          ? { items: [row({ id: 's3', serial: 'LAST1' })], nextCursor: null }
          : { items: PAGE_1, nextCursor: 'c1' },
      );
    }
    if (id === 'serials.locationOptions') {
      return Promise.resolve({
        locations: [
          { id: 'l1', code: 'JKT', name: 'Jakarta' },
          { id: 'l2', code: 'SBY', name: 'Surabaya' },
        ],
      });
    }
    if (id === 'serials.itemOptions') {
      return Promise.resolve({
        items: [
          { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender baris dengan kolom Test Date, status, posisi, dan sample; paginasi kursor', async () => {
  renderPage();
  expect(await screen.findByText('ABC123')).toBeInTheDocument();
  const rows = screen.getAllByRole('row');
  expect(within(rows[1] as HTMLElement).getByText('10 Nov 2026')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Lolos')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Di QC')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Tidak lolos')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Ya')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Test Date' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('LAST1')).toBeInTheDocument();
  expect(listCalls().at(-1)?.[1]).toMatchObject({ cursor: 'c1' });
});

test('klik serial membuka detail', async () => {
  const onOpen = vi.fn();
  renderPage(onOpen);
  await userEvent.click(await screen.findByRole('button', { name: 'XYZ789' }));
  expect(onOpen).toHaveBeenCalledWith('s2');
});

test('pencarian banyak serial mengirim bentuk ternormalisasi', async () => {
  renderPage();
  await screen.findByText('ABC123');
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: ' abc123 \n4c:5e:0c:1a:2b:3d\nABC123\n' },
  });
  await waitFor(() => expect(lastListInput()).toMatchObject({ serials: 'ABC123\n4C5E0C1A2B3D' }), {
    timeout: 3000,
  });
  expect(lastListInput()).not.toHaveProperty('query');
});

test('satu serial dikirim sebagai awalan (query)', async () => {
  renderPage();
  await screen.findByText('ABC123');
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: 'abc' },
  });
  await waitFor(() => expect(lastListInput()).toMatchObject({ query: 'ABC' }), { timeout: 3000 });
});

test('hasil pindai ditambahkan ke daftar pencarian tanpa duplikat', async () => {
  renderPage();
  await screen.findByText('ABC123');
  const scan = screen.getByLabelText('Pindai untuk mencari');
  await userEvent.type(scan, 'aaa111{Enter}');
  await userEvent.type(scan, 'bbb222{Enter}');
  await userEvent.type(scan, 'AAA111{Enter}');
  expect(screen.getByText('Sudah ada')).toBeInTheDocument();
  expect(screen.getByLabelText('Cari serial (satu per baris)')).toHaveValue('AAA111\nBBB222');
  await waitFor(() => expect(lastListInput()).toMatchObject({ serials: 'AAA111\nBBB222' }), {
    timeout: 3000,
  });
});

test('filter status, lokasi, item, dan rentang tanggal menjadi parameter pencarian', async () => {
  renderPage();
  await screen.findByText('ABC123');
  await pickSelect(screen, 'Filter status', 'Tidak lolos');
  await waitFor(() => expect(lastListInput()).toMatchObject({ status: 'failed' }));
  await pickLink(screen, 'Filter lokasi', 'Jakarta (JKT)');
  await waitFor(() => expect(lastListInput()).toMatchObject({ locationId: 'l1' }));
  await pickLink(screen, 'Filter item', 'Cisco C9200');
  await waitFor(() => expect(lastListInput()).toMatchObject({ itemId: 'i1' }));
  fireEvent.change(screen.getByLabelText('Tanggal uji dari'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('Tanggal uji sampai'), {
    target: { value: '2026-11-30' },
  });
  await waitFor(() =>
    expect(lastListInput()).toMatchObject({
      status: 'failed',
      locationId: 'l1',
      itemId: 'i1',
      from: '2026-11-01',
      to: '2026-11-30',
    }),
  );
});

test('tanpa hasil menampilkan pesan kosong', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({ items: [], nextCursor: null })
      : Promise.resolve({ items: [], nextCursor: null }),
  );
  renderPage();
  expect(await screen.findByText('Tidak ada serial yang cocok.')).toBeInTheDocument();
});

test('tempelan melebihi batas: pesan jelas, hanya serial pertama yang dicari', async () => {
  renderPage();
  await screen.findByText('ABC123');
  const many = Array.from({ length: 57 }, (_, index) => `S${index}`).join(String.fromCharCode(10));
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: many },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'hanya 50 serial pertama yang dicari, 7 serial lain diabaikan',
  );
  await waitFor(
    () =>
      expect((lastListInput().serials as string).split(String.fromCharCode(10))).toHaveLength(50),
    { timeout: 3000 },
  );
});

test('pembaca tanpa serial: edit tidak memanggil serials.locationOptions; filter lokasi memakai lokasi miliknya', async () => {
  renderPage();
  await screen.findByText('ABC123');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('pembaca serialservice: view juga tidak memanggil serials.locationOptions', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'none', serialservice: 'view' } };
  renderPage();
  await screen.findByText('ABC123');
  await linkOptionNames(screen, 'Filter lokasi');
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('editor (serial: edit) memuat semua lokasi aktif dari serials.locationOptions', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'edit' } };
  renderPage();
  await screen.findByText('ABC123');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)', 'Surabaya (SBY)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(true);
});
