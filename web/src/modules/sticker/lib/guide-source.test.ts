import type { StickerGuideDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.fn();
const prepareImageMock = vi.fn();
const prepareThumbnailMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('@/modules/files/image', () => ({
  prepareImage: (...args: unknown[]) => prepareImageMock(...args),
}));
vi.mock('@/modules/files/thumbnail', () => ({
  prepareThumbnail: (...args: unknown[]) => prepareThumbnailMock(...args),
}));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { guidePreviewUrl, guideThumbUrl, stickerGuideSource } from './guide-source';

const dto: StickerGuideDto = {
  id: 'g1',
  name: 'Kardus',
  mime: 'image/webp',
  size: 1234,
  width: 800,
  height: 600,
  uploadedBy: 'ani@gmail.com',
  uploadedByMe: true,
  createdAt: '2026-11-10T01:00:00.000Z',
  usageCount: 0,
  canRename: true,
  canRemove: true,
};

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  prepareThumbnailMock.mockReset();
});

test('kunci cache, format yang didukung, dan batas nama', () => {
  expect(stickerGuideSource.nameMax).toBe(120);
  expect(stickerGuideSource.key).toBe('sticker-guides');
  expect(stickerGuideSource.mimeTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
});

test('URL diturunkan dari id', () => {
  expect(guideThumbUrl('g1')).toBe('/api/v1/sticker-guides/g1/thumbnail');
  expect(guidePreviewUrl('g1')).toBe('/api/v1/files/g1');
});

test('URL meloloskan id yang tidak aman', () => {
  expect(guideThumbUrl('a/b?c')).toBe('/api/v1/sticker-guides/a%2Fb%3Fc/thumbnail');
  expect(guidePreviewUrl('a/b?c')).toBe('/api/v1/files/a%2Fb%3Fc');
});

test('list meneruskan search/sort/mine/unused/cursor dan memetakan item', async () => {
  apiMock.mockResolvedValue({ items: [dto], nextCursor: 'c2' });
  const page = await stickerGuideSource.list(
    { search: '50%', sort: 'nameAsc', mine: true, unused: true },
    'c1',
  );
  expect(apiMock).toHaveBeenCalledWith('stickerGuides.list', {
    search: '50%',
    sort: 'nameAsc',
    mine: true,
    unused: true,
    cursor: 'c1',
  });
  expect(page.nextCursor).toBe('c2');
  expect(page.items[0]).toEqual({
    id: 'g1',
    name: 'Kardus',
    size: 1234,
    width: 800,
    height: 600,
    uploadedBy: 'ani@gmail.com',
    createdAt: '2026-11-10T01:00:00.000Z',
    usageCount: 0,
    canRename: true,
    canRemove: true,
    thumbUrl: '/api/v1/sticker-guides/g1/thumbnail',
    previewUrl: '/api/v1/files/g1',
  });
});

test('list tanpa filter: hanya sort yang dikirim', async () => {
  apiMock.mockResolvedValue({ items: [], nextCursor: null });
  await stickerGuideSource.list({ search: '', sort: 'newest', mine: false, unused: false }, null);
  expect(apiMock).toHaveBeenCalledWith('stickerGuides.list', { sort: 'newest' });
});

test('rename dan remove memanggil id yang benar', async () => {
  apiMock.mockResolvedValueOnce({ ...dto, name: 'Baru' });
  const renamed = await stickerGuideSource.rename('g1', 'Baru');
  expect(apiMock).toHaveBeenLastCalledWith('stickerGuides.rename', { id: 'g1', name: 'Baru' });
  expect(renamed.name).toBe('Baru');
  apiMock.mockResolvedValueOnce({ id: 'g1' });
  await expect(stickerGuideSource.remove('g1')).resolves.toBeUndefined();
  expect(apiMock).toHaveBeenLastCalledWith('stickerGuides.remove', { id: 'g1' });
});

test('upload: prepareImage lalu prepareThumbnail, lalu mengirim metadata dan bagian multipart', async () => {
  const image = new Uint8Array([1, 2, 3]);
  const thumbnail = new Uint8Array([9]);
  prepareImageMock.mockResolvedValue({ mime: 'image/webp', bytes: image, width: 800, height: 600 });
  prepareThumbnailMock.mockResolvedValue({ mime: 'image/jpeg', bytes: thumbnail });
  apiMock.mockResolvedValue(dto);
  const file = new File(['x'], 'kardus.png', { type: 'image/png' });
  const item = await stickerGuideSource.upload(file, 'Kardus');
  expect(prepareImageMock).toHaveBeenCalledWith(file);
  expect(prepareThumbnailMock).toHaveBeenCalledWith(file);
  expect(apiMock).toHaveBeenCalledWith('stickerGuides.upload', {
    name: 'Kardus',
    mime: 'image/webp',
    thumbMime: 'image/jpeg',
    width: 800,
    height: 600,
    image,
    thumbnail,
  });
  expect(item.id).toBe('g1');
});

test('upload: galat pengecilan diteruskan dan tidak memanggil server', async () => {
  prepareImageMock.mockRejectedValue(new Error('Format gambar harus JPEG, PNG, atau WebP'));
  await expect(
    stickerGuideSource.upload(new File(['x'], 'a.gif', { type: 'image/gif' }), 'A'),
  ).rejects.toThrow('Format gambar');
  expect(apiMock).not.toHaveBeenCalled();
});

test('list meneruskan urut usageDesc ke stickerGuides.list', async () => {
  apiMock.mockResolvedValueOnce({ items: [], nextCursor: null });
  await stickerGuideSource.list(
    { search: '', sort: 'usageDesc', mine: false, unused: false },
    null,
  );
  expect(apiMock).toHaveBeenLastCalledWith('stickerGuides.list', { sort: 'usageDesc' });
});

test('I2: unggah (siapkan gambar dan thumbnail, lalu kirim) menandai registri sibuk sepanjang alur, termasuk saat gagal', async () => {
  resetBusyForTests();
  let finishImage: (value: unknown) => void = () => undefined;
  let finishApi: (value: unknown) => void = () => undefined;
  prepareImageMock.mockReturnValue(new Promise((resolve) => (finishImage = resolve)));
  prepareThumbnailMock.mockResolvedValue({ mime: 'image/webp', bytes: new Uint8Array(1) });
  apiMock.mockReturnValue(new Promise((resolve) => (finishApi = resolve)));
  const pending = stickerGuideSource.upload(new File(['x'], 'a.png', { type: 'image/png' }), 'A');
  expect(isBusy()).toBe(true);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(isBusy()).toBe(true);
  finishImage({ mime: 'image/webp', width: 1, height: 1, bytes: new Uint8Array(1) });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  // A5: tetap sibuk selama permintaan kirim menggantung.
  expect(apiMock).toHaveBeenCalled();
  expect(isBusy()).toBe(true);
  finishApi(dto);
  await pending;
  expect(isBusy()).toBe(false);

  prepareImageMock.mockRejectedValue(new Error('rusak'));
  await expect(
    stickerGuideSource.upload(new File(['x'], 'b.png', { type: 'image/png' }), 'B'),
  ).rejects.toThrow('rusak');
  expect(isBusy()).toBe(false);
});
