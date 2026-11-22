import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.fn();
const prepareImageMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('./image', () => ({ prepareImage: (...args: unknown[]) => prepareImageMock(...args) }));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { createImageFileSource, itemFileSource, logoFileSource } from './file-source';

const dto = { id: 'f1', mime: 'image/webp', size: 99, width: 40, height: 30 };
const prepared = { mime: 'image/webp', bytes: new Uint8Array([1, 2]), width: 40, height: 30 };
const png = () => new File([new Uint8Array(4)], 'x.png', { type: 'image/png' });

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue(prepared);
  apiMock.mockResolvedValue(dto);
  resetBusyForTests();
});

test('sumber gambar: mimeTypes gambar, kunci, dan hasil tanpa URL (dimuat lewat useFileUrl)', async () => {
  const source = createImageFileSource({ key: 'k' });
  expect(source.key).toBe('k');
  expect(source.mimeTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  const item = await source.upload(png(), 'Nama Saya');
  expect(item).toMatchObject({
    id: 'f1',
    name: 'Nama Saya',
    size: 99,
    width: 40,
    height: 30,
    thumbUrl: '',
    previewUrl: '',
  });
  expect(apiMock).toHaveBeenCalledWith(
    'files.upload',
    { mime: 'image/webp', bytes: prepared.bytes, width: 40, height: 30 },
    {},
  );
});

test('maxSide diteruskan ke prepareImage; logo = 512, item = bawaan', async () => {
  await itemFileSource.upload(png(), 'a');
  expect(prepareImageMock).toHaveBeenLastCalledWith(expect.any(File), undefined);
  await logoFileSource.upload(png(), 'a');
  expect(prepareImageMock).toHaveBeenLastCalledWith(expect.any(File), 512);
});

test('fase: preparing sebelum uploading, processing setelah byte penuh', async () => {
  apiMock.mockImplementation(
    async (
      _id: string,
      _input: unknown,
      options: { onUploadProgress?: (loaded: number, total: number) => void },
    ) => {
      options.onUploadProgress?.(2, 4);
      options.onUploadProgress?.(4, 4);
      return dto;
    },
  );
  const phases: string[] = [];
  await itemFileSource.upload(png(), 'a', { onProgress: (phase) => phases.push(phase) });
  expect(phases).toEqual(['preparing', 'uploading', 'uploading', 'uploading', 'processing']);
  expect(phases.indexOf('preparing')).toBeLessThan(phases.indexOf('uploading'));
});

test('abort sebelum unggah: tak memanggil API; abort sebelum mulai: tak mengecilkan juga', async () => {
  const controller = new AbortController();
  prepareImageMock.mockImplementation(async () => {
    controller.abort();
    return prepared;
  });
  await expect(
    itemFileSource.upload(png(), 'a', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(apiMock).not.toHaveBeenCalled();

  prepareImageMock.mockClear();
  const done = new AbortController();
  done.abort();
  await expect(itemFileSource.upload(png(), 'a', { signal: done.signal })).rejects.toThrow();
  expect(prepareImageMock).not.toHaveBeenCalled();
});

test('signal diteruskan ke api(); unggahan dihitung sebagai penulisan berjalan', async () => {
  const controller = new AbortController();
  let release: (value: unknown) => void = () => undefined;
  apiMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const pending = itemFileSource.upload(png(), 'a', { signal: controller.signal });
  await vi.waitFor(() => expect(isBusy()).toBe(true));
  expect(apiMock.mock.calls[0]?.[2]).toMatchObject({ signal: controller.signal });
  release(dto);
  await pending;
  expect(isBusy()).toBe(false);
});
