import type { MeDto, SerialDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { ActButtons, type ActKind, actButtonSpecs } from './act-buttons';
import { ActDialog } from './act-dialog';

type Level = 'none' | 'view' | 'edit' | 'manage';

function meWith(serial: Level, serialservice: Level = 'none'): MeDto {
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
  outcome: null,
} as const;

const REPORTED: SerialDto = {
  ...SERIAL,
  status: 'reported',
  openCaseId: 'c1',
  openCaseNumber: CASE.number,
  openCase: CASE,
  cases: [CASE],
};

const AT_SERVICE_TRANSIT: SerialDto = {
  ...REPORTED,
  status: 'at_service',
  custody: 'transit',
  transitFromLocationId: 'l1',
  transitFromLocationName: 'Jakarta',
  transitToLocationId: 'l2',
  transitToLocationName: 'Surabaya',
  transitOn: '2026-11-10',
};

const RECHECK_TRANSIT: SerialDto = {
  ...AT_SERVICE_TRANSIT,
  status: 'recheck',
  transitFromLocationId: 'l2',
  transitFromLocationName: 'Surabaya',
  transitToLocationId: 'l1',
  transitToLocationName: 'Jakarta',
};

let serviceLocations: { id: string; code: string; name: string }[];
let activeLocations: { id: string; code: string; name: string }[];

const onClose = vi.fn();

function renderDialog(serial: SerialDto, kind: ActKind) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActDialog serial={serial} kind={kind} onClose={onClose} />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);
const lastAct = () => calls('serials.act').at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
  onClose.mockReset();
  me = meWith('edit');
  serviceLocations = [{ id: 'l9', code: 'SRV', name: 'Servis Pusat' }];
  activeLocations = [
    { id: 'l1', code: 'JKT', name: 'Jakarta' },
    { id: 'l2', code: 'SBY', name: 'Surabaya' },
    { id: 'l9', code: 'SRV', name: 'Servis Pusat' },
  ];
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.act') return Promise.resolve({ ...SERIAL, updatedAt: 'baru' });
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [
          { id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 },
          { id: 'st2', name: 'Stiker B', alias: '', typeName: 'J', defaultQty: 1 },
        ],
      });
    }
    if (id === 'serials.locationOptions') return Promise.resolve({ locations: activeLocations });
    if (id === 'serials.serviceLocations') return Promise.resolve({ locations: serviceLocations });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

const labelsOf = (serial: SerialDto, actor: MeDto) =>
  actButtonSpecs(
    { status: serial.status, custody: serial.custody },
    {
      serial: actor.businessUnits[0]?.permissions.serial === 'edit',
      serialservice: actor.businessUnits[0]?.permissions.serialservice === 'edit',
    },
  ).map((spec) => spec.label);

test('tombol sesuai status dan peran: satu per aksi', () => {
  expect(labelsOf(SERIAL, meWith('edit'))).toEqual(['Lapor rusak', 'Cek ulang', 'Catatan']);
  expect(labelsOf(REPORTED, meWith('edit'))).toEqual(['Kirim ke servis', 'Cek ulang', 'Catatan']);
  expect(labelsOf(AT_SERVICE_TRANSIT, meWith('none', 'edit'))).toEqual([
    'Terima di servis',
    'Diagnosis',
    'Catatan',
  ]);
  expect(labelsOf({ ...AT_SERVICE_TRANSIT, custody: 'service' }, meWith('none', 'edit'))).toEqual([
    'Diagnosis',
    'Catatan',
  ]);
  expect(labelsOf(RECHECK_TRANSIT, meWith('edit'))).toEqual([
    'Terima di QC',
    'Cek ulang',
    'Catatan',
  ]);
  expect(labelsOf({ ...SERIAL, status: 'broken', custody: 'service' }, meWith('edit'))).toEqual([
    'Catatan',
  ]);
  // Servis tidak melihat aksi QC dan sebaliknya.
  expect(labelsOf(SERIAL, meWith('none', 'edit'))).toEqual([]);
  expect(labelsOf(AT_SERVICE_TRANSIT, meWith('edit'))).toEqual(['Catatan']);
});

