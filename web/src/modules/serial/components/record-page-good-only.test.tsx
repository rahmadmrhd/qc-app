import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, pickLink } from '@/test/link-field';
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
  proofRequired: false,
  proofMin: 1,
};

interface SavedRow {
  clientId: string;
  serial: string;
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
    if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
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
      serialwh: 'none',
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

async function pickDefaults() {
  await pickLink(screen, 'Item', 'Cisco C9200');
  await expectLinkValue(screen, 'Lokasi', 'Jakarta (JKT)'); // satu lokasi: terkunci dan terisi otomatis
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes('\n')) await userEvent.keyboard('{Enter}');
}

const dataRows = () => screen.getAllByRole('row').slice(1);

test('formulir tidak punya kontrol status atau kerusakan; baris yang disimpan tidak membawa status atau damage', async () => {
  renderPage();
  await pickDefaults();
  expect(screen.queryByLabelText('Status')).toBeNull();
  expect(screen.queryByLabelText('Kerusakan')).toBeNull();
  await paste(['A1', 'B2'].join(String.fromCharCode(10)));
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  expect(screen.queryByLabelText('Kerusakan A1')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByLabelText('Status baris')).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua baris' }));
  expect(screen.queryByLabelText('Status (ubah massal)')).toBeNull();
  expect(screen.queryByLabelText('Kerusakan (ubah massal)')).toBeNull();
  await clickSaveRow(/^Simpan 2 serial/);
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  for (const saved of saveCalls[0] ?? []) {
    expect(saved).not.toHaveProperty('status');
    expect(saved).not.toHaveProperty('damage');
  }
});

test('impor .qcsn memuat baris Lolos; draf 5b berisi baris Tidak lolos tetap tampil sebagai baris bermasalah', async () => {
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
  expect(await screen.findByLabelText('Serial IMP1')).toBeInTheDocument();
  first.unmount();
  const base = {
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
  };
  localStorage.setItem(
    'qc.serial.draft:a@gmail.com',
    JSON.stringify([
      { ...base, clientId: 'row-legacy01', serial: 'OLD1' },
      { ...base, clientId: 'row-legacy02', serial: 'OLD2', status: 'failed', damage: 'Port mati' },
    ]),
  );
  renderPage();
  expect(dataRows()).toHaveLength(2);
  expect(screen.getByLabelText('Serial OLD1')).toBeInTheDocument();
  expect(screen.getByLabelText('Serial OLD2')).toBeInTheDocument();
  expect(screen.getAllByText(/dicatat lewat Lapor Rusak/).length).toBeGreaterThan(0);
});

/** Klik Simpan pada baris/halaman, lalu konfirmasi ringkasan (dialog `alertdialog`) bila tampil. */
async function clickSaveRow(namePattern: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: namePattern }));
  const dialog = screen.queryByRole('alertdialog');
  if (dialog) {
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^(Simpan|Lanjut menyimpan)$/ }),
    );
  }
}
