import type { ClFileDto } from '@shared/contract';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { BinaryUploadDialog } from './binary-upload';

const SAVED = { id: 'f9', path: 'firmware/system.npk' } as ClFileDto;
const onUploaded = vi.fn();
const onOpenChange = vi.fn();

beforeEach(() => {
  onUploaded.mockReset();
  onOpenChange.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'clUploads.start') return { uploadId: 'u1', chunkBytes: 4 * 1024 * 1024 };
    if (id === 'clUploads.chunk') return { received: 1 };
    if (id === 'clUploads.finish') return SAVED;
    throw new Error(`api tak terduga: ${id}`);
  });
});

const dialog = (fixedPath?: string) =>
  renderInRouter(
    <BinaryUploadDialog
      open
      onOpenChange={onOpenChange}
      onUploaded={onUploaded}
      {...(fixedPath === undefined ? {} : { fixedPath })}
    />,
  );

const biner = () => new File([new Uint8Array([1, 2, 3, 4, 5])], 'system.npk');

describe('BinaryUploadDialog', () => {
  test('memilih berkas jenis apa pun mengisi nama, lalu Unggah menjalankan start, chunk, dan finish', async () => {
    await dialog();
    await userEvent.upload(await screen.findByTestId('file-picker-input'), biner());
    expect(
      ((await screen.findByLabelText(/Nama berkas di bundel/)) as HTMLInputElement).value,
    ).toBe('system.npk');
    await userEvent.click(screen.getByRole('button', { name: 'Unggah' }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(SAVED));
    expect(apiMock.mock.calls.map((call) => call[0])).toEqual([
      'clUploads.start',
      'clUploads.chunk',
      'clUploads.finish',
    ]);
    expect(apiMock.mock.calls[0]?.[1]).toMatchObject({
      path: 'system.npk',
      role: 'router',
      size: 5,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('jalur tetap (versi baru berkas yang ada): nama terkunci', async () => {
    await dialog('firmware/system.npk');
    const input = (await screen.findByLabelText(/Nama berkas di bundel/)) as HTMLInputElement;
    expect(input.value).toBe('firmware/system.npk');
    expect(input.disabled).toBe(true);
    await userEvent.upload(screen.getByTestId('file-picker-input'), biner());
    await userEvent.click(screen.getByRole('button', { name: 'Unggah' }));
    await waitFor(() =>
      expect(apiMock.mock.calls[0]?.[1]).toMatchObject({ path: 'firmware/system.npk' }),
    );
  });

  test('tanpa berkas: pesan galat dan server tidak dihubungi', async () => {
    await dialog();
    await userEvent.type(await screen.findByLabelText(/Nama berkas di bundel/), 'a.bin');
    await userEvent.click(screen.getByRole('button', { name: 'Unggah' }));
    expect(await screen.findByText('Pilih berkas yang akan diunggah')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  test('nama tak sah ditolak di klien', async () => {
    await dialog();
    await userEvent.upload(await screen.findByTestId('file-picker-input'), biner());
    const input = (await screen.findByLabelText(/Nama berkas di bundel/)) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '/mutlak.bin');
    await userEvent.click(screen.getByRole('button', { name: 'Unggah' }));
    expect(await screen.findByText(/tidak boleh diawali garis miring/)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  test('dialog ditutup saat unggahan hampir selesai: tidak berpindah halaman (onUploaded tak dipanggil)', async () => {
    let finishUpload: (file: ClFileDto) => void = () => undefined;
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clUploads.start') return { uploadId: 'u1', chunkBytes: 4 * 1024 * 1024 };
      if (id === 'clUploads.chunk') return { received: 1 };
      if (id === 'clUploads.finish') {
        return new Promise<ClFileDto>((resolve) => {
          finishUpload = resolve;
        });
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    let close: () => void = () => undefined;
    function Host() {
      const [open, setOpen] = useState(true);
      close = () => setOpen(false);
      return <BinaryUploadDialog open={open} onOpenChange={onOpenChange} onUploaded={onUploaded} />;
    }
    await renderInRouter(<Host />);
    await userEvent.upload(await screen.findByTestId('file-picker-input'), biner());
    await userEvent.click(screen.getByRole('button', { name: 'Unggah' }));
    await waitFor(() =>
      expect(apiMock.mock.calls.map((call) => call[0])).toContain('clUploads.finish'),
    );
    act(() => close());
    await act(async () => finishUpload(SAVED));
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
