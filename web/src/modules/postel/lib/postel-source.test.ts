import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { resetBusyForTests } from '@/app/pwa/busy';
import { postelSource } from './postel-source';

const dto = { id: 'a1', mime: 'application/pdf', size: 5, filename: 'lampiran-a1.pdf' };
const pdf = () => new File([new Uint8Array([37, 80, 68, 70, 45])], 'sertifikat.pdf', { type: '' });

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue(dto);
  resetBusyForTests();
});

test('menerima gambar dan PDF, kunci sendiri', () => {
  expect(postelSource.key).toBe('postel-files');
  expect(postelSource.mimeTypes).toEqual([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);
});

test('mengunggah apa adanya (tanpa pengecilan), jenis dari ekstensi bila type kosong', async () => {
  const item = await postelSource.upload(pdf(), 'Sertifikat');
  expect(apiMock).toHaveBeenCalledTimes(1);
  const [id, input, options] = apiMock.mock.calls[0] ?? [];
  expect(id).toBe('postelFiles.upload');
  expect(input.mime).toBe('application/pdf');
  expect(Array.from(input.bytes)).toEqual([37, 80, 68, 70, 45]);
  expect(options).toEqual({});
  expect(item).toMatchObject({ id: 'a1', name: 'Sertifikat', size: 5, thumbUrl: '' });
});

test('fase: uploading lalu processing setelah byte penuh (tanpa preparing)', async () => {
  apiMock.mockImplementation(
    async (
      _id: string,
      _input: unknown,
      options: { onUploadProgress?: (loaded: number, total: number) => void },
    ) => {
      options.onUploadProgress?.(5, 5);
      return dto;
    },
  );
  const phases: string[] = [];
  await postelSource.upload(pdf(), 'x', { onProgress: (phase) => phases.push(phase) });
  expect(phases).toEqual(['uploading', 'uploading', 'processing']);
});

test('abort sebelum unggah: tak memanggil API; signal diteruskan bila hidup', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(postelSource.upload(pdf(), 'x', { signal: controller.signal })).rejects.toThrow();
  expect(apiMock).not.toHaveBeenCalled();

  const live = new AbortController();
  await postelSource.upload(pdf(), 'x', { signal: live.signal });
  expect(apiMock.mock.calls[0]?.[2]).toMatchObject({ signal: live.signal });
});
