import type { ClFileDto } from '@shared/contract';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { sha256Hex, uploadBinary } from './upload-chunks';

const FILE_DTO = { id: 'f1', path: 'a.npk' } as ClFileDto;

/** Berkas buatan dengan isi bernilai tetap; `size` menentukan jumlah potongan pada `chunkBytes` kecil. */
function makeFile(size: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], 'a.npk');
}

function makeApi(overrides: Record<string, (input: unknown) => unknown> = {}) {
  const calls: { id: string; input: unknown }[] = [];
  const call = vi.fn(async (id: string, input: unknown) => {
    calls.push({ id, input });
    const handler = overrides[id];
    if (handler) return handler(input);
    if (id === 'clUploads.start') return { uploadId: 'u1', chunkBytes: 4 };
    if (id === 'clUploads.chunk') return { received: 1 };
    if (id === 'clUploads.finish') return FILE_DTO;
    throw new Error(`api tak terduga: ${id}`);
  });
  return { call, calls };
}

describe('sha256Hex', () => {
  test('menghitung sha256 heksadesimal huruf kecil', async () => {
    const hash = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('uploadBinary', () => {
  test('mengirim potongan berurutan lalu memanggil finish', async () => {
    const file = makeFile(10); // chunkBytes 4 -> 3 potongan (4, 4, 2)
    const { call, calls } = makeApi();
    const progress: number[] = [];
    const result = await uploadBinary(file, 'a.npk', {
      api: call as never,
      onProgress: (sent) => progress.push(sent),
    });
    expect(result).toBe(FILE_DTO);
    expect(calls.map((entry) => entry.id)).toEqual([
      'clUploads.start',
      'clUploads.chunk',
      'clUploads.chunk',
      'clUploads.chunk',
      'clUploads.finish',
    ]);
    const start = calls[0]?.input as { path: string; role: string; size: number; sha256: string };
    expect(start).toMatchObject({ path: 'a.npk', role: 'router', size: 10 });
    expect(start.sha256).toMatch(/^[0-9a-f]{64}$/);
    const chunks = calls
      .slice(1, 4)
      .map((entry) => entry.input as { id: string; idx: string; bytes: Uint8Array });
    expect(chunks.map((chunk) => chunk.idx)).toEqual(['0', '1', '2']);
    expect(chunks.every((chunk) => chunk.id === 'u1')).toBe(true);
    expect(chunks.map((chunk) => chunk.bytes.length)).toEqual([4, 4, 2]);
    expect(calls[4]?.input).toEqual({ id: 'u1' });
    expect(progress.at(-1)).toBe(10);
  });

  test('mengulang potongan yang gagal sementara, lalu lanjut', async () => {
    const file = makeFile(8);
    let failures = 0;
    const { call, calls } = makeApi({
      'clUploads.chunk': () => {
        if (failures < 2) {
          failures += 1;
          throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');
        }
        return { received: 1 };
      },
    });
    await uploadBinary(file, 'a.npk', { api: call as never, retryDelayMs: 0 });
    const chunkCalls = calls.filter((entry) => entry.id === 'clUploads.chunk');
    // Potongan 0 diulang dua kali (3 percobaan), potongan 1 sekali.
    expect(chunkCalls).toHaveLength(4);
    expect(calls.at(-1)?.id).toBe('clUploads.finish');
  });

  test('galat permanen (VALIDATION) tidak diulang dan unggahan berhenti', async () => {
    const file = makeFile(8);
    const { call, calls } = makeApi({
      'clUploads.chunk': () => {
        throw new ApiError('VALIDATION', 'Potongan tidak sah', '-');
      },
    });
    await expect(
      uploadBinary(file, 'a.npk', { api: call as never, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls.filter((entry) => entry.id === 'clUploads.chunk')).toHaveLength(1);
    expect(calls.some((entry) => entry.id === 'clUploads.finish')).toBe(false);
  });

  test('menyerah setelah percobaan habis', async () => {
    const file = makeFile(4);
    const { call, calls } = makeApi({
      'clUploads.chunk': () => {
        throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');
      },
    });
    await expect(
      uploadBinary(file, 'a.npk', { api: call as never, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls.filter((entry) => entry.id === 'clUploads.chunk')).toHaveLength(3);
  });

  test('berkas kosong ditolak sebelum menghubungi server', async () => {
    const { call } = makeApi();
    await expect(
      uploadBinary(new File([], 'a.npk'), 'a.npk', { api: call as never }),
    ).rejects.toThrow(/kosong/i);
    expect(call).not.toHaveBeenCalled();
  });

  test('berkas di atas batas biner ditolak sebelum menghubungi server', async () => {
    const { call } = makeApi();
    const big = { size: 64 * 1024 * 1024 + 1, name: 'big.bin' } as File;
    await expect(uploadBinary(big, 'big.bin', { api: call as never })).rejects.toThrow(/64 MB/);
    expect(call).not.toHaveBeenCalled();
  });

  test('pembatalan (AbortSignal) menghentikan sebelum potongan berikutnya', async () => {
    const file = makeFile(12);
    const controller = new AbortController();
    const { call, calls } = makeApi({
      'clUploads.chunk': () => {
        controller.abort();
        return { received: 1 };
      },
    });
    await expect(
      uploadBinary(file, 'a.npk', { api: call as never, signal: controller.signal }),
    ).rejects.toThrow(/dibatalkan/i);
    expect(calls.filter((entry) => entry.id === 'clUploads.chunk')).toHaveLength(1);
  });
});
