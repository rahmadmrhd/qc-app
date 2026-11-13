import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { PdfSourceField } from './pdf-source-field';

beforeEach(() => {
  resetUnsavedChangesForTests();
});

const doc = {
  id: 'd1',
  name: 'manual.pdf',
  link: 'https://drive.google.com/file/d/f1/view',
};
const pdf = new File(['%PDF-1.4'], 'baru.pdf', { type: 'application/pdf' });

test('unggah baru: dialog konfirmasi menyebut akses publik; batal tidak mengunggah', async () => {
  const onUpload = vi.fn().mockResolvedValue(doc);
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={onUpload} onClone={vi.fn()} />,
  );
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/siapa saja yang punya link/i)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onUpload).not.toHaveBeenCalled();
});

test('konfirmasi mengunggah; hasil diteruskan dan URL berbagi tampil hanya-baca', async () => {
  const onUpload = vi.fn().mockResolvedValue(doc);
  const onDocument = vi.fn();
  render(
    <PdfSourceField
      document={null}
      onDocument={onDocument}
      onUpload={onUpload}
      onClone={vi.fn()}
    />,
  );
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bagikan dan unggah' }),
  );
  expect(onUpload).toHaveBeenCalledWith(pdf, undefined);
  expect(onDocument).toHaveBeenCalledWith(doc);
});

test('PDF sudah terpasang: tanpa pilihan PDF baru; unggah selalu mengganti isi (URL tetap) tanpa info jumlah konfigurasi', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, name: 'baru.pdf' });
  render(
    <PdfSourceField document={doc} onDocument={vi.fn()} onUpload={onUpload} onClone={vi.fn()} />,
  );
  expect(screen.getByDisplayValue(doc.link)).toHaveAttribute('readonly');
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByText(/dipakai \d+ konfigurasi/)).toBeNull();
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/URL tetap sama/i)).toBeInTheDocument();
  expect(within(dialog).queryByText(/konfigurasi yang memakai/)).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ganti PDF' }));
  expect(onUpload).toHaveBeenCalledWith(pdf, 'd1');
});

test('tanpa PDF terpasang tidak ada pilihan mode (hanya unggah)', () => {
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  expect(screen.queryByRole('radio')).toBeNull();
});

test('PDF dengan tipe kosong (beberapa OS) diterima bila namanya berakhiran .pdf; nama bukan .pdf ditolak', async () => {
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  await userEvent.upload(
    screen.getByLabelText('Pilih PDF'),
    new File(['%PDF-1.4'], 'manual.PDF', { type: '' }),
    { applyAccept: false },
  );
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('berkas bukan PDF atau > 10 MB ditolak di klien tanpa dialog', async () => {
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  await userEvent.upload(
    screen.getByLabelText('Pilih PDF'),
    new File(['x'], 'a.txt', { type: 'text/plain' }),
    { applyAccept: false },
  );
  expect(await screen.findByText(/hanya berkas PDF/i)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('"Lihat PDF" membuka berkas di Drive pada tab baru; tidak ada tombol itu sebelum ada PDF', () => {
  const { rerender } = render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  expect(screen.queryByRole('link', { name: 'Lihat PDF' })).toBeNull();
  rerender(
    <PdfSourceField document={doc} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  const link = screen.getByRole('link', { name: 'Lihat PDF' });
  expect(link).toHaveAttribute('href', doc.link);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('dialog konfirmasi menyebut berbagi dicabut otomatis bila PDF tidak dipakai konfigurasi mana pun', async () => {
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  expect(
    await within(await screen.findByRole('dialog')).findByText(/dicabut otomatis/i),
  ).toBeInTheDocument();
});

test('salin dari Drive: link/ID dikirim ke onClone dan hasilnya menjadi dokumen; galat ditampilkan', async () => {
  const cloned = { ...doc, id: 'd9' };
  const onClone = vi
    .fn()
    .mockResolvedValueOnce(cloned)
    .mockRejectedValueOnce(new Error('Berkas Drive bukan PDF'));
  const onDocument = vi.fn();
  render(
    <PdfSourceField document={null} onDocument={onDocument} onUpload={vi.fn()} onClone={onClone} />,
  );
  const button = screen.getByRole('button', { name: 'Salin dari Drive' });
  expect(button).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText('Atau salin dari Google Drive'),
    ' https://drive.google.com/file/d/abc/view ',
  );
  await userEvent.click(button);
  expect(onClone).toHaveBeenCalledWith('https://drive.google.com/file/d/abc/view', undefined);
  await vi.waitFor(() => expect(onDocument).toHaveBeenCalledWith(cloned));
  await userEvent.type(screen.getByLabelText('Atau salin dari Google Drive'), 'xyz');
  await userEvent.click(screen.getByRole('button', { name: 'Salin dari Drive' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Berkas Drive bukan PDF');
});

test('PDF terpasang: isian salin dari Drive tetap ada dan mengganti isi PDF (dikonfirmasi, URL tetap)', async () => {
  const onClone = vi.fn().mockResolvedValue({ ...doc, name: 'dari-drive.pdf' });
  render(
    <PdfSourceField document={doc} onDocument={vi.fn()} onUpload={vi.fn()} onClone={onClone} />,
  );
  await userEvent.type(screen.getByLabelText('Atau ganti isi dari Google Drive'), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Ganti dari Drive' }));
  const dialog = await screen.findByRole('dialog');
  expect(onClone).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ganti PDF' }));
  await vi.waitFor(() => expect(onClone).toHaveBeenCalledWith('abc', 'd1'));
});

test('salin dari Drive: selama proses tampil keterangan langkah dan tombol berspinner', async () => {
  const onClone = vi.fn(() => new Promise<never>(() => undefined));
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={onClone} />,
  );
  await userEvent.type(screen.getByLabelText('Atau salin dari Google Drive'), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Salin dari Drive' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Memeriksa berkas di Drive, lalu menyalinnya ke folder aplikasi…',
  );
  expect(screen.getByRole('button', { name: 'Menyalin…' })).toBeDisabled();
});

test('M-g: tautan Drive yang sudah ditempel atau PDF yang menunggu konfirmasi terdaftar sebagai belum disimpan', async () => {
  render(
    <PdfSourceField
      document={doc}
      onDocument={vi.fn()}
      onUpload={vi.fn().mockResolvedValue(doc)}
      onClone={vi.fn()}
    />,
  );
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(hasUnsavedChanges()).toBe(false);
});

test('M-g: tautan Drive yang ditempel (belum dipakai) terdaftar dan terlepas bila dikosongkan', async () => {
  render(
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} onClone={vi.fn()} />,
  );
  const drive = screen.getByRole('textbox');
  await userEvent.type(drive, 'https://drive.google.com/file/d/abc/view');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.clear(drive);
  expect(hasUnsavedChanges()).toBe(false);
});
