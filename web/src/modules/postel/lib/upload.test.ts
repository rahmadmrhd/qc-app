import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { ApiError } from '@/lib/api/api-error';
import { postelFileMime, postelUploadError, uploadPostelFile } from './upload';

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
        bytes: 'Dimensi gambar tidak terbaca',
      }),
    ),
  ).toBe('Dimensi gambar tidak terbaca');
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

test('postelFileMime: memakai file.type; bila kosong turun ke ekstensi; selain itu kosong', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type });
  expect(postelFileMime(file('a.bin', 'image/png'))).toBe('image/png');
  for (const [name, mime] of [
    ['a.pdf', 'application/pdf'],
    ['a.JPG', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
  ] as const)
    expect(postelFileMime(file(name, ''))).toBe(mime);
  expect(postelFileMime(file('a.txt', ''))).toBe('');
  expect(postelFileMime(file('tanpa-ekstensi', ''))).toBe('');
  // tanpa titik bukan ekstensi; nama pewarisan objek tidak memetakan
  expect(postelFileMime(file('pdf', ''))).toBe('');
  expect(postelFileMime(file('constructor', ''))).toBe('');
  expect(postelFileMime(file('x.constructor', ''))).toBe('');
  expect(postelFileMime(file('x.toString', ''))).toBe('');
  expect(postelFileMime(file('arsip.tar.pdf', ''))).toBe('application/pdf');
});

test('I2: unggah lampiran Postel menandai registri sibuk selama berjalan dan melepasnya setelah selesai atau gagal', async () => {
  resetBusyForTests();
  let release: (value: unknown) => void = () => undefined;
  apiMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
  const pending = uploadPostelFile(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }));
  expect(isBusy()).toBe(true);
  // A5: tetap sibuk selama permintaan menggantung (setelah microtask berjalan).
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(isBusy()).toBe(true);
  release({ id: 'f1' });
  await pending;
  expect(isBusy()).toBe(false);
  apiMock.mockRejectedValueOnce(new Error('gagal'));
  await expect(
    uploadPostelFile(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' })),
  ).rejects.toThrow('gagal');
  expect(isBusy()).toBe(false);
});
