import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { optionsApi, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => testMe() }));

import { BulkEditDialog } from './bulk-edit-dialog';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(optionsApi);
});

function renderDialog(over: Partial<Parameters<typeof BulkEditDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BulkEditDialog open count={3} onApply={onApply} onClose={onClose} {...over} />
    </QueryClientProvider>,
  );
  return { onApply, onClose };
}

test('tertutup tidak merender form', () => {
  renderDialog({ open: false });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Terapkan nonaktif sampai ada kolom yang diisi; kolom kosong tidak masuk patch', async () => {
  const { onApply } = renderDialog();
  const dialog = screen.getByRole('dialog', { name: 'Ubah 3 baris' });
  const apply = within(dialog).getByRole('button', { name: 'Terapkan ke 3 baris' });
  expect(apply).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('Catatan (ubah massal)'), '  periksa ulang ');
  expect(apply).toBeEnabled();
  await userEvent.click(apply);
  expect(onApply).toHaveBeenCalledWith({ note: 'periksa ulang' });
});

test('mengganti lokasi hanya membawa lokasi; Kosongkan catatan membawa catatan kosong', async () => {
  const { onApply } = renderDialog();
  await pickLink(screen, 'Lokasi (ubah massal)', 'Surabaya (SBY)');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Kosongkan catatan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 3 baris' }));
  expect(onApply).toHaveBeenCalledWith({
    locationId: 'l2',
    locationLabel: 'Surabaya (SBY)',
    note: '',
  });
});

test('Batal menutup tanpa menerapkan', async () => {
  const { onApply, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
});
