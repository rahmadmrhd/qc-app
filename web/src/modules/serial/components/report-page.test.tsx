import type { MeDto, SerialLookupMatchDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { pickLink } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    labelledBy?: string;
  }) => (
    <textarea
      id={props.id}
      aria-labelledby={props.labelledBy}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { ReportPage } from './report-page';

function meWith(): MeDto {
  return {
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
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [],
    locations: [],
  };
}

const MATCH: SerialLookupMatchDto = {
  id: 's1',
  buId: 'b1',
  buCode: 'BU1',
  itemLabel: 'Cisco C9200',
  serial: 'ABC123',
  status: 'good',
  custody: 'qc',
  locationName: 'Jakarta',
  openCaseId: null,
  openCaseNumber: null,
  updatedAt: '2026-11-11T03:00:00.000Z',
};

let matches: SerialLookupMatchDto[];
let elsewhere: { buCode: string } | null;
const onOpenSerial = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportPage onOpenSerial={onOpenSerial} onCancel={() => undefined} />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

async function search(text: string) {
  await userEvent.type(screen.getByLabelText('Serial Number'), `${text}{Enter}`);
}

beforeEach(() => {
  apiMock.mockReset();
  onOpenSerial.mockReset();
  me = meWith();
  matches = [];
  elsewhere = null;
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.lookup') return Promise.resolve({ matches, elsewhere });
    if (id === 'serials.act') return Promise.resolve({ ...MATCH, id: 's1', updatedAt: 'baru' });
    if (id === 'serials.reportNew') {
      return Promise.resolve({ ...MATCH, id: 's9', serial: input.serial, status: 'reported' });
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
          {
            id: 'i2',
            label: 'Aruba 2930',
            buIds: ['b1', 'b2'],
            buOptions: [
              { id: 'b1', code: 'BU1' },
              { id: 'b2', code: 'BU2' },
            ],
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('Serial Lolos ditemukan: ringkasan unit, catatan wajib, lalu laporan dibuka dan pindah ke detail', async () => {
  matches = [MATCH];
  renderPage();
  await search('abc123');
  // Dicocokkan dengan bentuk ternormalisasi (huruf besar).
  await waitFor(() => expect(calls('serials.lookup')[0]?.[1]).toEqual({ serial: 'ABC123' }));
  expect(await screen.findByText('Cisco C9200')).toBeInTheDocument();
  expect(screen.getByText('Lolos · Jakarta')).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Lapor rusak' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Port 3 mati');
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    action: 'report_failure',
    message: 'Port 3 mati',
  });
  await waitFor(() => expect(onOpenSerial).toHaveBeenCalledWith('s1'));
});

test('serial dengan laporan aktif ditolak dengan tautan ke laporan itu; tidak ada formulir', async () => {
  matches = [
    {
      ...MATCH,
      status: 'reported',
      openCaseId: 'c1',
      openCaseNumber: 'LP/SBY/2611-0001',
    },
  ];
  renderPage();
  await search('ABC123');
  expect(
    await screen.findByText(/Serial ini sudah punya laporan aktif \(LP\/SBY\/2611-0001\)/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Catatan' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Buka LP/SBY/2611-0001' }));
  expect(onOpenSerial).toHaveBeenCalledWith('s1', 'c1');
  expect(calls('serials.act')).toHaveLength(0);
});

test('serial Rusak ditolak: Unit ini sudah dinyatakan rusak', async () => {
  matches = [{ ...MATCH, status: 'broken', custody: 'service' }];
  renderPage();
  await search('ABC123');
  expect(await screen.findByText(/Unit ini sudah dinyatakan rusak/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lapor rusak' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Buka Serial Number ini' }));
  expect(onOpenSerial).toHaveBeenCalledWith('s1');
});

