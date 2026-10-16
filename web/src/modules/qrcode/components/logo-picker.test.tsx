import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LogoPicker } from './logo-picker';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
  useUploadFile: () => ({ mutateAsync: vi.fn() }),
}));

test('memilih logo dari pustaka atau tanpa logo; tidak ada unggah', async () => {
  const onChange = vi.fn();
  render(<LogoPicker value="a" onChange={onChange} library={['a', 'b']} />);
  expect(screen.getByRole('radio', { name: 'Logo 1' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: 'Logo 2' }));
  expect(onChange).toHaveBeenLastCalledWith('b');
  await userEvent.click(screen.getByRole('radio', { name: 'Tanpa logo' }));
  expect(onChange).toHaveBeenLastCalledWith('');
  expect(screen.queryByLabelText(/unggah/i)).toBeNull();
});

test('pustaka kosong: pesan mengarahkan ke Konfigurasi default; logo lama di luar pustaka tetap bisa dipertahankan', () => {
  const { rerender } = render(<LogoPicker value="" onChange={vi.fn()} library={[]} />);
  expect(screen.getByText(/Pustaka logo masih kosong/)).toBeInTheDocument();
  rerender(<LogoPicker value="lama" onChange={vi.fn()} library={[]} />);
  expect(screen.getByRole('radio', { name: 'Logo saat ini (di luar pustaka)' })).toBeChecked();
});
