import type { SerialDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { optionsApi, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => testMe() }));

import { EditSerialDialog } from './edit-serial-dialog';

// Catatan lama teks biasa; editor Markdown yang SUNGGUHAN (tanpa mock) dipakai agar normalisasi terdeteksi.
const OLD_NOTE = '  baris satu\nbaris dua_x_ *y*  ';

const SERIAL = {
  id: 's1',
  buId: 'b1',
  buCode: 'BU1',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Jakarta',
  status: 'good',
  custody: 'qc',
  note: OLD_NOTE,
  updatedAt: '2026-11-11T03:00:00.000Z',
} as unknown as SerialDto;

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.update' ? Promise.resolve({ ...SERIAL, ...input }) : optionsApi(id, input),
  );
});

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EditSerialDialog serial={SERIAL} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const updates = () => apiMock.mock.calls.filter((call) => call[0] === 'serials.update');

test('membuka lalu menyimpan tanpa menyentuh catatan: catatan dikirim persis seperti semula, tanpa pangkas', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  // Catatan tampil di editor, tetapi belum ada perubahan: Simpan nonaktif (editor tidak menormalkan saat dibuka).
  expect(within(dialog).getByRole('textbox', { name: 'Catatan' })).toHaveTextContent('baris satu');
  const save = within(dialog).getByRole('button', { name: 'Simpan' });
  expect(save).toBeDisabled();

  // Ubah kolom lain saja.
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sample' }));
  await userEvent.click(save);
  await waitFor(() => expect(updates()).toHaveLength(1));
  expect(updates()[0]?.[1]).toMatchObject({ sample: true, note: OLD_NOTE });
});

test('P6: dialog Ubah data serial layar penuh di ponsel', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAttribute('data-size', 'full-on-phone');
  expect(dialog.className).toContain('max-md:data-[size=full-on-phone]:h-[var(--vvh,100dvh)]');
  expect(dialog.className).toContain(
    'max-md:data-[size=full-on-phone]:pt-[env(safe-area-inset-top)]',
  );
});
