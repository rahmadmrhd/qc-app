import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { type AttachmentRow, AttachmentsField } from './attachments-field';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('@/modules/qrcode/lib/download', () => ({ saveFileDownload: downloadMock }));

const onBusyChange = vi.fn();

const row = (i: number): AttachmentRow => ({
  id: `f${i}`,
  mime: 'application/pdf',
  size: 1000 * i,
  filename: `lampiran-0000000${i}.pdf`,
});

function Harness({ initial = [], error }: { initial?: AttachmentRow[]; error?: string }) {
  const [rows, setRows] = useState(initial);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <AttachmentsField value={rows} onChange={setRows} error={error} onBusyChange={onBusyChange} />
    </QueryClientProvider>
  );
}

const png = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });
const pdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], name, { type: 'application/pdf' });
const dto = (i: number, ext = 'png') => ({
  id: `u${i}`,
  mime: ext === 'pdf' ? 'application/pdf' : 'image/png',
  size: 1,
  filename: `lampiran-u${i}.${ext}`,
});

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Tambah lampiran' }));
  return screen.findByRole('alertdialog', { name: 'Tambah lampiran' });
}

/** Membuka dialog, memilih berkas lewat Telusuri, lalu menekan Tambahkan. */
async function addViaDialog(...files: File[]) {
  const dialog = await openDialog();
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  await userEvent.click(
    await within(dialog).findByRole('button', { name: `Tambahkan (${files.length})` }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockReset();
  onBusyChange.mockReset();
});

test('PDF dan gambar sama-sama diterima: mime dan byte dikirim apa adanya, baris tampil urut', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'postelFiles.upload') {
      return (input as { mime: string }).mime === 'application/pdf' ? dto(1, 'pdf') : dto(2);
    }
    return { id: 'u2', mime: 'image/png', bytes: new Uint8Array([1]), filename: 'x.png' };
  });
  render(<Harness />);
  await addViaDialog(new File([bytes], 'desain.pdf', { type: 'application/pdf' }), png('foto.png'));
  await screen.findByText('lampiran-u1.pdf');
  await screen.findByText('lampiran-u2.png');
  const uploads = apiMock.mock.calls.filter((call) => call[0] === 'postelFiles.upload');
  expect(uploads).toHaveLength(2);
  const first = uploads[0]?.[1] as { mime: string; bytes: Uint8Array };
  expect(first.mime).toBe('application/pdf');
  expect([...first.bytes]).toEqual([...bytes]);
  expect(screen.getByText('2/10')).toBeInTheDocument();
});

test('dialog tanpa Pustaka dan menawarkan Telusuri', async () => {
  render(<Harness />);
  const dialog = await openDialog();
  expect(within(dialog).queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeInTheDocument();
});

test('berkas text/html ditolak dengan pesan seragam tanpa unggahan', async () => {
  render(<Harness />);
  const dialog = await openDialog();
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['<b>x</b>'], 'x.html', { type: 'text/html' })] },
  });
  expect(await within(dialog).findByText(/Format tidak didukung/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Tambahkan (0)' })).toBeDisabled();
  expect(apiMock).not.toHaveBeenCalled();
});

test('berkas 10 MB + 1 byte ditolak dengan kalimat seragam; tepat 10 MB diterima', async () => {
  apiMock.mockResolvedValue(dto(1));
  render(<Harness />);
  const dialog = await openDialog();
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(10_485_761)], 'besar.png', { type: 'image/png' })] },
  });
  expect(await within(dialog).findByText(/Ukuran melebihi 10 MB/)).toBeInTheDocument();
  expect(apiMock).not.toHaveBeenCalled();
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(10_485_760)], 'pas.png', { type: 'image/png' })] },
  });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Tambahkan (1)' }));
  await waitFor(() =>
    expect(apiMock.mock.calls.filter((call) => call[0] === 'postelFiles.upload')).toHaveLength(1),
  );
});

test('batas 10 lampiran: tombol Tambah nonaktif dan seret-lepas ditolak dengan pesan batas', () => {
  render(<Harness initial={Array.from({ length: 10 }, (_, i) => row(i + 1))} />);
  expect(screen.getByRole('button', { name: 'Tambah lampiran' })).toBeDisabled();
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('a.png')], types: ['Files'] } });
  expect(screen.getByRole('alert')).toHaveTextContent('Maksimal 10 lampiran');
  expect(apiMock).not.toHaveBeenCalled();
});

test('batas 10 menghitung lampiran tersimpan dan unggahan berjalan', async () => {
  apiMock.mockImplementation(() => new Promise(() => undefined));
  render(<Harness initial={Array.from({ length: 9 }, (_, i) => row(i + 1))} />);
  await addViaDialog(png('a.png'));
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  expect(screen.getByText('10/10')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah lampiran' })).toBeDisabled();
});

test('11 berkas sekaligus: dialog menerima 10 dan menolak yang ke-11', async () => {
  render(<Harness />);
  const dialog = await openDialog();
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: Array.from({ length: 11 }, (_, i) => png(`f${i}.png`)) },
  });
  expect(await within(dialog).findByText(/Maksimal 10 berkas/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Tambahkan (10)' })).toBeInTheDocument();
});

