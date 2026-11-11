import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { postelUploadError, uploadPostelFile } from './upload';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));

beforeEach(() => {
  apiMock.mockReset();
});

test('uploadPostelFile mengirim mime dan byte asli tanpa pengecilan', async () => {
  const dto = { id: 'f1', mime: 'image/png', size: 4, filename: 'lampiran-abcd1234.png' };
  apiMock.mockResolvedValueOnce(dto);
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const result = await uploadPostelFile(new File([bytes], 'a.png', { type: 'image/png' }));
  expect(result).toEqual(dto);
  const [id, input] = apiMock.mock.calls[0] as [string, { mime: string; bytes: Uint8Array }];
  expect(id).toBe('postelFiles.upload');
  expect(input.mime).toBe('image/png');
  expect([...input.bytes]).toEqual([...bytes]);
});

test('postelUploadError: pesan field bytes/mime dari server apa adanya; lainnya memakai pesan umum', () => {
  expect(
    postelUploadError(
      new ApiError('VALIDATION', 'Data tidak valid', 'r', {
        bytes: 'Sisi gambar maksimal 10000 piksel',
      }),
    ),
  ).toBe('Sisi gambar maksimal 10000 piksel');
  expect(
    postelUploadError(
      new ApiError('VALIDATION', 'x', 'r', { mime: 'Hanya JPEG, PNG, WebP, atau PDF' }),
    ),
  ).toBe('Hanya JPEG, PNG, WebP, atau PDF');
  expect(postelUploadError(new ApiError('FORBIDDEN', 'Tidak punya izin', 'r'))).toBe(
    'Tidak punya izin',
  );
  expect(postelUploadError(new Error('putus'))).toBe('putus');
  expect(postelUploadError('aneh')).toBe('Gagal mengunggah lampiran');
});
