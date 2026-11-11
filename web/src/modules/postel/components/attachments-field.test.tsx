import { render, screen, waitFor, within } from '@testing-library/react';
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

const row = (i: number): AttachmentRow => ({
  id: `f${i}`,
  mime: 'application/pdf',
  size: 1000 * i,
  filename: `lampiran-0000000${i}.pdf`,
});

function Harness({ initial = [], error }: { initial?: AttachmentRow[]; error?: string }) {
  const [rows, setRows] = useState(initial);
  return <AttachmentsField value={rows} onChange={setRows} error={error} />;
}

const picker = () => screen.getByLabelText('Pilih lampiran') as HTMLInputElement;
const choose = (...files: File[]) => userEvent.upload(picker(), files, { applyAccept: false });

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockReset();
});

test('unggah PDF memanggil postelFiles.upload dengan mime dan byte tak berubah, lalu baris tampil', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  apiMock.mockResolvedValueOnce({
    id: 'f1',
    mime: 'application/pdf',
    size: bytes.length,
    filename: 'lampiran-abcd1234.pdf',
  });
  render(<Harness />);
  await choose(new File([bytes], 'desain.pdf', { type: 'application/pdf' }));
  await screen.findByText('lampiran-abcd1234.pdf');
  expect(apiMock).toHaveBeenCalledTimes(1);
  const [id, input] = apiMock.mock.calls[0] as [string, { mime: string; bytes: Uint8Array }];
  expect(id).toBe('postelFiles.upload');
  expect(input.mime).toBe('application/pdf');
  expect([...input.bytes]).toEqual([...bytes]);
});

test('berkas text/html ditolak tanpa unggahan', async () => {
  render(<Harness />);
  await choose(new File(['<b>x</b>'], 'x.html', { type: 'text/html' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hanya JPEG, PNG, WebP, atau PDF');
  expect(apiMock).not.toHaveBeenCalled();
});

test('berkas 10 MB + 1 byte ditolak; tepat 10 MB diterima', async () => {
  apiMock.mockResolvedValue({ id: 'f1', mime: 'image/png', size: 1, filename: 'lampiran-1.png' });
  render(<Harness />);
  await choose(new File([new Uint8Array(10_485_761)], 'besar.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Berkas melebihi 10 MB');
  expect(apiMock).not.toHaveBeenCalled();
  await choose(new File([new Uint8Array(10_485_760)], 'pas.png', { type: 'image/png' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
});

test('berkas ke-11 ditolak', async () => {
  render(<Harness initial={Array.from({ length: 10 }, (_, i) => row(i + 1))} />);
  await choose(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 10 lampiran');
  expect(apiMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Tambah lampiran' })).toBeDisabled();
});

test('Hapus menghilangkan baris', async () => {
  render(<Harness initial={[row(1), row(2)]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus lampiran 1' }));
  expect(screen.queryByText('lampiran-00000001.pdf')).not.toBeInTheDocument();
  expect(screen.getByText('lampiran-00000002.pdf')).toBeInTheDocument();
});

test('galat server pada field bytes ditampilkan apa adanya', async () => {
  apiMock.mockRejectedValueOnce(
    new ApiError('VALIDATION', 'Data tidak valid', 'r1', {
      bytes: 'Isi berkas tidak sesuai jenis gambar',
    }),
  );
  render(<Harness />);
  await choose(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Isi berkas tidak sesuai jenis gambar',
  );
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
});

test('Unduh memanggil postelFiles.get lalu saveFileDownload dengan nama dari baris', async () => {
  const bytes = new Uint8Array([1, 2]);
  apiMock.mockResolvedValueOnce({ id: 'f1', mime: 'application/pdf', bytes, filename: 'x.pdf' });
  render(<Harness initial={[row(1)]} />);
  const item = screen.getByRole('listitem');
  await userEvent.click(within(item).getByRole('button', { name: 'Unduh' }));
  expect(apiMock).toHaveBeenCalledWith('postelFiles.get', { id: 'f1' });
  expect(downloadMock).toHaveBeenCalledWith({
    bytes,
    mime: 'application/pdf',
    filename: 'lampiran-00000001.pdf',
  });
});

test('galat dari induk tampil sebagai alert', () => {
  render(<Harness error="Lampiran maksimal 10 berkas" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Lampiran maksimal 10 berkas');
});

const dto = (i: number) => ({
  id: `u${i}`,
  mime: 'image/png',
  size: 1,
  filename: `lampiran-u${i}.png`,
});
const png = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

test('banyak berkas sekaligus: urutan terjaga; yang gagal dilewati dan yang berhasil dipertahankan', async () => {
  apiMock
    .mockResolvedValueOnce(dto(1))
    .mockRejectedValueOnce(
      new ApiError('VALIDATION', 'x', 'r', { bytes: 'Isi berkas tidak sesuai jenis gambar' }),
    )
    .mockResolvedValueOnce(dto(3));
  render(<Harness />);
  await choose(png('a.png'), png('b.png'), png('c.png'));
  await screen.findByText('lampiran-u3.png');
  const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
  expect(names[0]).toContain('lampiran-u1.png');
  expect(names[1]).toContain('lampiran-u3.png');
  expect(names).toHaveLength(2);
  expect(screen.getByRole('alert')).toHaveTextContent('Isi berkas tidak sesuai jenis gambar');
});

test('batas 10 menghitung unggahan yang sedang berjalan (dua pemilihan tumpang tindih)', async () => {
  let finish: (value: unknown) => void = () => undefined;
  apiMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness initial={Array.from({ length: 9 }, (_, i) => row(i + 1))} />);
  await choose(png('a.png'));
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  // 9 tersimpan + 1 berjalan = 10: pilihan kedua harus ditolak sebelum diunggah
  await choose(png('b.png'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 10 lampiran');
  expect(apiMock).toHaveBeenCalledTimes(1);
  finish(dto(10));
  await screen.findByText('lampiran-u10.png');
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
});

test('galat berkas dikumpulkan dan tanpa duplikat', async () => {
  render(<Harness />);
  await choose(
    new File(['x'], 'a.html', { type: 'text/html' }),
    new File(['x'], 'b.html', { type: 'text/html' }),
    new File([new Uint8Array(10_485_761)], 'besar.png', { type: 'image/png' }),
  );
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.map((alert) => alert.textContent)).toEqual([
    'Hanya JPEG, PNG, WebP, atau PDF',
    'Berkas melebihi 10 MB',
  ]);
  expect(apiMock).not.toHaveBeenCalled();
});

test('jenis kosong diturunkan dari ekstensi (.pdf diterima); ekstensi asing ditolak', async () => {
  apiMock.mockResolvedValueOnce(dto(1));
  render(<Harness />);
  await choose(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'desain.PDF', { type: '' }));
  await screen.findByText('lampiran-u1.png');
  expect(apiMock).toHaveBeenCalledWith('postelFiles.upload', {
    mime: 'application/pdf',
    bytes: expect.any(Uint8Array),
  });
  await choose(new File(['x'], 'catatan.txt', { type: '' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Hanya JPEG, PNG, WebP, atau PDF');
  expect(apiMock).toHaveBeenCalledTimes(1);
});
