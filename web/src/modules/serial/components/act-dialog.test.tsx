import type { MeDto, SerialDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({
  prepareImage: vi.fn(async () => ({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  })),
}));

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
      countrylock: 'none',
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
  buHistory: [],
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
  hasProofPhotos: false,
  proofProblemCount: 0,
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
  number: 'LP/SBY/2611-0001',
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

let uploaded = 0;

beforeEach(() => {
  uploaded = 0;
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
    if (id === 'serialProofs.upload') {
      uploaded += 1;
      return Promise.resolve({
        id: `p${uploaded}`,
        state: 'draft',
        mime: 'image/webp',
        size: 10,
        width: 10,
        height: 10,
        filename: `bukti-p${uploaded}.webp`,
        error: null,
      });
    }
    if (id === 'serialProofs.remove') return Promise.resolve({ id: 'x' });
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
  // Catatan pengiriman kosong tidak dikirim.
  expect(lastAct()).not.toHaveProperty('shipmentNote');
});

test('Kirim ke servis: ada field Catatan pengiriman (opsional) untuk kurir, resi, atau karyawan; dikirim dipangkas', async () => {
  renderDialog(REPORTED, 'send');
  await screen.findByText('Servis Pusat');
  const field = screen.getByLabelText('Catatan pengiriman (opsional)');
  expect(field).toHaveAttribute('placeholder', 'Kurir, nomor resi, atau nama karyawan pengantar');
  expect(field).toHaveAttribute('maxlength', '200');
  // Opsional: tombol kirim tetap aktif tanpa mengisinya.
  expect(screen.getByRole('button', { name: 'Kirim ke servis' })).toBeEnabled();
  await userEvent.type(field, '  JNE resi 123456, diantar Budi ');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim ke servis' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({
    action: 'send',
    shipmentNote: 'JNE resi 123456, diantar Budi',
  });
});

test('Kirim ke servis: galat server pada shipmentNote tampil di bawah field-nya', async () => {
  const base = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input?: unknown) =>
    id === 'serials.act'
      ? Promise.reject(
          new ApiError('VALIDATION', 'Data tidak valid', '-', {
            shipmentNote: 'Tulis dalam satu baris, tanpa karakter kontrol',
          }),
        )
      : base?.(id, input),
  );
  renderDialog(REPORTED, 'send');
  await screen.findByText('Servis Pusat');
  await userEvent.type(screen.getByLabelText('Catatan pengiriman (opsional)'), 'resi 1');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim ke servis' }));
  expect(
    await screen.findByText('Tulis dalam satu baris, tanpa karakter kontrol'),
  ).toBeInTheDocument();
});

