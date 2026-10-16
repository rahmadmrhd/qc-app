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

test('ganti PDF: konfirmasi menyebut URL tetap dan jumlah konfigurasi pemakai', async () => {
  const onUpload = vi.fn().mockResolvedValue({ ...doc, name: 'baru.pdf' });
  render(<PdfSourceField document={doc} onDocument={vi.fn()} onUpload={onUpload} />);
  expect(screen.getByDisplayValue(doc.link)).toHaveAttribute('readonly');
  await userEvent.upload(screen.getByLabelText('Pilih PDF'), pdf);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/URL tetap sama/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/2 konfigurasi/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ganti PDF' }));
  expect(onUpload).toHaveBeenCalledWith(pdf, 'd1');
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
