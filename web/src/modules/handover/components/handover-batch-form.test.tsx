import type { HandoverOptionsDto, MeDto } from '@shared/rpc';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { RpcError } from '@/lib/rpc/rpc-error';
import type { HandoverBatchFormOutput } from '../schemas';

const meMock = vi.hoisted(() => ({
  me: {
    email: 'wh@qc.local',
    name: 'WH',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'view',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
    },
    locations: [
      {
        id: 'loc-a',
        code: 'A',
        name: 'Lokasi A',
        permissions: { handover: 'manage', qc: 'none', stock: 'none' },
      },
      {
        id: 'loc-b',
        code: 'B',
        name: 'Lokasi B',
        permissions: { handover: 'edit', qc: 'none', stock: 'none' },
      },
    ],
  } as MeDto,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => meMock.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: ['loc-a', 'loc-b'] }),
}));
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { HandoverBatchForm } from './handover-batch-form';

const options: HandoverOptionsDto = {
  customers: [{ id: 'c1', name: 'PT Maju' }],
  inactiveCustomerNames: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<HandoverBatchForm options={options} onSubmit={onSubmit} onCancel={vi.fn()} />);
  return { onSubmit };
}

const cards = () => screen.getAllByRole('group', { name: /^Task \d+$/ });
const noteOf = (card: HTMLElement) => within(card).getByRole('textbox', { name: /^Catatan/ });

async function fillNote(index: number, text: string) {
  await userEvent.type(noteOf(cards()[index] as HTMLElement), text);
}

test('lokasi dipilih sekali untuk seluruh batch', () => {
  renderForm();
  expect(screen.getAllByLabelText('Lokasi')).toHaveLength(1);
  expect(cards()).toHaveLength(1);
});

test('tambah/hapus/gandakan kartu', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  expect(cards()).toHaveLength(2);
  await fillNote(0, 'catatan satu');
  await userEvent.type(within(cards()[0] as HTMLElement).getByLabelText('Customer'), 'PT Maju');
  await userEvent.click(
    within(cards()[0] as HTMLElement).getByRole('button', { name: 'Gandakan' }),
  );
  expect(cards()).toHaveLength(3);
  // salinan: catatan sama, customer kosong, disisipkan tepat sesudah asalnya
  await waitFor(() => expect(noteOf(cards()[1] as HTMLElement)).toHaveTextContent('catatan satu'));
  expect(within(cards()[1] as HTMLElement).getByLabelText('Customer')).toHaveValue('');
  await userEvent.click(within(cards()[1] as HTMLElement).getByRole('button', { name: 'Hapus' }));
  expect(cards()).toHaveLength(2);
});

test('Simpan semua mengirim saveBatch dengan semua task', async () => {
  const { onSubmit } = renderForm();
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  await fillNote(0, 'satu');
  await fillNote(1, 'dua');
  await userEvent.type(within(cards()[1] as HTMLElement).getByLabelText('Customer'), 'CV Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (2)' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).toEqual({
    locationId: 'loc-a',
    tasks: [
      { customerName: '', note: 'satu' },
      { customerName: 'CV Baru', note: 'dua' },
    ],
  });
});

test('galat server pada task ke-2 menandai kartu ke-2 dan mempertahankan semua draf', async () => {
  const onSubmit = vi.fn().mockRejectedValue(
    new RpcError('VALIDATION', 'Input tidak valid', 'r1', {
      tasks: 'Task 2: Customer dinonaktifkan; aktifkan dulu di halaman Customer',
    }),
  );
  renderForm(onSubmit);
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  await fillNote(0, 'satu');
  await fillNote(1, 'dua');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (2)' }));
  const alert = await within(cards()[1] as HTMLElement).findByRole('alert');
  expect(alert).toHaveTextContent('Customer dinonaktifkan');
  expect(within(cards()[0] as HTMLElement).queryByRole('alert')).not.toBeInTheDocument();
  expect(cards()).toHaveLength(2);
  expect(noteOf(cards()[0] as HTMLElement)).toHaveTextContent('satu');
  expect(noteOf(cards()[1] as HTMLElement)).toHaveTextContent('dua');
});

