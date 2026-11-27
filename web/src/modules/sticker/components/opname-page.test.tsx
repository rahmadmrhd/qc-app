import type { MeDto, StickerStockDto } from '@shared/contract';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FormPage } from '@/components/page/form-page';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { OpnamePage, type OpnamePageProps } from './opname-page';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

function located(permission: 'view' | 'edit' | 'manage') {
  return { handover: 'none', qc: 'none', stock: 'none', stickerstock: permission } as const;
}

afterEach(() => {
  cleanup();
});

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
      sticker: 'view',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: located('manage') },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: located('manage') },
    ],
  };
});

function stock(
  id: string,
  name: string,
  typeName: string,
  qtyA: number,
  qtyB = 0,
): StickerStockDto {
  return {
    stickerId: id,
    name,
    typeName,
    typeStatus: 'active',
    status: 'active',
    minQty: 0,
    low: false,
    total: qtyA + qtyB,
    byLocation: [
      { locationId: 'l-a', qty: qtyA },
      { locationId: 'l-b', qty: qtyB },
    ],
  };
}

const rows: StickerStockDto[] = [
  stock('s1', 'Hijau-B', 'QC Hijau', 120, 30),
  stock('s2', 'Hijau-C', 'QC Hijau', 10),
  stock('s3', 'Segel Polos', 'Segel', 40),
  stock('s4', 'Garansi Void', 'Garansi', 5),
];

const FORM_ID = 'opname-test';

/** Meniru rute: FormPage memegang tombol Simpan/Batal; status busy dan submittable datang dari halaman. */
function Harness({
  onCancel,
  ...props
}: Omit<OpnamePageProps, 'formId' | 'onBusyChange' | 'onSubmittableChange'> & {
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [submittable, setSubmittable] = useState(false);
  return (
    <ActiveLocationsProvider>
      <FormPage
        formId={FORM_ID}
        title="Stok opname"
        onCancel={onCancel}
        submitting={busy}
        submitLabel="Simpan opname"
        submitDisabled={!submittable}
      >
        <OpnamePage
          formId={FORM_ID}
          onBusyChange={setBusy}
          onSubmittableChange={setSubmittable}
          {...props}
        />
      </FormPage>
    </ActiveLocationsProvider>
  );
}

async function renderPage(props: Partial<OpnamePageProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const onDirtyChange = vi.fn();
  await renderInRouter(
    <Harness
      rows={rows}
      onSave={onSave}
      onDone={onDone}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
      {...props}
    />,
  );
  return { onSave, onDone, onCancel, onDirtyChange };
}

async function chooseJakarta() {
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
}

test('halaman memuat judul dan petunjuk memilih lokasi; tanpa daftar sebelum lokasi dipilih', async () => {
  await renderPage();
  expect(screen.getByRole('heading', { name: 'Stok opname' })).toBeInTheDocument();
  expect(screen.getByText('Pilih lokasi untuk mulai menghitung.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hitung Hijau-B' })).toBeNull();
});

test('total butir baris melebihi batas ditandai dan Simpan nonaktif', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Lembar baris 1'), '1000');
  await userEvent.type(screen.getByLabelText('Isi per lembar baris 1'), '5000');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Hijau-B: jumlah butir maksimal 1000000',
  );
  expect(screen.getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
});

test('menampilkan stok tercatat negatif sebagai "Kurang N"', async () => {
  const [first, ...rest] = rows as [StickerStockDto, ...StickerStockDto[]];
  await renderPage({
    rows: [{ ...first, total: -2, byLocation: [{ locationId: 'l-a', qty: -2 }] }, ...rest],
  });
  await chooseJakarta();
  expect(screen.getByText('Tercatat Kurang 2')).toBeInTheDocument();
});

test('mengirim expectedQty yang dilihat halaman dan hanya baris yang dihitung, lalu onDone', async () => {
  const { onSave, onDone } = await renderPage();
  await chooseJakarta();
  expect(screen.getByText('Tercatat 120')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '7');
  expect(screen.getByText('Selisih -113')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan opname' }));
  expect(onSave).toHaveBeenCalledWith({
    rows: [{ stickerId: 's1', locationId: 'l-a', expectedQty: 120, count: { rows: [], loose: 7 } }],
  });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('ditolak usang: pesan hitung ulang, lalu Hitung ulang memakai stok terbaru', async () => {
  const { onSave, onDone } = await renderPage();
  onSave.mockResolvedValueOnce({
    message: 'Stok berubah sejak dihitung; hitung ulang',
    stale: true,
  });
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan opname' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Stok berubah sejak dihitung; hitung ulang',
  );
  // Usang: Simpan terkunci sampai "Hitung ulang" (tombol inline di dalam form).
  expect(screen.getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
  expect(onDone).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung ulang' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Hitung Hijau-B' })).toBeInTheDocument();
});

