import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PdfSourceField } from './pdf-source-field';

const doc = {
  id: 'd1',
  name: 'manual.pdf',
  link: 'https://drive.google.com/file/d/f1/view',
  uses: 2,
};
const pdf = new File(['%PDF-1.4'], 'baru.pdf', { type: 'application/pdf' });

test('unggah baru: dialog konfirmasi menyebut akses publik; batal tidak mengunggah', async () => {
  const onUpload = vi.fn().mockResolvedValue(doc);
  render(<PdfSourceField document={null} onDocument={vi.fn()} onUpload={onUpload} />);
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/siapa saja yang punya link/i)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onUpload).not.toHaveBeenCalled();
});

test('konfirmasi mengunggah; hasil diteruskan dan URL berbagi tampil hanya-baca', async () => {
  const onUpload = vi.fn().mockResolvedValue(doc);
  const onDocument = vi.fn();
  render(<PdfSourceField document={null} onDocument={onDocument} onUpload={onUpload} />);
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bagikan dan unggah' }),
  );
  expect(onUpload).toHaveBeenCalledWith(pdf, undefined);
  expect(onDocument).toHaveBeenCalledWith(doc);
});

test('ganti isi PDF (dipilih eksplisit): konfirmasi menyebut URL tetap dan jumlah konfigurasi pemakai', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, name: 'baru.pdf' });
  render(<PdfSourceField document={doc} onDocument={vi.fn()} onUpload={onUpload} />);
  expect(screen.getByDisplayValue(doc.link)).toHaveAttribute('readonly');
  await userEvent.click(screen.getByRole('radio', { name: /Ganti isi PDF ini/ }));
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/URL tetap sama/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/2 konfigurasi/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ganti PDF' }));
  expect(onUpload).toHaveBeenCalledWith(pdf, 'd1');
});

test('PDF dipakai banyak konfigurasi: bawaan = PDF BARU (URL baru), isi PDF bersama tidak tertimpa', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, id: 'd2', name: 'baru.pdf', uses: 0 });
  const onDocument = vi.fn();
  render(<PdfSourceField document={doc} onDocument={onDocument} onUpload={onUpload} />);
  expect(screen.getByRole('radio', { name: /Pakai PDF baru/ })).toBeChecked();
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/siapa saja yang punya link/i)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Bagikan dan unggah' }));
  expect(onUpload).toHaveBeenCalledWith(pdf, undefined);
  expect(onDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2' }));
});

test('PDF hanya dipakai satu konfigurasi: bawaan = ganti isi (URL tetap); pilihan dapat dibalik', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, uses: 1 });
  render(
    <PdfSourceField document={{ ...doc, uses: 1 }} onDocument={vi.fn()} onUpload={onUpload} />,
  );
  expect(screen.getByRole('radio', { name: /Ganti isi PDF ini/ })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: /Pakai PDF baru/ }));
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bagikan dan unggah' }),
  );
  expect(onUpload).toHaveBeenCalledWith(pdf, undefined);
});

test('tanpa PDF terpasang tidak ada pilihan mode (hanya unggah)', () => {
  render(<PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} />);
  expect(screen.queryByRole('radio')).toBeNull();
});

test('PDF dengan tipe kosong (beberapa OS) diterima bila namanya berakhiran .pdf; nama bukan .pdf ditolak', async () => {
  render(<PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} />);
  await userEvent.upload(
    screen.getByLabelText('Pilih PDF'),
    new File(['%PDF-1.4'], 'manual.PDF', { type: '' }),
    { applyAccept: false },
  );
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('berkas bukan PDF atau > 10 MB ditolak di klien tanpa dialog', async () => {
  render(<PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} />);
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
    <PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} />,
  );
  expect(screen.queryByRole('link', { name: 'Lihat PDF' })).toBeNull();
  rerender(<PdfSourceField document={doc} onDocument={vi.fn()} onUpload={vi.fn()} />);
  const link = screen.getByRole('link', { name: 'Lihat PDF' });
  expect(link).toHaveAttribute('href', doc.link);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('dialog konfirmasi menyebut berbagi dicabut otomatis bila PDF tidak dipakai konfigurasi mana pun', async () => {
  render(<PdfSourceField document={null} onDocument={vi.fn()} onUpload={vi.fn()} />);
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  expect(
    await within(await screen.findByRole('dialog')).findByText(/dicabut otomatis/i),
  ).toBeInTheDocument();
});

test('sudah diekspor (replaceOnly): tanpa pilihan PDF baru; unggah selalu mengganti isi dokumen yang sama', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, name: 'baru.pdf' });
  render(
    <PdfSourceField
      document={{ ...doc, uses: 3 }}
      onDocument={vi.fn()}
      onUpload={onUpload}
      replaceOnly
    />,
  );
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByText(/sudah diekspor/i)).toBeInTheDocument();
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ganti PDF' }),
  );
  await vi.waitFor(() => expect(onUpload).toHaveBeenCalledWith(pdf, 'd1'));
});
