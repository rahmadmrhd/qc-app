import { afterEach, expect, test, vi } from 'vitest';
import { copyLines } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

function stubClipboard(write: () => Promise<void>, writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { write: vi.fn(write), writeText: vi.fn(writeText) },
    configurable: true,
  });
  return (navigator.clipboard as unknown as { write: ReturnType<typeof vi.fn> }).write;
}

class FakeClipboardItem {
  constructor(public items: Record<string, unknown>) {}
}

test('menulis janji teks lewat ClipboardItem dan berhasil', async () => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  const write = stubClipboard(
    async () => undefined,
    async () => undefined,
  );
  expect(await copyLines(Promise.resolve('A\nB'))).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
});

test('tanpa ClipboardItem: menunggu teks lalu writeText', async () => {
  vi.stubGlobal('ClipboardItem', undefined);
  stubClipboard(
    async () => undefined,
    async () => undefined,
  );
  expect(await copyLines(Promise.resolve('A'))).toBe(true);
  expect(
    (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText,
  ).toHaveBeenCalledWith('A');
});

test('penulisan ditolak = false (pemanggil menampilkan dialog Salin lagi)', async () => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  stubClipboard(
    async () => {
      throw new Error('ditolak');
    },
    async () => undefined,
  );
  expect(await copyLines('A')).toBe(false);
});

test('janji teks yang gagal (kiriman gagal) = false tanpa melempar', async () => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  stubClipboard(
    async () => {
      throw new Error('tidak ada teks');
    },
    async () => undefined,
  );
  const rejected = Promise.reject(new Error('gagal'));
  rejected.catch(() => undefined);
  expect(await copyLines(rejected)).toBe(false);
});