test('tanpa baris yang dihitung tidak dapat dikirim', async () => {
  const { onSave } = await renderPage();
  await chooseJakarta();
  expect(screen.getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

test('Batal memanggil onCancel dan tidak menyimpan', async () => {
  const { onSave, onCancel } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

test('onDirtyChange mengabarkan ada hitungan belum disimpan, lalu bersih setelah dibatalkan', async () => {
  const { onDirtyChange } = await renderPage();
  await chooseJakarta();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Batal hitung Hijau-B' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

test('pencarian menyaring stiker menurut nama tanpa membedakan huruf besar/kecil', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'hijau');
  expect(screen.getByRole('button', { name: 'Hitung Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hitung Hijau-C' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hitung Segel Polos' })).toBeNull();
  await userEvent.clear(screen.getByLabelText('Cari stiker'));
  expect(screen.getByRole('button', { name: 'Hitung Segel Polos' })).toBeInTheDocument();
});

test('pencarian tanpa hasil menampilkan pesan kosong', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'tidak-ada');
  expect(screen.getByText('Tidak ada stiker yang cocok.')).toBeInTheDocument();
});

test('filter jenis menawarkan jenis yang ada dan menerima banyak jenis sekaligus', async () => {
  await renderPage();
  await chooseJakarta();
  expect(await linkOptionNames(screen, 'Jenis stiker')).toEqual(['Garansi', 'QC Hijau', 'Segel']);
  await userEvent.click(await screen.findByRole('option', { name: 'Segel' }));
  expect(screen.getByRole('button', { name: 'Hitung Segel Polos' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hitung Hijau-B' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hitung Garansi Void' })).toBeNull();
  await pickLink(screen, 'Jenis stiker', 'Garansi');
  expect(screen.getByRole('button', { name: 'Hitung Segel Polos' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hitung Garansi Void' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hitung Hijau-B' })).toBeNull();
});

test('pencarian dan filter jenis bekerja bersamaan', async () => {
  await renderPage();
  await chooseJakarta();
  await pickLink(screen, 'Jenis stiker', 'QC Hijau');
  await userEvent.type(screen.getByLabelText('Cari stiker'), '-c');
  expect(screen.getByRole('button', { name: 'Hitung Hijau-C' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hitung Hijau-B' })).toBeNull();
});

test('stiker yang sudah dihitung tetap terkirim walau tersaring dari tampilan', async () => {
  const { onSave } = await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '7');
  // Saring ke jenis lain: Hijau-B hilang dari tampilan, tetapi hitungannya tetap ada.
  await pickLink(screen, 'Jenis stiker', 'Segel');
  expect(screen.queryByRole('button', { name: 'Batal hitung Hijau-B' })).toBeNull();
  expect(screen.getByText(/Sudah dihitung: 1 stiker/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan opname' }));
  expect(onSave).toHaveBeenCalledWith({
    rows: [{ stickerId: 's1', locationId: 'l-a', expectedQty: 120, count: { rows: [], loose: 7 } }],
  });
});

test('baris melebihi batas yang tersaring dari tampilan tetap memunculkan peringatan dan memblokir Simpan', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Lembar baris 1'), '1000');
  await userEvent.type(screen.getByLabelText('Isi per lembar baris 1'), '5000');
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'segel');
  expect(screen.getByRole('alert')).toHaveTextContent('Hijau-B: jumlah butir maksimal 1000000');
  expect(screen.getByRole('button', { name: 'Simpan opname' })).toBeDisabled();
});

test('mengganti lokasi membuang hitungan tetapi mempertahankan pencarian dan filter', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'hijau');
  await userEvent.click(screen.getByRole('button', { name: 'Hitung Hijau-B' }));
  await pickLink(screen, 'Lokasi', 'Bandung (BDG)');
  expect(screen.getByRole('button', { name: 'Hitung Hijau-B' })).toBeInTheDocument();
  expect(screen.getByLabelText('Cari stiker')).toHaveValue('hijau');
});

test('Enter di kolom cari tidak mengirim form bila belum ada hitungan', async () => {
  const { onSave } = await renderPage();
  await chooseJakarta();
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'hijau{Enter}');
  expect(onSave).not.toHaveBeenCalled();
});

test('"Stok opname" dari View Stiker: kolom cari terisi nama stiker (initialSearch)', async () => {
  await renderPage({ initialSearch: 'Segel' });
  await chooseJakarta();
  expect(screen.getByLabelText('Cari stiker')).toHaveValue('Segel');
  expect(screen.queryByRole('button', { name: 'Hitung Hijau-B' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Hitung Segel Polos' })).toBeInTheDocument();
});
