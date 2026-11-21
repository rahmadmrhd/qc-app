import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DeletedBanner } from './deleted-banner';

const info = { deletedAt: '2026-11-12T07:05:00.000Z', deletedBy: 'admin@gmail.com' };

it('menampilkan judul destructive, pelaku, dan tanggal WIB', () => {
  render(<DeletedBanner info={info} canRestore={false} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute('data-color', 'destructive');
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(alert).toHaveTextContent('oleh admin@gmail.com pada');
  // 07.05 UTC = 14.05 WIB
  expect(alert).toHaveTextContent(/12 Nov 2026,? 14\.05/);
});

it('tombol Pulihkan hanya bila canRestore, dan memanggil onRestore', async () => {
  const onRestore = vi.fn();
  const { rerender } = render(<DeletedBanner info={info} canRestore={false} />);
  expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
  rerender(<DeletedBanner info={info} canRestore onRestore={onRestore} />);
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
  expect(onRestore).toHaveBeenCalledTimes(1);
});

it('restoring menonaktifkan tombol Pulihkan', () => {
  render(<DeletedBanner info={info} canRestore restoring onRestore={() => {}} />);
  expect(screen.getByRole('button', { name: /Pulihkan/ })).toBeDisabled();
});
