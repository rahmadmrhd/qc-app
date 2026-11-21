import { afterEach, expect, test, vi } from 'vitest';
import { captureFrame } from './photo-capture';

function fakeVideo(over: Partial<{ readyState: number; w: number; h: number }> = {}) {
  return {
    readyState: over.readyState ?? 4,
    videoWidth: over.w ?? 1920,
    videoHeight: over.h ?? 1080,
  } as unknown as HTMLVideoElement;
}

afterEach(() => vi.restoreAllMocks());

function stubCanvas(blob: Blob | null) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const toBlob = vi.fn((callback: BlobCallback) => callback(blob));
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    toBlob as unknown as HTMLCanvasElement['toBlob'],
  );
  return { drawImage, toBlob };
}

test('menghasilkan File JPEG pada resolusi video dan hanya menggambar video', async () => {
  const { drawImage, toBlob } = stubCanvas(new Blob([new Uint8Array(8)], { type: 'image/jpeg' }));
  const video = fakeVideo();
  const file = await captureFrame(video, 'foto-1.jpg');
  expect(file).toBeInstanceOf(File);
  expect(file.type).toBe('image/jpeg');
  expect(file.name).toBe('foto-1.jpg');
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
});

test('video belum siap: ditolak dengan pesan', async () => {
  stubCanvas(new Blob([new Uint8Array(8)]));
  await expect(captureFrame(fakeVideo({ readyState: 1 }), 'x.jpg')).rejects.toThrow(/belum siap/);
  await expect(captureFrame(fakeVideo({ w: 0 }), 'x.jpg')).rejects.toThrow(/belum siap/);
});

test('enkode gagal (toBlob null): ditolak dengan pesan, bukan menggantung', async () => {
  stubCanvas(null);
  await expect(captureFrame(fakeVideo(), 'x.jpg')).rejects.toThrow(/Gagal mengambil gambar/);
});
