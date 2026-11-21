import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { StagingRow } from '@/modules/serial/lib/draft';
import { makeRow, optionsApi, testMe } from '@/modules/serial/test-support';
import { mockMatchMedia } from '@/test/match-media';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordDialog } from './record-dialog';

type Held = { ok: () => void; fail: (message: string) => void };
let uploads: Held[] = [];
let aborted = 0;
let media: ReturnType<typeof mockMatchMedia>;

beforeEach(() => {
  localStorage.clear();
  uploads = [];
  aborted = 0;
  media = mockMatchMedia(true);
  me = testMe();
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation(
    (id: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      if (id !== 'serialProofs.upload') return optionsApi(id, input);
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          aborted += 1;
          reject(new DOMException('Dibatalkan', 'AbortError'));
        });
        uploads.push({
          ok: () =>
            resolve({
              id: `up${uploads.length}`,
              state: 'draft',
              mime: 'image/webp',
              size: 100,
              width: 10,
              height: 10,
              filename: 'bukti.webp',
              error: null,
            }),
          fail: (message) => reject(new Error(message)),
        });
      });
    },
  );
});

afterEach(() => {
  media.restore();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

/** Seperti halaman Country Lock: dialog dibuka/ditutup, tabel draft milik induk dan bertahan setelah ditutup. */
function Host({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<StagingRow[]>([makeRow('AAA111')]);
  return (
    <>
      <p data-testid="state">{open ? 'terbuka' : 'tertutup'}</p>
      <p data-testid="rows">{rows.length}</p>
      <RecordDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClosed?.();
        }}
        draft={{ rows, replace: setRows }}
      />
    </>
  );
}

function renderHost(onClosed?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Host {...(onClosed ? { onClosed } : {})} />
    </QueryClientProvider>,
  );
}

async function addPhoto() {
  await userEvent.click(await screen.findByRole('button', { name: /^Foto \(\d+\), AAA111$/ }));
  const picker = await screen.findByRole('alertdialog', { name: 'Foto bukti' });
  const input = picker.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'f.jpg', { type: 'image/jpeg' })] },
  });
  await userEvent.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Foto bukti' })).toBeNull());
  await waitFor(() => expect(uploads).toHaveLength(1));
}

const recordDialog = () => screen.getByRole('dialog', { name: 'Catat Serial Number' });
const confirmDialog = () => screen.queryByRole('alertdialog', { name: 'Tutup dan buang foto?' });

test('tanpa unggahan berjalan/gagal: Esc menutup langsung tanpa konfirmasi', async () => {
  renderHost();
  await screen.findByRole('dialog', { name: 'Catat Serial Number' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('tertutup'));
  expect(confirmDialog()).toBeNull();
});

test('ada unggahan berjalan: tombol X meminta konfirmasi; "Tetap di sini" menjaga dialog dan unggahan', async () => {
  renderHost();
  await addPhoto();
  await userEvent.click(within(recordDialog()).getByRole('button', { name: /^(Close|Tutup)/ }));
  expect(
    await screen.findByRole('alertdialog', { name: 'Tutup dan buang foto?' }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('state')).toHaveTextContent('terbuka');
  await userEvent.click(screen.getByRole('button', { name: 'Tetap di sini' }));
  await waitFor(() => expect(confirmDialog()).toBeNull());
  expect(screen.getByTestId('state')).toHaveTextContent('terbuka');
  expect(aborted).toBe(0);
  // Unggahan masih jalan dan bisa selesai.
  await act(async () => uploads[0]?.ok());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeInTheDocument(),
  );
});

test('ada unggahan berjalan: Esc juga meminta konfirmasi; "Tutup dan buang foto" menutup dan membatalkan unggahan', async () => {
  const onClosed = vi.fn();
  renderHost(onClosed);
  await addPhoto();
  await userEvent.keyboard('{Escape}');
  expect(
    await screen.findByRole('alertdialog', { name: 'Tutup dan buang foto?' }),
  ).toBeInTheDocument();
  expect(onClosed).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Tutup dan buang foto' }));
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('tertutup'));
  expect(onClosed).toHaveBeenCalledOnce();
  // Pemilik hook dilepas: unggahan dibatalkan; draf baris tidak dibuang.
  expect(aborted).toBe(1);
  expect(screen.getByTestId('rows')).toHaveTextContent('1');
});

test('unggahan gagal juga menahan penutupan', async () => {
  renderHost();
  await addPhoto();
  await act(async () => uploads[0]?.fail('Server menolak'));
  expect(await screen.findByText('Server menolak')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(
    await screen.findByRole('alertdialog', { name: 'Tutup dan buang foto?' }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('state')).toHaveTextContent('terbuka');
});

test('setelah unggahan selesai, dialog menutup biasa lagi', async () => {
  renderHost();
  await addPhoto();
  await act(async () => uploads[0]?.ok());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeInTheDocument(),
  );
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('tertutup'));
  expect(confirmDialog()).toBeNull();
});

test('P6: dialog Catat Serial Country Lock layar penuh di ponsel; tinggi tetap desktop', async () => {
  renderHost();
  const dialog = await screen.findByRole('dialog', { name: 'Catat Serial Number' });
  expect(dialog).toHaveAttribute('data-size', 'full-on-phone');
  expect(dialog.className).toContain('max-md:data-[size=full-on-phone]:h-[var(--vvh,100dvh)]');
  expect(dialog.className).toContain(
    'max-md:data-[size=full-on-phone]:pt-[env(safe-area-inset-top)]',
  );
  expect(dialog.className).toContain('h-[calc(100dvh-2rem)]');
});