test('serial ada di BU yang tidak boleh Anda tulis: peringatan dengan kode BU itu, tanpa formulir dan tombol kirim nonaktif', async () => {
  matches = [];
  elsewhere = { buCode: 'BU7' };
  renderPage();
  await search('ABC123');
  expect(
    await screen.findByText(
      'Serial ini ada di BU BU7 dan Anda tidak punya akses untuk melaporkannya.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lapor rusak' })).toBeDisabled();
  expect(screen.queryByRole('textbox', { name: 'Catatan' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Item' })).toBeNull();
});

test('tidak ada pemilih BU: satu kecocokan langsung menampilkan formulir', async () => {
  matches = [MATCH];
  renderPage();
  await search('ABC123');
  expect(await screen.findByRole('textbox', { name: 'Catatan' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Business Unit' })).toBeNull();
});

test('belum tercatat: item, lokasi, dan catatan wajib; reportNew dikirim dan pindah ke detail', async () => {
  matches = [];
  renderPage();
  await search('NEW-9');
  expect(
    await screen.findByRole('region', { name: 'Serial Number belum tercatat' }),
  ).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Lapor rusak' });
  expect(send).toBeDisabled();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Surabaya (SBY)');
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Dus penyok, unit mati');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.reportNew')).toHaveLength(1));
  const input = calls('serials.reportNew')[0]?.[1];
  expect(input).toMatchObject({
    serial: 'NEW-9',
    itemId: 'i1',
    buId: 'b1',
    locationId: 'l2',
    message: 'Dus penyok, unit mati',
  });
  expect(input.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await waitFor(() => expect(onOpenSerial).toHaveBeenCalledWith('s9'));
});

test('belum tercatat: Enter di kolom Item/Lokasi (daftar tertutup) tidak mengirim laporan; hanya tombol yang mengirim', async () => {
  matches = [];
  renderPage();
  await search('NEW-8');
  await screen.findByRole('region', { name: 'Serial Number belum tercatat' });
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Surabaya (SBY)');
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Unit mati');
  const send = screen.getByRole('button', { name: 'Lapor rusak' });
  expect(send).toBeEnabled();
  for (const field of ['Item', 'Lokasi']) {
    const box = screen.getByRole('combobox', { name: field });
    box.focus();
    await userEvent.keyboard('{Escape}');
    // Enter ditahan (preventDefault) sehingga peramban tak mengirim form lewat pengiriman implisit; user-event tidak
    // meniru pengiriman implisit untuk tombol di luar form, jadi yang diperiksa adalah peristiwanya.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    await userEvent.keyboard('{Enter}');
  }
  // Enter di editor catatan (bukan `input`) tidak ditahan: tetap baris baru.
  expect(
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Catatan' }), { key: 'Enter' }),
  ).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls('serials.reportNew')).toHaveLength(0);
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.reportNew')).toHaveLength(1));
});

test('belum tercatat: item di dua BU = memilih BU dulu', async () => {
  renderPage();
  await search('NEW-9');
  await screen.findByRole('region', { name: 'Serial Number belum tercatat' });
  await pickLink(screen, 'Item', 'Aruba 2930');
  expect(screen.getByRole('combobox', { name: 'Business Unit' })).toBeInTheDocument();
  await pickLink(screen, 'Business Unit', 'BU2');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'mati');
  await userEvent.click(screen.getByRole('button', { name: 'Lapor rusak' }));
  await waitFor(() => expect(calls('serials.reportNew')).toHaveLength(1));
  expect(calls('serials.reportNew')[0]?.[1]).toMatchObject({ itemId: 'i2', buId: 'b2' });
});

test('galat CONFLICT serentak: pesan jelas tampil dan pencarian dimuat ulang', async () => {
  matches = [MATCH];
  renderPage();
  await search('ABC123');
  await screen.findByText('Cisco C9200');
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.act'
      ? Promise.reject(
          new ApiError(
            'CONFLICT',
            'Serial Number ini sudah punya laporan aktif (LP/SBY/2611-0002)',
            '-',
          ),
        )
      : original?.(id, input),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'rusak');
  const before = calls('serials.lookup').length;
  await userEvent.click(screen.getByRole('button', { name: 'Lapor rusak' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('sudah punya laporan aktif');
  await waitFor(() => expect(calls('serials.lookup').length).toBeGreaterThan(before));
  expect(onOpenSerial).not.toHaveBeenCalled();
});

test('serial baru yang ternyata sudah terdaftar: pesan generik tanpa menyebut BU lain', async () => {
  renderPage();
  await search('NEW-9');
  await screen.findByRole('region', { name: 'Serial Number belum tercatat' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.reportNew'
      ? Promise.reject(
          new ApiError(
            'CONFLICT',
            'Serial Number sudah terdaftar, cari dulu lewat kolom Serial Number',
            '-',
          ),
        )
      : original?.(id, input),
  );
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'mati');
  await userEvent.click(screen.getByRole('button', { name: 'Lapor rusak' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Serial Number sudah terdaftar');
});

test('tempelan banyak baris memakai serial pertama dan memberi tahu', async () => {
  matches = [MATCH];
  renderPage();
  await userEvent.click(screen.getByLabelText('Serial Number'));
  await userEvent.paste('ABC123\nXYZ9');
  await waitFor(() => expect(calls('serials.lookup')[0]?.[1]).toEqual({ serial: 'ABC123' }));
  expect(screen.getByText(/yang dipakai ABC123/)).toBeInTheDocument();
});

test('judul Lapor Rusak ada di kerangka judul (bar headroom) dengan target panduan di bawahnya', async () => {
  renderPage();
  const heading = await screen.findByRole('heading', { name: 'Lapor Rusak' });
  expect(heading.closest('[data-headroom-frame]')).not.toBeNull();
  expect(document.querySelector('[data-tour="report-serial"]')).not.toBeNull();
});

test('FormPage: judul Lapor Rusak, Batal memanggil onCancel, Lapor rusak nonaktif sebelum ada form', async () => {
  const onCancel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReportPage onOpenSerial={onOpenSerial} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Lapor Rusak' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lapor rusak' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
