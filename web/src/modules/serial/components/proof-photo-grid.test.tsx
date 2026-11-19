import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import { ProofPhotoGrid } from './proof-photo-grid';

const ref = (id: string): ProofPhotoRef => ({
  id,
  mime: 'image/webp',
  size: 100,
  thumbUrl: `/api/v1/serial-proofs/${id}`,
});

test('tanpa foto tidak merender apa pun', () => {
  const { container } = render(<ProofPhotoGrid photos={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('klik gambar membuka pratinjau besar; Esc menutup tanpa membuang foto', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(<ProofPhotoGrid photos={[ref('a'), ref('b')]} onRemove={onRemove} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Perbesar foto 2' }));
  const dialog = await screen.findByRole('dialog');
  expect(screen.getByRole('img', { name: 'Pratinjau besar foto 2' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/b',
  );
  expect(dialog).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onRemove).not.toHaveBeenCalled();
  expect(screen.getAllByRole('img', { name: /^Foto bukti/ })).toHaveLength(2);
});

test('tombol buang memanggil onRemove dengan fotonya dan tidak membuka pratinjau', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(<ProofPhotoGrid photos={[ref('a'), ref('b')]} onRemove={onRemove} label="AAA111" />);
  await user.click(screen.getByRole('button', { name: 'Buang foto 1, AAA111' }));
  expect(onRemove).toHaveBeenCalledWith(ref('a'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('tanpa onRemove tidak ada tombol buang; disabled mengunci tombol buang', () => {
  const view = render(<ProofPhotoGrid photos={[ref('a')]} />);
  expect(screen.queryByRole('button', { name: /^Buang foto/ })).not.toBeInTheDocument();
  view.rerender(<ProofPhotoGrid photos={[ref('a')]} onRemove={() => undefined} disabled />);
  expect(screen.getByRole('button', { name: 'Buang foto 1' })).toBeDisabled();
});

test('gambar yang tak bisa dimuat diganti keterangan; tombol buang tetap ada', () => {
  render(<ProofPhotoGrid photos={[ref('a'), ref('b')]} onRemove={() => undefined} />);
  fireEvent.error(screen.getByRole('img', { name: 'Foto bukti 1' }));
  expect(screen.getByText(/Foto kedaluwarsa/)).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Foto bukti 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buang foto 1' })).toBeInTheDocument();
});
