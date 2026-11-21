import type { MeDto, StickerStockDto } from '@shared/contract';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FormPage } from '@/components/page/form-page';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { pickLink, pickSelect, selectOptionNames } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import type { EntryMode } from '../lib/entry-rows';
import { EntryPage, type EntryPageProps } from './entry-page';

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
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: located('manage') },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: located('edit') },
    ],
  };
});

function stock(
  id: string,
  name: string,
  typeName: string,
  qtyA: number,
  overrides: Partial<StickerStockDto> = {},
): StickerStockDto {
  return {
    stickerId: id,
    name,
    typeName,
    typeStatus: 'active',
    status: 'active',
    minQty: 0,
    low: false,
    total: qtyA,
    byLocation: [
      { locationId: 'l-a', qty: qtyA },
      { locationId: 'l-b', qty: 0 },
    ],
    ...overrides,
  };
}

const rows: StickerStockDto[] = [
  stock('s1', 'Hijau-B', 'QC Hijau', 120),
  stock('s2', 'Hijau-C', 'QC Hijau', 10),
  stock('s3', 'Segel Polos', 'Segel', 40),
  // Nonaktif tetapi masih bersaldo di Jakarta: hanya boleh dikeluarkan/dikoreksi.
  stock('s4', 'Segel Lawas', 'Segel', 7, { status: 'inactive' }),
];

const FORM_ID = 'entry-test';