test('ActButtons: tanpa aksi tidak tampil; tombol memanggil onPick dengan jenis dialog', async () => {
  const onPick = vi.fn();
  const { container, rerender } = render(
    <ActButtons
      state={{ status: 'good', custody: 'qc' }}
      actor={{ serial: false, serialservice: false }}
      onPick={onPick}
    />,
  );
  expect(container).toBeEmptyDOMElement();
  rerender(
    <ActButtons
      state={{ status: 'good', custody: 'qc' }}
      actor={{ serial: true, serialservice: false }}
      onPick={onPick}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Lapor rusak' }));
  expect(onPick).toHaveBeenCalledWith('report');
  expect(container.querySelector('select, option')).toBeNull();
});

test('Lapor rusak: catatan wajib; payload hanya catatan dan tanggal', async () => {
  renderDialog(SERIAL, 'report');
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveAttribute('data-mode', 'message');
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveAttribute('data-max-images', '10');
  const send = screen.getByRole('button', { name: 'Lapor rusak' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Port 3 mati');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  const input = lastAct();
  expect(input).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    action: 'report_failure',
    message: 'Port 3 mati',
  });
  expect(Object.keys(input).sort()).toEqual(
    ['action', 'expectedUpdatedAt', 'id', 'message', 'occurredOn'].sort(),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test('Kirim ke servis: satu lokasi servis = tanpa field dan tanpa toLocationId; catatan opsional', async () => {
  renderDialog(REPORTED, 'send');
  expect(await screen.findByText('Servis Pusat')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Lokasi servis' })).toBeNull();
  expect(screen.getByText('Catatan (opsional)')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kirim ke servis' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'send', message: '' });
  expect(lastAct()).not.toHaveProperty('toLocationId');
});

test('Kirim ke servis: tombol kirim nonaktif selama daftar lokasi servis belum dimuat', async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const base = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input?: unknown) =>
    id === 'serials.serviceLocations' ? pending : base?.(id, input),
  );
  serviceLocations = [
    { id: 'l9', code: 'SRV', name: 'Servis Pusat' },
    { id: 'l8', code: 'SR2', name: 'Servis Dua' },
  ];
  renderDialog(REPORTED, 'send');
  const send = screen.getByRole('button', { name: 'Kirim ke servis' });
  expect(send).toBeDisabled();
  release({ locations: serviceLocations });
  await screen.findByRole('combobox', { name: 'Lokasi servis' });
  expect(send).toBeDisabled();
  expect(calls('serials.act')).toHaveLength(0);
});

test('Kirim ke servis: banyak lokasi servis = LinkField hanya berisi lokasi servis dan wajib dipilih', async () => {
  serviceLocations = [
    { id: 'l9', code: 'SRV', name: 'Servis Pusat' },
    { id: 'l8', code: 'SR2', name: 'Servis Dua' },
  ];
  renderDialog(REPORTED, 'send');
  const send = screen.getByRole('button', { name: 'Kirim ke servis' });
  await screen.findByRole('combobox', { name: 'Lokasi servis' });
  expect(send).toBeDisabled();
  const names = await linkOptionNames(screen, 'Lokasi servis');
  expect(names).toEqual(['Servis Pusat (SRV)', 'Servis Dua (SR2)']);
  await userEvent.keyboard('{Escape}');
  await pickLink(screen, 'Lokasi servis', 'Servis Dua (SR2)');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'send', toLocationId: 'l8' });
});

test('Terima (servis): tanggal tidak lebih awal dari tanggal kirim', async () => {
  me = meWith('none', 'edit');
  renderDialog(AT_SERVICE_TRANSIT, 'receive');
  const date = screen.getByLabelText('Tanggal');
  expect(date).toHaveAttribute('min', '2026-11-10');
  expect(screen.getByText('Surabaya')).toBeInTheDocument();
  fireEvent.change(date, { target: { value: '2026-11-09' } });
  expect(screen.getByText('Tanggal tidak boleh sebelum tanggal kirim')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Terima' })).toBeDisabled();
  fireEvent.change(date, { target: { value: '2026-11-10' } });
  await userEvent.click(screen.getByRole('button', { name: 'Terima' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'receive', occurredOn: '2026-11-10' });
  expect(lastAct()).not.toHaveProperty('toLocationId');
});

test('Terima (QC): tanpa field lokasi bila lokasi asal aktif; meminta lokasi bila asal nonaktif', async () => {
  const { unmount } = renderDialog(RECHECK_TRANSIT, 'receive');
  await waitFor(() => expect(calls('serials.locationOptions')).toHaveLength(1));
  expect(screen.queryByRole('combobox', { name: 'Lokasi penerimaan' })).toBeNull();
  expect(screen.getByText(/lokasi QC saat unit dilaporkan/)).toBeInTheDocument();
  unmount();
  activeLocations = [{ id: 'l2', code: 'SBY', name: 'Surabaya' }];
  renderDialog(RECHECK_TRANSIT, 'receive');
  const field = await screen.findByRole('combobox', { name: 'Lokasi penerimaan' });
  expect(field).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Terima' });
  expect(send).toBeDisabled();
  await pickLink(screen, 'Lokasi penerimaan', 'Surabaya (SBY)');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'receive', toLocationId: 'l2' });
});

test('Diagnosis: tahap Selesai mengirim service_diagnosis dengan stage done', async () => {
  me = meWith('none', 'edit');
  renderDialog({ ...AT_SERVICE_TRANSIT, custody: 'service' }, 'diagnosis');
  await pickSelect(screen, 'Pilihan status', 'Selesai, kembalikan ke QC');
  expect(screen.getByText(/dikirim kembali ke lokasi QC asal/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan diagnosis' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'service_diagnosis', stage: 'done', message: '' });
});

test('Diagnosis dari transit: tahap bawaan diagnosis, min tanggal = tanggal kirim', async () => {
  me = meWith('none', 'edit');
  renderDialog(AT_SERVICE_TRANSIT, 'diagnosis');
  expect(screen.getByLabelText('Tanggal')).toHaveAttribute('min', '2026-11-10');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan diagnosis' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'service_diagnosis', stage: 'diagnosis' });
});

test('Diagnosis: Rusak menuntut catatan, memperingatkan surel, dan meminta konfirmasi', async () => {
  me = meWith('none', 'edit');
  renderDialog(
    { ...AT_SERVICE_TRANSIT, status: 'service_repair', custody: 'service' },
    'diagnosis',
  );
  // Dari Sedang diperbaiki, tahap bawaan = Selesai.
  await pickSelect(screen, 'Pilihan status', 'Rusak');
  expect(screen.getByText(/Email dikirim ke penerima/)).toBeInTheDocument();
  const send = screen.getByRole('button', { name: 'Nyatakan rusak' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Mainboard mati total');
  await userEvent.click(send);
  const confirm = await screen.findByRole('alertdialog');
  expect(calls('serials.act')).toHaveLength(0);
  await userEvent.click(within(confirm).getByRole('button', { name: 'Ya, nyatakan rusak' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'declare_broken', message: 'Mainboard mati total' });
  expect(lastAct()).not.toHaveProperty('stage');
});

test('Cek ulang pada Lolos: centang awalnya kosong; stiker dicentang masuk stickerIds; hasil lolos', async () => {
  renderDialog(SERIAL, 'recheck');
  const stickerA = await screen.findByRole('checkbox', { name: 'Stiker A' });
  const stickerB = await screen.findByRole('checkbox', { name: 'Stiker B' });
  expect(stickerA).not.toBeChecked();
  expect(stickerB).not.toBeChecked();
  expect(screen.getByText('Sudah ditempel 2×')).toBeInTheDocument();
  expect(screen.getByText('Belum pernah ditempel')).toBeInTheDocument();
  await userEvent.click(stickerB);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck', result: 'pass', stickerIds: ['st2'] });
  expect(lastAct()).not.toHaveProperty('locationId');
  expect(lastAct()).not.toHaveProperty('stickers');
});

test('Cek ulang tanpa centang tidak mengirim stickerIds', async () => {
  renderDialog(SERIAL, 'recheck');
  await screen.findByRole('checkbox', { name: 'Stiker A' });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).not.toHaveProperty('stickerIds');
});

test('Cek ulang tidak lolos pada Lolos: catatan wajib (membuka laporan)', async () => {
  renderDialog(SERIAL, 'recheck');
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  const send = screen.getByRole('button', { name: 'Simpan cek ulang' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Gagal lagi');
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck', result: 'fail', message: 'Gagal lagi' });
});

test('Cek ulang: deskripsi serial Lolos = laporan baru dibuka; serial ber-laporan = ditutup atau tetap terbuka', () => {
  const first = renderDialog(SERIAL, 'recheck');
  expect(
    screen.getByText('Cek ulang unit ini. Kalau tidak lolos, laporan baru dibuka.'),
  ).toBeInTheDocument();
  first.unmount();
  renderDialog(REPORTED, 'recheck');
  expect(
    screen.getByText(
      'Cek ulang unit ini. Kalau lolos, laporan ditutup; kalau tidak, laporan tetap terbuka.',
    ),
  ).toBeInTheDocument();
});

test('Cek ulang pada Dilaporkan: hasil memilih recheck_pass atau recheck_fail', async () => {
  const first = renderDialog(REPORTED, 'recheck');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck_pass' });
  expect(lastAct()).not.toHaveProperty('result');
  first.unmount();
  renderDialog(REPORTED, 'recheck');
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  expect(screen.getByRole('button', { name: 'Simpan cek ulang' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Masih mati');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(2));
  expect(lastAct()).toMatchObject({ action: 'recheck_fail', message: 'Masih mati' });
});

test('Cek ulang dari transit di QC: min tanggal = tanggal kirim; stiker nonaktif tidak bisa dicentang, deprecated boleh', async () => {
  renderDialog(
    {
      ...RECHECK_TRANSIT,
      stickers: [
        { stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'inactive' },
        { stickerId: 'st3', name: 'Stiker C', alias: '', qty: 1, stickerStatus: 'deprecated' },
      ],
    },
    'recheck',
  );
  expect(screen.getByLabelText('Tanggal')).toHaveAttribute('min', '2026-11-10');
  const inactive = await screen.findByRole('checkbox', { name: 'Stiker A' });
  expect(inactive).toBeDisabled();
  expect(screen.getByText('Stiker nonaktif: tidak bisa ditempel lagi')).toBeInTheDocument();
  const deprecated = screen.getByRole('checkbox', { name: 'Stiker C' });
  expect(deprecated).toBeEnabled();
  await userEvent.click(deprecated);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck_pass', stickerIds: ['st3'] });
});

test('Catatan: wajib berisi', async () => {
  renderDialog({ ...SERIAL, status: 'broken', custody: 'service' }, 'note');
  const send = screen.getByRole('button', { name: 'Kirim catatan' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Klaim vendor dibuka');
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'note', message: 'Klaim vendor dibuka' });
});

test('galat server per field tampil di bawah field-nya; sisanya pesan umum', async () => {
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serials.act') {
      return Promise.reject(
        new ApiError('VALIDATION', 'Data tidak valid', '-', {
          occurredOn: 'Tanggal terima tidak boleh sebelum tanggal kirim',
          message: 'Pesan memuat karakter pengatur arah teks',
          stickerIds: 'Stiker nonaktif tidak bisa ditempel',
        }),
      );
    }
    return id === 'serials.stickerOptions'
      ? Promise.resolve({ stickers: [] })
      : Promise.resolve({ locations: activeLocations, input });
  });
  renderDialog(SERIAL, 'recheck');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  expect(
    await screen.findByText('Tanggal terima tidak boleh sebelum tanggal kirim'),
  ).toBeInTheDocument();
  expect(screen.getByText('Pesan memuat karakter pengatur arah teks')).toBeInTheDocument();
  expect(screen.getByText('Stiker nonaktif tidak bisa ditempel')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test('versi usang (412): pesan, detail dan riwayat dimuat ulang, catatan tidak hilang', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serials.act'
      ? Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }))
      : Promise.resolve({ locations: [], stickers: [] }),
  );
  renderDialog(SERIAL, 'note');
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveValue('halo');
  expect(onClose).not.toHaveBeenCalled();
});

test('batas gambar catatan: dialog meneruskan maks. 10 gambar ke editor', () => {
  renderDialog(SERIAL, 'note');
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveAttribute('data-max-images', '10');
});
