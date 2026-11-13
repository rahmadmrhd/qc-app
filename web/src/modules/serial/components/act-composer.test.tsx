import type { MeDto, SerialDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
// Editor Tiptap tidak dapat diketik di jsdom: diganti kolom teks.
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    labelledBy?: string;
    mode?: string;
    maxImages?: number;
  }) => (
    <textarea
      id={props.id}
      aria-labelledby={props.labelledBy}
      data-mode={props.mode}
      data-max-images={props.maxImages}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { ActComposer } from './act-composer';

type Level = 'none' | 'view' | 'edit' | 'manage';

function meWith(serial: Level, serialservice: Level = 'none'): MeDto {
  return {
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
      serial,
      serialservice,
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial, serialservice },
      },
    ],
    locations: [],
  };
}

const SERIAL: SerialDto = {
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
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: null,
  createdAt: '2026-11-10T03:00:00.000Z',
  note: '',
  recordedLocationId: 'l1',
  stickers: [{ stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'active' }],
  openCaseId: null,
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'budi@x.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'budi@x.com',
};

const CASE = {
  id: 'c1',
  number: 'LP-20261113-001',
  openedOn: '2026-11-13',
  closedOn: null,
  damage: 'Port mati',
  outcome: null,
} as const;

function renderComposer(serial: SerialDto, client?: QueryClient) {
  client ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActComposer serial={serial} />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

async function optionNames(field: string): Promise<string[]> {
  const names = await linkOptionNames(screen, field);
  await userEvent.keyboard('{Escape}');
  return names;
}

beforeEach(() => {
  apiMock.mockReset();
  me = meWith('edit');
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.act') return Promise.resolve({ ...SERIAL, updatedAt: 'baru' });
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.locationOptions') {
      return Promise.resolve({
        locations: [
          { id: 'l1', code: 'JKT', name: 'Jakarta' },
          { id: 'l2', code: 'SBY', name: 'Surabaya' },
        ],
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('serial: edit pada Lolos di QC: Catatan, Cek ulang, Laporkan tidak lolos, Kirim antar lokasi', async () => {
  const { container } = renderComposer(SERIAL);
  expect(await optionNames('Jenis update')).toEqual([
    'Catatan',
    'Cek ulang',
    'Laporkan tidak lolos',
    'Kirim antar lokasi',
  ]);
  expect(container.querySelector('select, option')).toBeNull();
});

test('serialservice pada Di servis/dalam pengiriman: hanya Terima di servis dan Catatan', async () => {
  me = meWith('none', 'edit');
  renderComposer({ ...SERIAL, status: 'at_service', custody: 'transit', transitOn: '2026-11-10' });
  expect(await optionNames('Jenis update')).toEqual(['Catatan', 'Terima di servis']);
});

test('serialservice pada serial Lolos dan serial: view tidak melihat kotak update', () => {
  me = meWith('none', 'edit');
  const { unmount } = renderComposer(SERIAL);
  expect(screen.queryByRole('region', { name: 'Update baru' })).toBeNull();
  unmount();
  me = meWith('view');
  renderComposer(SERIAL);
  expect(screen.queryByRole('region', { name: 'Update baru' })).toBeNull();
});

test('serial Rusak: pemegang serial: edit hanya bisa Catatan', async () => {
  renderComposer({ ...SERIAL, status: 'broken', custody: 'service' });
  expect(await optionNames('Jenis update')).toEqual(['Catatan']);
});

test('Laporkan tidak lolos: kerusakan wajib; payload hanya memuat damage', async () => {
  renderComposer(SERIAL);
  await pickSelect(screen, 'Jenis update', 'Laporkan tidak lolos');
  const send = screen.getByRole('button', { name: 'Laporkan tidak lolos' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Kerusakan'), 'Port 3 mati');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  const input = calls('serials.act')[0]?.[1];
  expect(input).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    action: 'report_failure',
    damage: 'Port 3 mati',
    message: '',
  });
  expect(Object.keys(input).sort()).toEqual(
    ['action', 'damage', 'expectedUpdatedAt', 'id', 'message', 'occurredOn'].sort(),
  );
});

test('Kirim antar lokasi: tujuan dan catatan pengiriman dikirim; tujuan sama dengan lokasi sekarang ditolak', async () => {
  renderComposer(SERIAL);
  await pickSelect(screen, 'Jenis update', 'Kirim antar lokasi');
  const send = screen.getByRole('button', { name: 'Kirim antar lokasi' });
  expect(send).toBeDisabled();
  await pickLink(screen, 'Lokasi tujuan', 'Jakarta (JKT)');
  expect(screen.getByText('Lokasi tujuan harus beda dengan lokasi sekarang')).toBeInTheDocument();
  expect(send).toBeDisabled();
  await pickLink(screen, 'Lokasi tujuan', 'Surabaya (SBY)');
  await userEvent.type(screen.getByLabelText('Catatan pengiriman (opsional)'), 'JNE resi 99');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    action: 'send',
    toLocationId: 'l2',
    shipmentNote: 'JNE resi 99',
  });
});

test('Cek ulang Tidak lolos: kerusakan wajib dan dikirim bersama result fail', async () => {
  renderComposer(SERIAL);
  await pickSelect(screen, 'Jenis update', 'Cek ulang');
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  const save = screen.getByRole('button', { name: 'Simpan cek ulang' });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Kerusakan'), 'LED mati');
  await userEvent.click(save);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    action: 'recheck',
    result: 'fail',
    damage: 'LED mati',
  });
});

test('Cek ulang Lolos tidak mengirim result maupun damage', async () => {
  renderComposer(SERIAL);
  await pickSelect(screen, 'Jenis update', 'Cek ulang');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  const input = calls('serials.act')[0]?.[1];
  expect(input.result).toBeUndefined();
  expect(input.damage).toBeUndefined();
  expect(input.action).toBe('recheck');
});

test('Perbarui kerusakan: isian awal dari kasus terbuka', async () => {
  renderComposer({ ...SERIAL, status: 'failed', openCaseId: 'c1', openCase: CASE });
  await pickSelect(screen, 'Jenis update', 'Perbarui kerusakan');
  expect(screen.getByLabelText('Kerusakan')).toHaveValue('Port mati');
});

test('Cek ulang lolos dari Perbaikan QC: lokasi dan stiker ikut, kerusakan tidak', async () => {
  renderComposer({ ...SERIAL, status: 'qc_repair', openCaseId: 'c1', openCase: CASE });
  await pickSelect(screen, 'Jenis update', 'Cek ulang: lolos');
  expect(screen.queryByLabelText(/Kerusakan/)).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Lokasi cek ulang' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Tambah Stiker A' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cek ulang: lolos' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({ action: 'recheck_pass', locationId: 'l1' });
});

test('Terima: tujuan sudah ditetapkan; tanggal sebelum tanggal kirim ditolak di klien', async () => {
  const transit: SerialDto = {
    ...SERIAL,
    status: 'recheck',
    custody: 'transit',
    transitFromLocationId: 'l2',
    transitFromLocationName: 'Surabaya',
    transitToLocationId: 'l1',
    transitToLocationName: 'Jakarta',
    transitOn: '2026-11-10',
    openCaseId: 'c1',
    openCase: CASE,
  };
  renderComposer(transit);
  await pickSelect(screen, 'Jenis update', 'Terima di QC');
  expect(screen.getByText(/Diterima di/)).toHaveTextContent('Jakarta');
  expect(screen.queryByRole('combobox', { name: 'Lokasi tujuan' })).toBeNull();
  const date = screen.getByLabelText('Tanggal');
  expect(date).toHaveAttribute('min', '2026-11-10');
  await userEvent.clear(date);
  await userEvent.type(date, '2026-11-09');
  expect(screen.getByText('Tanggal terima tidak boleh sebelum tanggal kirim')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Terima di QC' })).toBeDisabled();
});

test('galat server pada occurredOn tampil di bawah kolom tanggal', async () => {
  const transit: SerialDto = {
    ...SERIAL,
    status: 'at_service',
    custody: 'transit',
    transitToLocationName: 'Surabaya',
    transitOn: '2026-11-10',
  };
  me = meWith('none', 'edit');
  renderComposer(transit);
  await pickSelect(screen, 'Jenis update', 'Terima di servis');
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: unknown) =>
    id === 'serials.act'
      ? Promise.reject(
          new ApiError('VALIDATION', 'Data tidak valid', '-', {
            occurredOn: 'Tanggal terima tidak boleh sebelum tanggal kirim',
          }),
        )
      : original?.(id, input),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Terima di servis' }));
  expect(
    await screen.findByText('Tanggal terima tidak boleh sebelum tanggal kirim'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('Nyatakan rusak meminta konfirmasi; batal tidak mengirim, lanjut mengirim', async () => {
  me = meWith('none', 'edit');
  renderComposer({
    ...SERIAL,
    status: 'service_repair',
    custody: 'service',
    openCaseId: 'c1',
    openCase: CASE,
  });
  await pickSelect(screen, 'Jenis update', 'Nyatakan rusak');
  await userEvent.click(screen.getByRole('button', { name: 'Nyatakan rusak' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent(
    'Serial Number ini akan ditandai rusak dan email dikirim ke penerima',
  );
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(calls('serials.act')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Nyatakan rusak' }));
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Ya, nyatakan rusak',
    }),
  );
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({ action: 'declare_broken' });
});

test('pesan: editor mode message dengan batas gambar; gambar melebihi batas menahan kirim', async () => {
  renderComposer(SERIAL);
  const editor = screen.getByRole('textbox', { name: 'Catatan' });
  expect(editor).toHaveAttribute('data-mode', 'message');
  expect(editor).toHaveAttribute('data-max-images', '10');
  const images = Array.from({ length: 11 }, (_, index) => `![g](qcfile:f${index})`).join(' ');
  await userEvent.click(editor);
  await userEvent.paste(images);
  expect(screen.getByText('Maksimal 10 gambar per pesan')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kirim catatan' })).toBeDisabled();
});

test('versi usang (412) memuat ulang dan mempertahankan pesan', async () => {
  renderComposer(SERIAL);
  apiMock.mockImplementation((id: string) =>
    id === 'serials.act'
      ? Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }))
      : Promise.resolve({ stickers: [], locations: [] }),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveValue('halo');
});

test('versi usang (412) juga memuat ulang riwayat serial, bukan hanya kepala', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  renderComposer(SERIAL, client);
  apiMock.mockImplementation((id: string) =>
    id === 'serials.act'
      ? Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }))
      : Promise.resolve({ stickers: [], locations: [] }),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  await screen.findByRole('alert');
  const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
  expect(keys).toContainEqual(['serial', 'one', 's1']);
  expect(keys).toContainEqual(['serial', 'history', 's1']);
});

test('setelah sukses isian dikosongkan dan pilihan aksi kembali ke Catatan', async () => {
  renderComposer(SERIAL);
  await pickSelect(screen, 'Jenis update', 'Laporkan tidak lolos');
  await userEvent.type(screen.getByLabelText('Kerusakan'), 'Port 3 mati');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Catatan (opsional)' }),
    'foto menyusul',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Laporkan tidak lolos' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  // Kembali ke Catatan: tanpa kolom kerusakan, pesan kosong.
  await waitFor(() => expect(screen.queryByLabelText('Kerusakan')).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveValue('');
  await pickSelect(screen, 'Jenis update', 'Laporkan tidak lolos');
  expect(screen.getByLabelText('Kerusakan')).toHaveValue('');
});

test('ganti aksi mengosongkan isian aksi sebelumnya (kerusakan, tujuan, pesan)', async () => {
  renderComposer(SERIAL);
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'draf pesan');
  await pickSelect(screen, 'Jenis update', 'Laporkan tidak lolos');
  expect(screen.getByRole('textbox', { name: 'Catatan (opsional)' })).toHaveValue('');
  await userEvent.type(screen.getByLabelText('Kerusakan'), 'Retak');
  await pickSelect(screen, 'Jenis update', 'Kirim antar lokasi');
  await pickLink(screen, 'Lokasi tujuan', 'Surabaya (SBY)');
  await pickSelect(screen, 'Jenis update', 'Laporkan tidak lolos');
  expect(screen.getByLabelText('Kerusakan')).toHaveValue('');
  await pickSelect(screen, 'Jenis update', 'Kirim antar lokasi');
  expect(screen.getByRole('button', { name: 'Kirim antar lokasi' })).toBeDisabled();
});

test('servis mengirim balik ke QC: pemilih tujuan memuat lokasi dan tujuan ikut ke payload', async () => {
  me = meWith('none', 'edit');
  renderComposer({
    ...SERIAL,
    status: 'service_repair',
    custody: 'service',
    openCaseId: 'c1',
    openCase: CASE,
  });
  const names = await optionNames('Jenis update');
  const label = names.find((name) => name.startsWith('Kirim')) ?? '';
  expect(label).not.toBe('');
  await pickSelect(screen, 'Jenis update', label);
  await pickLink(screen, 'Lokasi tujuan', 'Surabaya (SBY)');
  expect(calls('serials.locationOptions').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({ action: 'send', toLocationId: 'l2' });
});

test.each([
  ['FORBIDDEN', 'Aksi ini bukan bagian tim Anda'],
  ['CONFLICT', 'Keadaan Serial Number sudah berubah'],
])('galat umum %s dari serials.act tampil sebagai pesan di komposer', async (code, text) => {
  renderComposer(SERIAL);
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: unknown) =>
    id === 'serials.act'
      ? Promise.reject(new ApiError(code as never, text, '-'))
      : original?.(id, input),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
});

test('rujukan gambar qcfile di pesan ikut ke payload serials.act (editor diganti kolom teks: tingkat payload)', async () => {
  renderComposer(SERIAL);
  await userEvent.click(screen.getByRole('textbox', { name: 'Catatan' }));
  await userEvent.paste('Foto: ![kerusakan](qcfile:abc123) dan ![b](qcfile:def456)');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  const payload = calls('serials.act')[0]?.[1] as { message: string };
  const message = payload.message;
  expect(message).toContain('qcfile:abc123');
  expect(message).toContain('qcfile:def456');
});