test('field Catatan pengiriman hanya ada pada Kirim ke servis', () => {
  renderDialog(AT_SERVICE_TRANSIT, 'receive');
  expect(screen.queryByLabelText('Catatan pengiriman (opsional)')).toBeNull();
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
  await pickSelect(screen, 'Status', 'Selesai, kembalikan ke QC');
  expect(screen.getByText(/dikirim kembali ke lokasi QC asal/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan diagnosis' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'service_diagnosis', stage: 'done', message: '' });
});

test('Diagnosis: field berlabel Status dan kosong sejak awal; simpan baru aktif setelah memilih', async () => {
  me = meWith('none', 'edit');
  renderDialog(AT_SERVICE_TRANSIT, 'diagnosis');
  // Label "Status" (bukan "Pilihan status"); tanpa nilai bawaan agar tim servis memilih dengan sadar.
  expect(screen.queryByText('Pilihan status')).toBeNull();
  const field = screen.getByRole('combobox', { name: 'Status' });
  expect(field).toHaveValue('');
  expect(field).toHaveAttribute('placeholder', 'Pilih status…');
  const save = screen.getByRole('button', { name: 'Simpan diagnosis' });
  expect(save).toBeDisabled();
  await userEvent.click(save);
  expect(calls('serials.act')).toHaveLength(0);
  await pickSelect(screen, 'Status', 'Diagnosis');
  expect(save).toBeEnabled();
});

test('Diagnosis dari transit: min tanggal = tanggal kirim; status yang dipilih dikirim', async () => {
  me = meWith('none', 'edit');
  renderDialog(AT_SERVICE_TRANSIT, 'diagnosis');
  expect(screen.getByLabelText('Tanggal')).toHaveAttribute('min', '2026-11-10');
  await pickSelect(screen, 'Status', 'Diagnosis');
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
  // Tidak ada tahap bawaan (juga dari Sedang diperbaiki): Rusak dipilih sendiri.
  await pickSelect(screen, 'Status', 'Rusak');
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
    if (id === 'serials.buOptions') return Promise.resolve({ businessUnits: [] });
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

/** Membuka dialog foto, memilih `count` berkas lewat Telusuri, lalu menekan Tambahkan. */
async function attachPhotos(count: number) {
  await userEvent.click(screen.getByRole('button', { name: /^Foto \(/ }));
  const files = Array.from(
    { length: count },
    (_, index) => new File([new Uint8Array(4)], `f${index}.png`, { type: 'image/png' }),
  );
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  // Tiap foto langsung diunggah: Tambahkan baru aktif (dan berhitung) setelah semuanya naik.
  await userEvent.click(await screen.findByRole('button', { name: `Tambahkan (${count})` }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: `Foto (${count})` })).toBeInTheDocument(),
  );
}

test('field Bukti foto hanya ada pada Cek ulang', () => {
  const cases: [SerialDto, ActKind][] = [
    [SERIAL, 'report'],
    [REPORTED, 'send'],
    [AT_SERVICE_TRANSIT, 'receive'],
    [AT_SERVICE_TRANSIT, 'diagnosis'],
    [SERIAL, 'note'],
  ];
  for (const [serial, kind] of cases) {
    const view = renderDialog(serial, kind);
    expect(screen.queryByText('Bukti foto (opsional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Foto \(/ })).not.toBeInTheDocument();
    view.unmount();
  }
  renderDialog(SERIAL, 'recheck');
  expect(screen.getByText('Bukti foto (opsional)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (0)' })).toBeInTheDocument();
});

test('Cek ulang dengan foto: proofPhotoIds ikut terkirim pada recheck', async () => {
  renderDialog(SERIAL, 'recheck');
  await attachPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck', proofPhotoIds: ['p1', 'p2'] });
  // Tersimpan: foto sudah tertaut ke entri, jadi tidak dibuang.
  expect(calls('serialProofs.remove')).toHaveLength(0);
  expect(onClose).toHaveBeenCalled();
});

test('Cek ulang pada Dilaporkan (recheck_pass dan recheck_fail) juga mengirim proofPhotoIds', async () => {
  const first = renderDialog(REPORTED, 'recheck');
  await attachPhotos(1);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).toMatchObject({ action: 'recheck_pass', proofPhotoIds: ['p1'] });
  first.unmount();
  renderDialog(REPORTED, 'recheck');
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  await attachPhotos(1);
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Masih mati');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(2));
  expect(lastAct()).toMatchObject({ action: 'recheck_fail', proofPhotoIds: ['p2'] });
});

test('Cek ulang tanpa foto tidak mengirim proofPhotoIds', async () => {
  renderDialog(SERIAL, 'recheck');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(lastAct()).not.toHaveProperty('proofPhotoIds');
});

test('foto kedaluwarsa: galat tampil di bawah field Bukti foto, foto dibuang dari dialog, dialog tetap terbuka', async () => {
  const message = 'Foto sudah kedaluwarsa, unggah ulang';
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.act') {
      return Promise.reject(new ApiError('VALIDATION', message, '-', { proofPhotoIds: message }));
    }
    if (id === 'serialProofs.upload') {
      return Promise.resolve({
        id: 'p1',
        state: 'draft',
        mime: 'image/webp',
        size: 10,
        width: 10,
        height: 10,
        filename: 'bukti-p1.webp',
        error: null,
      });
    }
    if (id === 'serials.buOptions') return Promise.resolve({ businessUnits: [] });
    return id === 'serials.stickerOptions'
      ? Promise.resolve({ stickers: [] })
      : Promise.resolve({ locations: activeLocations });
  });
  renderDialog(SERIAL, 'recheck');
  await attachPhotos(1);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (0)' })).toBeInTheDocument();
  expect(calls('serialProofs.remove')).toHaveLength(0);
  expect(onClose).not.toHaveBeenCalled();
});