test('Hapus (Buang) menghilangkan baris', async () => {
  render(<Harness initial={[row(1), row(2)]} />);
  await userEvent.click(screen.getByRole('button', { name: /^Buang lampiran-00000001\.pdf/ }));
  expect(screen.queryByText('lampiran-00000001.pdf')).not.toBeInTheDocument();
  expect(screen.getByText('lampiran-00000002.pdf')).toBeInTheDocument();
});

test('galat server pada field bytes ditampilkan apa adanya pada unggahan gagal', async () => {
  apiMock.mockRejectedValueOnce(
    new ApiError('VALIDATION', 'Data tidak valid', 'r1', {
      bytes: 'Isi berkas tidak sesuai jenis gambar',
    }),
  );
  render(<Harness />);
  await addViaDialog(png('a.png'));
  expect(await screen.findByText('Isi berkas tidak sesuai jenis gambar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ulangi a' })).toBeInTheDocument();
  expect(screen.queryByText('Belum ada lampiran.')).not.toBeInTheDocument();
  expect(screen.getByText('0/10')).toBeInTheDocument();
});

test('PDF hanya Unduh: memanggil postelFiles.get lalu saveFileDownload; tanpa pratinjau', async () => {
  const bytes = new Uint8Array([1, 2]);
  apiMock.mockResolvedValueOnce({ id: 'f1', mime: 'application/pdf', bytes, filename: 'x.pdf' });
  render(<Harness initial={[row(1)]} />);
  expect(screen.queryByRole('button', { name: /^Perbesar/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Unduh lampiran-00000001\.pdf/ }));
  expect(apiMock).toHaveBeenCalledWith('postelFiles.get', { id: 'f1' });
  await waitFor(() =>
    expect(downloadMock).toHaveBeenCalledWith({
      bytes,
      mime: 'application/pdf',
      filename: 'lampiran-00000001.pdf',
    }),
  );
});

test('gambar dimuat lewat postelFiles.get; thumbnail diklik membuka pratinjau besar', async () => {
  apiMock.mockResolvedValue({
    id: 'g1',
    mime: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
    filename: 'lampiran-bbbbbbbb.png',
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:postel-g1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  render(
    <Harness
      initial={[{ id: 'g1', mime: 'image/png', size: 4, filename: 'lampiran-bbbbbbbb.png' }]}
    />,
  );
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('postelFiles.get', { id: 'g1' }));
  const thumb = await screen.findByRole('button', { name: /^Perbesar lampiran-bbbbbbbb\.png/ });
  expect(within(thumb).getByRole('img')).toHaveAttribute('src', 'blob:postel-g1');
  // Gambar hanya pratinjau: tanpa tombol Unduh (hanya PDF yang diunduh; keputusan pemilik 2026-11-20).
  expect(screen.queryByRole('button', { name: /^Unduh / })).not.toBeInTheDocument();
  expect(downloadMock).not.toHaveBeenCalled();
  await userEvent.click(thumb);
  const dialog = await screen.findByRole('dialog', { name: 'lampiran-bbbbbbbb.png' });
  expect(within(dialog).getByRole('img', { name: 'lampiran-bbbbbbbb.png' })).toHaveAttribute(
    'src',
    'blob:postel-g1',
  );
});

test('seret-lepas ke field membuka dialog berisi berkas itu lalu mengunggah', async () => {
  apiMock.mockResolvedValue(dto(1, 'pdf'));
  render(<Harness />);
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [pdf('seret.pdf')], types: ['Files'] } });
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah lampiran' });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Tambahkan (1)' }));
  await screen.findByText('lampiran-u1.pdf');
  expect(apiMock).toHaveBeenCalledWith(
    'postelFiles.upload',
    { mime: 'application/pdf', bytes: expect.any(Uint8Array) },
    expect.anything(),
  );
});

test('onBusyChange true selama unggahan berjalan, false setelah selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  apiMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  await addViaDialog(pdf('a.pdf'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(await screen.findByTestId('attachment-pending')).toBeInTheDocument();
  finish(dto(1, 'pdf'));
  await screen.findByText('lampiran-u1.pdf');
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});

test('F1: unggahan gagal tetap menahan (true) sampai Ulangi berhasil atau dibuang', async () => {
  apiMock.mockRejectedValueOnce(new Error('putus'));
  render(<Harness />);
  await addViaDialog(pdf('a.pdf'));
  expect(await screen.findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  apiMock.mockResolvedValueOnce(dto(1, 'pdf'));
  await userEvent.click(screen.getByRole('button', { name: /^Ulangi / }));
  await screen.findByText('lampiran-u1.pdf');
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  apiMock.mockRejectedValueOnce(new Error('putus'));
  await addViaDialog(pdf('b.pdf'));
  await userEvent.click(await screen.findByRole('button', { name: /^Buang b/ }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});

test('galat dari induk tampil sebagai alert', () => {
  render(<Harness error="Lampiran maksimal 10 berkas" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Lampiran maksimal 10 berkas');
});

test('jenis kosong diturunkan dari ekstensi (.PDF diterima, dikirim sebagai application/pdf)', async () => {
  apiMock.mockResolvedValueOnce(dto(1, 'pdf'));
  render(<Harness />);
  await addViaDialog(
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'desain.PDF', { type: '' }),
  );
  await screen.findByText('lampiran-u1.pdf');
  expect(apiMock.mock.calls[0]?.[1]).toMatchObject({ mime: 'application/pdf' });
});
