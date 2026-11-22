import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PostelFormPage } from './postel-form-page';

vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: vi.fn(),
}));
// Unggahan nyata dijalankan `attachments-field.test.tsx`; di sini cukup sinyal sibuk dari bidang lampiran.
vi.mock('./attachments-field', () => ({
  AttachmentsField: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        mulai unggah
      </button>
      <button type="button" onClick={() => onBusyChange?.(false)}>
        selesai unggah
      </button>
    </>
  ),
}));

test('unggahan lampiran berjalan atau gagal menahan Simpan sampai selesai', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PostelFormPage soonDays={90} today="2026-11-12" onDone={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('tab', { name: 'Catatan dan lampiran' }));
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'mulai unggah' }));
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'selesai unggah' }));
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});
