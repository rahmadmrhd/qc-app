import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink, pickSelect } from '@/test/link-field';
import { addSerials } from '../lib/draft';
import { exportQcsn } from '../lib/qcsn';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const ITEM = {
  id: 'i1',
  label: 'Cisco C9200',
  buIds: ['b1'],
  buOptions: [{ id: 'b1', code: 'BU1' }],
};

interface SavedRow {
  clientId: string;
  serial: string;
  status: string;
  damage?: string;
  source?: string;
}
let saveCalls: SavedRow[][] = [];

beforeEach(() => {
  localStorage.clear();
  saveCalls = [];
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.itemOptions') {
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? [ITEM].filter((item) => ids.includes(item.id)) : [ITEM],
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 's1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.saveBatch') {
      const rows = input.rows as SavedRow[];
      saveCalls.push(rows);
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, result: 'created', message: '' })),
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
  me = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    canManageSerialSettings: false,
    sharedAccount: false,
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

async function pickDefaults() {
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes('\n')) await userEvent.keyboard('{Enter}');
}

const dataRows = () => screen.getAllByRole('row').slice(1);

test('ubah massal tiga baris menjadi Tidak lolos dengan kerusakan; simpan mengirim status failed dan damage', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1\nA2\nA3');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua baris' }));
  expect(screen.getByText('Ubah massal (3 baris terpilih)')).toBeInTheDocument();
  await pickSelect(screen, 'Status (ubah massal)', 'Tidak lolos');
  // Tanpa kerusakan, penerapan ditahan.
  expect(screen.getByRole('button', { name: 'Terapkan ke 3 baris' })).toBeDisabled();
  expect(screen.getByText('Isi kerusakan untuk status Tidak lolos.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Kerusakan (ubah massal)'), 'Port 3 mati');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 3 baris' }));
  for (const serial of ['A1', 'A2', 'A3']) {
    expect(screen.getByLabelText(`Kerusakan ${serial}`)).toHaveValue('Port 3 mati');
  }
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 3 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.map((row) => [row.serial, row.status, row.damage])).toEqual([
    ['A1', 'failed', 'Port 3 mati'],
    ['A2', 'failed', 'Port 3 mati'],
    ['A3', 'failed', 'Port 3 mati'],
  ]);
});

test('bawaan Status Tidak lolos meminta kerusakan dan menurunkannya ke baris baru', async () => {
  renderPage();
  await pickDefaults();
  await pickSelect(screen, 'Status', 'Tidak lolos');
  await userEvent.type(screen.getByLabelText('Kerusakan'), 'LED mati');
  await paste('B1');
  expect(screen.getByLabelText('Kerusakan B1')).toHaveValue('LED mati');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.[0]).toMatchObject({ serial: 'B1', status: 'failed', damage: 'LED mati' });
});

test('baris Tidak lolos tanpa kerusakan ditandai dan simpan ditahan sampai diisi', async () => {
  renderPage();
  await pickDefaults();
  await pickSelect(screen, 'Status', 'Tidak lolos');
  await paste('C1');
  const row = dataRows()[0] as HTMLElement;
  expect(within(row).getByText('Kerusakan belum diisi')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  expect(
    screen.getByText(/1 baris belum lengkap \(item, lokasi, tanggal uji, atau kerusakan\)/),
  ).toBeInTheDocument();
  expect(saveCalls).toHaveLength(0);
  await userEvent.type(screen.getByLabelText('Kerusakan C1'), 'Retak');
  expect(within(dataRows()[0] as HTMLElement).queryByText('Kerusakan belum diisi')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
});

test('baris Lolos tidak mengirim damage; detail baris dapat menjadikannya Tidak lolos', async () => {
  renderPage();
  await pickDefaults();
  await paste('D1');
  await userEvent.click(screen.getByRole('button', { name: 'Detail D1' }));
  const dialog = await screen.findByRole('dialog');
  await pickSelect(within(dialog), 'Status baris', 'Tidak lolos');
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeDisabled());
  expect(within(dialog).getByText('Isi dulu kerusakannya')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Kerusakan'), 'Kipas rusak');
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.click(apply);
  expect(screen.getByLabelText('Kerusakan D1')).toHaveValue('Kipas rusak');
});

test('impor .qcsn baris Tidak lolos mengisi kerusakan; draf lama tanpa status dipulihkan sebagai Lolos', async () => {
  const [row] = addSerials(
    [],
    'IMP1',
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
      status: 'failed',
      damage: 'Port mati',
    },
    () => 'row-import01',
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  const text = await exportQcsn(row ? [row] : [], { name: 'qc-web', version: '1' }, new Date());
  const first = renderPage();
  await userEvent.upload(
    screen.getByLabelText('Impor berkas .qcsn'),
    new File([text], 'serial.qcsn', { type: 'application/json' }),
  );
  expect(await screen.findByLabelText('Kerusakan IMP1')).toHaveValue('Port mati');
  first.unmount();
  localStorage.setItem(
    'qc.serial.draft:a@gmail.com',
    JSON.stringify([
      {
        clientId: 'row-legacy01',
        serial: 'OLD1',
        itemId: 'i1',
        itemLabel: 'Cisco C9200',
        buId: 'b1',
        buLabel: 'BU1',
        testDate: '2026-11-12',
        locationId: 'l1',
        locationLabel: 'Jakarta (JKT)',
        sample: false,
        note: '',
        capturedAt: '2026-11-12T10:00:00.000Z',
        source: 'manual',
        stickers: null,
      },
    ]),
  );
  renderPage();
  const restored = dataRows()[0] as HTMLElement;
  expect(within(restored).getByText('Lolos')).toBeInTheDocument();
  expect(screen.queryByLabelText('Kerusakan OLD1')).toBeNull();
});

test('ubah massal kembali ke Lolos tidak mengirim damage lama', async () => {
  renderPage();
  await pickDefaults();
  await paste('E1\nE2');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua baris' }));
  await pickSelect(screen, 'Status (ubah massal)', 'Tidak lolos');
  await userEvent.type(screen.getByLabelText('Kerusakan (ubah massal)'), 'Port mati');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 2 baris' }));
  expect(screen.getByLabelText('Kerusakan E1')).toHaveValue('Port mati');
  await pickSelect(screen, 'Status (ubah massal)', 'Lolos');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 2 baris' }));
  expect(screen.queryByLabelText('Kerusakan E1')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 2 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  for (const saved of saveCalls[0] ?? []) {
    expect(saved.status).toBe('good');
    expect(saved).not.toHaveProperty('damage');
  }
});