/** Meniru rute: FormPage memegang Simpan/Batal, mode dipegang pemanggil (search param di rute). */
function Harness({
  initialMode = 'in',
  onCancel,
  ...props
}: Omit<
  EntryPageProps,
  'formId' | 'mode' | 'onModeChange' | 'onBusyChange' | 'onSubmittableChange'
> & {
  initialMode?: EntryMode;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [submittable, setSubmittable] = useState(false);
  return (
    <ActiveLocationsProvider>
      <FormPage
        formId={FORM_ID}
        title="Entri stok"
        onCancel={onCancel}
        submitting={busy}
        submitDisabled={!submittable}
      >
        <EntryPage
          formId={FORM_ID}
          mode={mode}
          onModeChange={setMode}
          onBusyChange={setBusy}
          onSubmittableChange={setSubmittable}
          {...props}
        />
      </FormPage>
    </ActiveLocationsProvider>
  );
}

async function renderPage(props: Partial<EntryPageProps> & { initialMode?: EntryMode } = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const onDirtyChange = vi.fn();
  await renderInRouter(
    <Harness
      rows={rows}
      canAdjust
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

test('tanpa lokasi terpilih: petunjuk dan tanpa daftar; Simpan nonaktif', async () => {
  await renderPage();
  expect(screen.getByText('Pilih lokasi untuk mulai mencatat.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah Hijau-B' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('Masuk: stiker dinonaktifkan tidak muncul; Keluar: yang bersaldo di lokasi ini muncul', async () => {
  await renderPage();
  await chooseJakarta();
  expect(screen.getByRole('button', { name: 'Tambah Hijau-B' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah Segel Lawas' })).toBeNull();
  await pickSelect(screen, 'Jenis entri', 'Keluar');
  expect(screen.getByRole('button', { name: 'Tambah Segel Lawas' })).toBeInTheDocument();
});

test('pilihan Koreksi hanya bagi pemegang manage', async () => {
  await renderPage({ canAdjust: false });
  expect(await selectOptionNames(screen, 'Jenis entri')).toEqual(['Masuk', 'Keluar']);
});

test('masuk: tambah stiker, isi hitungan, alasan boleh kosong; kirim batch lalu onDone', async () => {
  const { onSave, onDone } = await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '7');
  expect(screen.getByText('1 stiker, 7 butir')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith('in', {
    kind: 'in',
    reason: '',
    rows: [{ stickerId: 's1', locationId: 'l-a', count: { rows: [], loose: 7 } }],
  });
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('keluar: alasan wajib (Simpan nonaktif sampai diisi) dan peringatan melebihi stok tercatat', async () => {
  const { onSave } = await renderPage({ initialMode: 'out' });
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-C' }));
  await userEvent.type(screen.getByLabelText('Butir'), '50');
  expect(screen.getByText('Melebihi stok tercatat (10 butir)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Alasan'), 'Dipakai produksi');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith(
    'out',
    expect.objectContaining({ kind: 'out', reason: 'Dipakai produksi' }),
  );
});

test('koreksi: selisih bertanda, pratinjau hasil, galat untuk 0, dan alasan wajib', async () => {
  const { onSave } = await renderPage({ initialMode: 'adjust' });
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-C' }));
  const delta = screen.getByLabelText('Perubahan Hijau-C (butir)');
  await userEvent.type(delta, '0');
  expect(await screen.findByRole('alert')).toHaveTextContent('Perubahan wajib diisi (bukan 0)');
  await userEvent.clear(delta);
  await userEvent.type(delta, '-4');
  expect(screen.getByText('Hasil 6')).toBeInTheDocument();
  expect(screen.getByText('1 stiker, -4 butir (bersih)')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Alasan'), 'Hitung fisik');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith('adjust', {
    reason: 'Hitung fisik',
    rows: [{ stickerId: 's2', locationId: 'l-a', delta: -4 }],
  });
});

test('Koreksi hanya menawarkan lokasi dengan hak manage (Bandung hanya edit)', async () => {
  await renderPage({ initialMode: 'adjust' });
  await userEvent.click(screen.getByRole('combobox', { name: 'Lokasi' }));
  expect(screen.queryByRole('option', { name: 'Bandung (BDG)' })).toBeNull();
  expect(await screen.findByRole('option', { name: 'Jakarta (JKT)' })).toBeInTheDocument();
});

test('galat server tampil dan isian dipertahankan; tidak ada onDone', async () => {
  const { onSave, onDone } = await renderPage();
  onSave.mockResolvedValueOnce({ message: 'Stiker tidak aktif', stale: false });
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Stiker tidak aktif');
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Butir')).toHaveValue(3);
});

test('Batal catat mengeluarkan stiker dari entri; Simpan kembali nonaktif', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Batal catat Hijau-B' }));
  expect(screen.getByRole('button', { name: 'Tambah Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('stiker yang sudah ditambah tetap terkirim walau tersaring dari tampilan', async () => {
  const { onSave } = await renderPage();
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-B' }));
  await userEvent.type(screen.getByLabelText('Butir'), '7');
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'segel');
  expect(screen.queryByRole('button', { name: 'Batal catat Hijau-B' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith(
    'in',
    expect.objectContaining({
      rows: [{ stickerId: 's1', locationId: 'l-a', count: { rows: [], loose: 7 } }],
    }),
  );
});

test('initialStickerId: kolom cari terisi dan stiker langsung masuk entri', async () => {
  await renderPage({ initialStickerId: 's3' });
  await chooseJakarta();
  expect(screen.getByLabelText('Cari stiker')).toHaveValue('Segel Polos');
  expect(screen.getByRole('button', { name: 'Batal catat Segel Polos' })).toBeInTheDocument();
});

test('onDirtyChange: bersih awalnya, kotor setelah ada stiker ditambah', async () => {
  const { onDirtyChange } = await renderPage();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  await chooseJakarta();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Hijau-B' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});

test('pencarian tanpa hasil menampilkan pesan kosong', async () => {
  await renderPage();
  await chooseJakarta();
  await userEvent.type(screen.getByLabelText('Cari stiker'), 'tidak-ada');
  expect(screen.getByText('Tidak ada stiker yang cocok.')).toBeInTheDocument();
});

test('Batal pada FormPage memanggil onCancel dan tidak menyimpan', async () => {
  const { onCancel, onSave } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