test('Batal dengan foto yang belum tersimpan membuang foto itu di server', async () => {
  renderDialog(SERIAL, 'recheck');
  await attachPhotos(2);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(calls('serialProofs.remove')).toHaveLength(2));
  expect(
    calls('serialProofs.remove')
      .map((call) => (call[1] as { id: string }).id)
      .sort(),
  ).toEqual(['p1', 'p2']);
  expect(onClose).toHaveBeenCalled();
});

/** Unggahan foto menggantung (dengan AbortSignal) sampai dilepas atau digagalkan; id lain mengikuti mock bawaan. */
function holdProofUpload() {
  const base = apiMock.getMockImplementation() as (
    id: string,
    input?: unknown,
    options?: unknown,
  ) => unknown;
  const state = { release: [] as Array<() => void>, fail: [] as Array<() => void>, aborted: 0 };
  apiMock.mockImplementation((id: string, input?: unknown, options?: { signal?: AbortSignal }) => {
    if (id !== 'serialProofs.upload') return base(id, input, options);
    return new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        state.aborted += 1;
        reject(new DOMException('Dibatalkan', 'AbortError'));
      });
      state.release.push(() =>
        resolve({
          id: 'p1',
          state: 'draft',
          mime: 'image/webp',
          size: 10,
          width: 10,
          height: 10,
          filename: 'bukti-p1.webp',
          error: null,
        }),
      );
      state.fail.push(() => reject(new Error('Jaringan putus')));
    });
  });
  return state;
}

async function pickOnePhotoWithoutWaiting() {
  await userEvent.click(screen.getByRole('button', { name: /^Foto \(/ }));
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'f0.png', { type: 'image/png' })] },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Tambahkan (1)' }));
}

test('foto masih diunggah: Simpan cek ulang ditahan dengan pesan, lalu aktif setelah unggahan selesai', async () => {
  const held = holdProofUpload();
  renderDialog(SERIAL, 'recheck');
  await pickOnePhotoWithoutWaiting();
  await waitFor(() => expect(held.release).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Simpan cek ulang' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('1 foto masih diunggah atau gagal');
  held.release[0]?.();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Simpan cek ulang' })).toBeEnabled(),
  );
  expect(screen.queryByText(/masih diunggah atau gagal/)).not.toBeInTheDocument();
});

test('unggahan foto gagal: Simpan tetap ditahan sampai dibuang atau diulang', async () => {
  const held = holdProofUpload();
  renderDialog(SERIAL, 'recheck');
  await pickOnePhotoWithoutWaiting();
  await waitFor(() => expect(held.fail).toHaveLength(1));
  held.fail[0]?.();
  await screen.findByText('Jaringan putus');
  expect(screen.getByRole('button', { name: 'Simpan cek ulang' })).toBeDisabled();
});

test('Batal saat foto masih diunggah membatalkan unggahannya dan tidak mengirim apa pun', async () => {
  const held = holdProofUpload();
  renderDialog(SERIAL, 'recheck');
  await pickOnePhotoWithoutWaiting();
  await waitFor(() => expect(held.release).toHaveLength(1));
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(held.aborted).toBe(1);
  expect(calls('serials.act')).toHaveLength(0);
  expect(onClose).toHaveBeenCalled();
});

test('Cek ulang: pratinjau cap di kamera foto memuat serial, item, BU, lokasi cek ulang, dan pelaku (QC)', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  // Unit dalam perjalanan ke QC: lokasi cap = tujuan pengiriman (sama dengan cap resmi server).
  renderDialog(RECHECK_TRANSIT, 'recheck');
  await userEvent.click(screen.getByRole('button', { name: /^Foto \(/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  const note = await screen.findByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: ABC123');
  expect(note).toHaveTextContent('Cisco C9200');
  expect(note).toHaveTextContent('BU1 · Jakarta');
  expect(note).toHaveTextContent('Disimpan saat Simpan · A (QC)');
  Reflect.deleteProperty(navigator, 'mediaDevices');
});