test('galat umum dari server ditampilkan di atas form dan draf tetap', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new RpcError('FORBIDDEN', 'Tidak punya izin', 'r2'));
  renderForm(onSubmit);
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  await fillNote(0, 'satu');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (1)' }));
  expect(await screen.findByText('Tidak punya izin')).toBeInTheDocument();
  expect(noteOf(cards()[0] as HTMLElement)).toHaveTextContent('satu');
});

test('validasi klien: catatan kosong menahan pengiriman', async () => {
  const { onSubmit } = renderForm();
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (1)' }));
  expect(await screen.findByText('Catatan wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

// 29 klik userEvent + render 30 kartu Tiptap: berat saat vitest menjalankan banyak berkas paralel, jadi batas dilonggarkan.
test('batch di atas 30 task menonaktifkan tambah', { timeout: 60_000 }, async () => {
  renderForm();
  const add = screen.getByRole('button', { name: 'Tambah task' });
  for (let i = 0; i < 29; i++) await userEvent.click(add);
  expect(cards()).toHaveLength(30);
  expect(add).toBeDisabled();
  expect(
    within(cards()[0] as HTMLElement).getByRole('button', { name: 'Gandakan' }),
  ).toBeDisabled();
});

test('hasil pecah tempelan WhatsApp ditambahkan sebagai kartu', async () => {
  renderForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' }), {
    target: { value: 'Lintasmaya :\nAF 5XHD = 16 unt\n\nMitra Tower :\nRD-5G34 = 8 unt' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Pecah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan ke batch (2)' }));
  // kartu kosong awal diganti oleh hasil pecah
  expect(cards()).toHaveLength(2);
  expect(within(cards()[0] as HTMLElement).getByLabelText('Customer')).toHaveValue('Lintasmaya');
  expect(within(cards()[1] as HTMLElement).getByLabelText('Customer')).toHaveValue('Mitra Tower');
});

test('galat server menempel pada kartu yang benar setelah kartu lain dihapus (pemetaan per id)', async () => {
  const onSubmit = vi.fn().mockRejectedValue(
    new RpcError('VALIDATION', 'Input tidak valid', 'r1', {
      tasks: 'Task 3: Customer dinonaktifkan; aktifkan dulu di halaman Customer',
    }),
  );
  renderForm(onSubmit);
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah task' }));
  await fillNote(0, 'satu');
  await fillNote(1, 'dua');
  await fillNote(2, 'tiga');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (3)' }));
  const flagged = await within(cards()[2] as HTMLElement).findByRole('alert');
  expect(flagged).toHaveTextContent('Customer dinonaktifkan');
  // hapus kartu pertama: pesan tetap menempel pada kartu "tiga" (kini kartu ke-2), bukan bergeser
  await userEvent.click(within(cards()[0] as HTMLElement).getByRole('button', { name: 'Hapus' }));
  expect(cards()).toHaveLength(2);
  expect(within(cards()[1] as HTMLElement).getByRole('alert')).toHaveTextContent(
    'Customer dinonaktifkan',
  );
  expect(noteOf(cards()[1] as HTMLElement)).toHaveTextContent('tiga');
  expect(within(cards()[0] as HTMLElement).queryByRole('alert')).not.toBeInTheDocument();
}, 40_000);

test('tempelan 30 task muat walau ada satu kartu kosong awal (slot dihitung benar)', async () => {
  renderForm();
  const text = Array.from(
    { length: 30 },
    (_, i) => `Cust ${i + 1} :\nBarang ${i + 1} = 1 unit`,
  ).join('\n\n');
  fireEvent.change(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' }), {
    target: { value: text },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Pecah' }));
  expect(screen.queryByText(/melebihi sisa slot/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan ke batch (30)' }));
  expect(cards()).toHaveLength(30);
}, 40_000);

/** Tempel `n` task WhatsApp lalu tambahkan ke batch; lokasi dipilih. */
async function pasteTasks(
  n: number,
  onSubmit: (values: HandoverBatchFormOutput) => Promise<unknown>,
  onSaved = vi.fn(),
) {
  render(
    <HandoverBatchForm
      options={options}
      onSubmit={onSubmit}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Lokasi'), { target: { value: 'loc-a' } });
  const text = Array.from(
    { length: n },
    (_, i) => `Cust ${i + 1} :\nBarang ${i + 1} = 1 unit`,
  ).join('\n\n');
  fireEvent.change(screen.getByRole('textbox', { name: 'Tempelan WhatsApp' }), {
    target: { value: text },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Pecah' }));
  await userEvent.click(screen.getByRole('button', { name: `Tambahkan ke batch (${n})` }));
  return { onSaved };
}

const sentNotes = (onSubmit: ReturnType<typeof vi.fn>) =>
  onSubmit.mock.calls.flatMap((call) =>
    (call[0] as { tasks: { note: string }[] }).tasks.map((task) => task.note),
  );

test('25 task dikirim berurutan dalam kelompok 10/10/5 lalu onSaved(25)', async () => {
  const onSubmit = vi.fn().mockResolvedValue([]);
  const { onSaved } = await pasteTasks(25, onSubmit);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (25)' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(25));
  expect(onSubmit.mock.calls.map((call) => (call[0] as { tasks: unknown[] }).tasks.length)).toEqual(
    [10, 10, 5],
  );
}, 60_000);

test('kelompok ke-2 gagal: kelompok 1 dilaporkan tersimpan dan dibuang dari draf; ulang hanya mengirim sisanya', async () => {
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => ({ number: `ST-${i + 1}` })))
    .mockRejectedValueOnce(
      new RpcError('VALIDATION', 'Input tidak valid', 'r1', {
        tasks: 'Task 3: Customer dinonaktifkan; aktifkan dulu di halaman Customer',
      }),
    )
    .mockResolvedValue([]);
  const { onSaved } = await pasteTasks(25, onSubmit);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (25)' }));
  const notice = await screen.findByRole('status');
  expect(notice).toHaveTextContent('10 dari 25 task sudah tersimpan');
  expect(notice).toHaveTextContent('ST-1');
  expect(notice).toHaveTextContent('15 task lainnya belum tersimpan');
  expect(onSaved).not.toHaveBeenCalled();
  // draf tinggal 15 kartu (task 11-25); galat menempel pada kartu ke-3 kelompok 2 = task 13
  expect(cards()).toHaveLength(15);
  expect(within(cards()[2] as HTMLElement).getByRole('alert')).toHaveTextContent(
    'Customer dinonaktifkan',
  );
  expect(noteOf(cards()[0] as HTMLElement)).toHaveTextContent('Barang 11 = 1 unit');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (15)' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(15));
  // tiap task terkirim tepat sekali ke server yang menerimanya: kelompok 1 (10), gagal (10), ulang 10+5
  const notes = sentNotes(onSubmit);
  expect(notes).toHaveLength(10 + 10 + 15);
  const accepted = [...notes.slice(0, 10), ...notes.slice(20)];
  expect(new Set(accepted).size).toBe(25);
}, 90_000);

test('galat jaringan pada kelompok pertama: tidak ada yang tersimpan, draf utuh, tanpa pemberitahuan tersimpan', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new RpcError('FORBIDDEN', 'Tidak punya izin', 'r3'));
  await pasteTasks(12, onSubmit);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan semua (12)' }));
  expect(await screen.findByText('Tidak punya izin')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(cards()).toHaveLength(12);
  expect(onSubmit).toHaveBeenCalledTimes(1);
}, 60_000);
