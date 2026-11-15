import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.fn();
const prepareImageMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('@/modules/files/image', () => ({
  prepareImage: (...args: unknown[]) => prepareImageMock(...args),
}));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
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
  expect(apiMock).toHaveBeenCalledWith('serialProofs.upload', {
    mime: 'image/webp',
    bytes,
    width: 800,
    height: 600,
  });
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

test('list, rename, dan remove tidak dipakai (tanpa pustaka)', async () => {
  await expect(
    proofSource.list({ search: '', sort: 'newest', mine: false, unused: false }, null),
  ).rejects.toThrow();
  await expect(proofSource.rename('p1', 'x')).rejects.toThrow();
  await expect(proofSource.remove('p1')).rejects.toThrow();
});
