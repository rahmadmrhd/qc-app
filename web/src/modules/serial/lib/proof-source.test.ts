import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.fn();
const prepareImageMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('@/modules/files/image', () => ({
  prepareImage: (...args: unknown[]) => prepareImageMock(...args),
}));

const discardMock = vi.fn();
vi.mock('../queries', () => ({
  discardProofPhotos: (...args: unknown[]) => discardMock(...args),
}));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { isLibrarySource } from '@/components/file-dialog/types';
import { proofSource, proofThumbUrl, toProofRef } from './proof-source';

const dto = {
  id: 'p1',
  state: 'draft',
  mime: 'image/webp',
  size: 1234,
  width: 800,
  height: 600,
  filename: 'bukti-p1.webp',
  error: null,
};

beforeEach(() => {
  discardMock.mockReset();
  apiMock.mockReset();
  prepareImageMock.mockReset();
  resetBusyForTests();
});

test('sumber hanya mendukung gambar dan punya kunci cache sendiri', () => {
  expect(proofSource.key).toBe('serial-proofs');
  expect(proofSource.mimeTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
});

test('URL pratinjau diturunkan dari id dan meloloskan id tak aman', () => {
  expect(proofThumbUrl('p1')).toBe('/api/v1/serial-proofs/p1');
  expect(proofThumbUrl('a/b?c')).toBe('/api/v1/serial-proofs/a%2Fb%3Fc');
});

test('upload mengecilkan gambar lalu mengunggah lewat serialProofs.upload', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  prepareImageMock.mockResolvedValue({ mime: 'image/webp', bytes, width: 800, height: 600 });
  apiMock.mockResolvedValue(dto);
  const file = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' });
  const item = await proofSource.upload(file, 'x');
  expect(prepareImageMock).toHaveBeenCalledWith(file);
  expect(apiMock).toHaveBeenCalledWith(
    'serialProofs.upload',
    { mime: 'image/webp', bytes, width: 800, height: 600 },
    {},
  );
  expect(item).toMatchObject({
    id: 'p1',
    size: 1234,
    width: 800,
    height: 600,
    thumbUrl: '/api/v1/serial-proofs/p1',
    previewUrl: '/api/v1/serial-proofs/p1',
    canRename: false,
    canRemove: false,
  });
  expect(toProofRef(item)).toEqual({
    id: 'p1',
    mime: 'image/webp',
    size: 1234,
    thumbUrl: '/api/v1/serial-proofs/p1',
  });
});

test('upload dihitung sebagai penulisan berjalan dan dilepas setelah galat', async () => {
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(1),
    width: 1,
    height: 1,
  });
  let release: (value: unknown) => void = () => undefined;
  apiMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const pending = proofSource.upload(
    new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }),
    'x',
  );
  await vi.waitFor(() => expect(isBusy()).toBe(true));
  release(dto);
  await pending;
  expect(isBusy()).toBe(false);

  apiMock.mockRejectedValue(new Error('gagal'));
  await expect(
    proofSource.upload(new File([new Uint8Array(1)], 'y.png', { type: 'image/png' }), 'y'),
  ).rejects.toThrow('gagal');
  expect(isBusy()).toBe(false);
});

test('upload melapor fase preparing lalu uploading, dan processing setelah byte penuh', async () => {
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 1,
    height: 1,
  });
  apiMock.mockImplementation(
    async (
      _id: string,
      _input: unknown,
      options: { onUploadProgress?: (loaded: number, total: number) => void },
    ) => {
      options.onUploadProgress?.(1, 4);
      options.onUploadProgress?.(4, 4);
      return dto;
    },
  );
  const phases: [string, number | null][] = [];
  await proofSource.upload(new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }), 'x', {
    onProgress: (phase, fraction) => phases.push([phase, fraction]),
  });
  expect(phases.map(([phase]) => phase)).toEqual([
    'preparing',
    'uploading',
    'uploading',
    'uploading',
    'processing',
  ]);
  expect(phases[2]?.[1]).toBe(0.25);
  expect(phases[3]?.[1]).toBe(1);
});

test('signal yang sudah abort tidak memanggil API; signal hidup diteruskan ke api()', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    proofSource.upload(new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }), 'x', {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(apiMock).not.toHaveBeenCalled();
  expect(prepareImageMock).not.toHaveBeenCalled();

  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(1),
    width: 1,
    height: 1,
  });
  apiMock.mockResolvedValue(dto);
  const live = new AbortController();
  await proofSource.upload(new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }), 'x', {
    signal: live.signal,
  });
  expect(apiMock.mock.calls[0]?.[2]).toMatchObject({ signal: live.signal });
});

test('abort setelah pengecilan membatalkan sebelum unggah', async () => {
  const controller = new AbortController();
  prepareImageMock.mockImplementation(async () => {
    controller.abort();
    return { mime: 'image/webp', bytes: new Uint8Array(1), width: 1, height: 1 };
  });
  await expect(
    proofSource.upload(new File([new Uint8Array(1)], 'x.png', { type: 'image/png' }), 'x', {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(apiMock).not.toHaveBeenCalled();
});

test('onDiscard membuang foto lewat discardProofPhotos; proofSource bukan sumber pustaka', async () => {
  discardMock.mockResolvedValue(undefined);
  await proofSource.onDiscard?.([{ id: 'a' }, { id: 'b' }] as never);
  expect(discardMock).toHaveBeenCalledWith(['a', 'b']);
  expect(isLibrarySource(proofSource)).toBe(false);
});
