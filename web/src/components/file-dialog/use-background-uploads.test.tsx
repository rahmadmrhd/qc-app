import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import type { FileSource, LibraryItem, QueuedFile, UploadContext } from './types';
import { useBackgroundUploads } from './use-background-uploads';

function itemOf(name: string): LibraryItem {
  return {
    id: `id-${name}`,
    name,
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: '',
    createdAt: '',
    usageCount: 0,
    canRename: false,
    canRemove: false,
    thumbUrl: '',
    previewUrl: '',
  };
}

interface Call {
  name: string;
  ctx: UploadContext | undefined;
  resolve(): void;
  reject(error: Error): void;
}

/** Sumber palsu: tiap unggahan menunggu tes menuntaskannya. */
function controlledSource() {
  const calls: Call[] = [];
  const onDiscard = vi.fn();
  const source: FileSource = {
    key: 'fake',
    mimeTypes: ['image/png'],
    onDiscard,
    upload: (_file, name, ctx) =>
      new Promise<LibraryItem>((resolve, reject) => {
        calls.push({
          name,
          ctx,
          resolve: () => resolve(itemOf(name)),
          reject,
        });
      }),
  };
  return { source, calls, onDiscard };
}

const queued = (name: string, key = name): QueuedFile => ({
  key,
  name,
  file: new File([new Uint8Array(4)], `${name}.png`, { type: 'image/png' }),
});

beforeEach(() => {
  resetBusyForTests();
});

function setup(
  source: FileSource,
  onUploaded: (owner: string, item: LibraryItem) => boolean | undefined = () => undefined,
  concurrency?: number,
) {
  return renderHook(() => useBackgroundUploads({ source, onUploaded, concurrency }));
}

test('dua berkas bernama sama mendapat kunci berbeda dan keduanya diunggah', async () => {
  const { source, calls } = controlledSource();
  const { result } = setup(source);
  act(() => result.current.forOwner('a').add([queued('foto', 'k1'), queued('foto', 'k1')]));
  expect(result.current.entries).toHaveLength(2);
  const keys = result.current.entries.map((entry) => entry.key);
  expect(new Set(keys).size).toBe(2);
  expect(calls).toHaveLength(2);
});

test('konkurensi bawaan 3: entri ke-4 menunggu sampai ada yang selesai', async () => {
  const { source, calls } = controlledSource();
  const { result } = setup(source);
  act(() => result.current.forOwner('a').add(['1', '2', '3', '4'].map((n) => queued(n))));
  expect(calls).toHaveLength(3);
  expect(result.current.entries.map((e) => e.phase)).toEqual([
    'uploading',
    'uploading',
    'uploading',
    'waiting',
  ]);
  await act(async () => calls[0]?.resolve());
  await waitFor(() => expect(calls).toHaveLength(4));
});

test('berhasil: onUploaded dipanggil dengan pemilik dan hasil, entri dibuang', async () => {
  const { source, calls, onDiscard } = controlledSource();
  const onUploaded = vi.fn(() => undefined);
  const { result } = setup(source, onUploaded);
  act(() => result.current.forOwner('baris-1').add([queued('a')]));
  await act(async () => calls[0]?.resolve());
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
  expect(onUploaded).toHaveBeenCalledWith('baris-1', expect.objectContaining({ id: 'id-a' }));
  expect(onDiscard).not.toHaveBeenCalled();
});

test('galat: entri failed dengan pesan; retry mengulang hanya entri failed', async () => {
  const { source, calls } = controlledSource();
  const { result } = setup(source);
  act(() => result.current.forOwner('a').add([queued('x'), queued('y')]));
  await act(async () => calls[0]?.reject(new Error('Server menolak')));
  await waitFor(() => expect(result.current.entries.some((e) => e.phase === 'failed')).toBe(true));
  const failed = result.current.entries.find((e) => e.phase === 'failed');
  expect(failed?.error).toBe('Server menolak');
  const running = result.current.entries.find((e) => e.phase !== 'failed');
  expect(calls).toHaveLength(2);

  // retry pada entri yang tidak gagal: tak berefek.
  act(() => result.current.forOwner('a').retry(running?.key ?? ''));
  expect(calls).toHaveLength(2);

  act(() => result.current.forOwner('a').retry(failed?.key ?? ''));
  expect(calls).toHaveLength(3);
  expect(result.current.entries.find((e) => e.key === failed?.key)?.error).toBeNull();
});

test('remove pada entri berjalan membatalkan sinyal dan tidak memanggil onUploaded', async () => {
  const { source, calls, onDiscard } = controlledSource();
  const onUploaded = vi.fn(() => undefined);
  const { result } = setup(source, onUploaded);
  act(() => result.current.forOwner('a').add([queued('x')]));
  const key = result.current.entries[0]?.key ?? '';
  const signal = calls[0]?.ctx?.signal;
  expect(signal?.aborted).toBe(false);
  act(() => result.current.forOwner('a').remove(key));
  expect(signal?.aborted).toBe(true);
  expect(result.current.entries).toHaveLength(0);
  // Sumber mengabaikan abort dan tetap selesai: hasil dibuang, bukan diklaim.
  await act(async () => calls[0]?.resolve());
  expect(onUploaded).not.toHaveBeenCalled();
  expect(onDiscard).toHaveBeenCalledWith([expect.objectContaining({ id: 'id-x' })]);
});

test('unmount saat berjalan membatalkan dan membuang hasil yang datang terlambat', async () => {
  const { source, calls, onDiscard } = controlledSource();
  const onUploaded = vi.fn(() => undefined);
  const { result, unmount } = setup(source, onUploaded);
  act(() => result.current.forOwner('a').add([queued('x')]));
  const signal = calls[0]?.ctx?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => calls[0]?.resolve());
  expect(onUploaded).not.toHaveBeenCalled();
  expect(onDiscard).toHaveBeenCalledWith([expect.objectContaining({ id: 'id-x' })]);
  expect(isBusy()).toBe(false);
});

test('onUploaded mengembalikan false: hasil dibuang lewat onDiscard dan entri hilang', async () => {
  const { source, calls, onDiscard } = controlledSource();
  const { result } = setup(source, () => false);
  act(() => result.current.forOwner('a').add([queued('x')]));
  await act(async () => calls[0]?.resolve());
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
  expect(onDiscard).toHaveBeenCalledWith([expect.objectContaining({ id: 'id-x' })]);
});

test('busy benar selama ada entri non-failed (juga registri sibuk), hasFailed bila ada failed', async () => {
  const { source, calls } = controlledSource();
  const { result } = setup(source);
  expect(result.current.busy).toBe(false);
  expect(isBusy()).toBe(false);
  act(() => result.current.forOwner('a').add([queued('x')]));
  expect(result.current.busy).toBe(true);
  expect(result.current.hasFailed).toBe(false);
  expect(isBusy()).toBe(true);
  await act(async () => calls[0]?.reject(new Error('gagal')));
  await waitFor(() => expect(result.current.hasFailed).toBe(true));
  expect(result.current.busy).toBe(false);
  expect(isBusy()).toBe(false);
  act(() => result.current.forOwner('a').retry(result.current.entries[0]?.key ?? ''));
  expect(result.current.busy).toBe(true);
  expect(isBusy()).toBe(true);
  await act(async () => calls[1]?.resolve());
  await waitFor(() => expect(isBusy()).toBe(false));
});

test('forOwner hanya melihat entri pemiliknya; cancelOwner hanya membatalkan milik pemilik itu', async () => {
  const { source, calls, onDiscard } = controlledSource();
  const onUploaded = vi.fn(() => undefined);
  const { result } = setup(source, onUploaded);
  act(() => {
    result.current.forOwner('a').add([queued('a1')]);
    result.current.forOwner('b').add([queued('b1')]);
  });
  expect(result.current.forOwner('a').entries.map((e) => e.name)).toEqual(['a1']);
  expect(result.current.forOwner('b').entries.map((e) => e.name)).toEqual(['b1']);
  const signalA = calls.find((c) => c.name === 'a1')?.ctx?.signal;
  const signalB = calls.find((c) => c.name === 'b1')?.ctx?.signal;
  act(() => result.current.cancelOwner('a'));
  expect(signalA?.aborted).toBe(true);
  expect(signalB?.aborted).toBe(false);
  expect(result.current.entries.map((e) => e.owner)).toEqual(['b']);
  await act(async () => calls.find((c) => c.name === 'b1')?.resolve());
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('b', expect.anything()));
  expect(onDiscard).not.toHaveBeenCalled();
});

test('progres dari sumber memperbarui fase dan fraksi entri', async () => {
  const { source, calls } = controlledSource();
  const { result } = setup(source);
  act(() => result.current.forOwner('a').add([queued('x')]));
  act(() => calls[0]?.ctx?.onProgress?.('preparing', null));
  expect(result.current.entries[0]?.phase).toBe('preparing');
  act(() => calls[0]?.ctx?.onProgress?.('uploading', 0.5));
  expect(result.current.entries[0]).toMatchObject({ phase: 'uploading', fraction: 0.5 });
  act(() => calls[0]?.ctx?.onProgress?.('processing', null));
  expect(result.current.entries[0]).toMatchObject({ phase: 'processing', fraction: null });
});

test('F8: banyak event progres digabung (sedikit render), fase dan nilai akhir tetap segera', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    const { source, calls } = controlledSource();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useBackgroundUploads({ source, onUploaded: () => undefined });
    });
    act(() => result.current.forOwner('a').add([queued('x')]));
    act(() => calls[0]?.ctx?.onProgress?.('uploading', 0));
    expect(result.current.entries[0]).toMatchObject({ phase: 'uploading', fraction: 0 });
    const before = renders;
    // Tiap event di act sendiri (seperti event XHR terpisah): tanpa throttle tiap event = satu render.
    for (let i = 1; i <= 50; i += 1) act(() => calls[0]?.ctx?.onProgress?.('uploading', i / 100));
    // Selang yang sama: paling banyak satu pembaruan di depan (bukan 50 render).
    expect(renders - before).toBeLessThanOrEqual(2);
    // Nilai terakhir menyusul setelah selang throttle.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.entries[0]?.fraction).toBe(0.5);
    // Perubahan fase dan nilai akhir tidak ditunda.
    act(() => calls[0]?.ctx?.onProgress?.('uploading', 1));
    expect(result.current.entries[0]?.fraction).toBe(1);
    act(() => calls[0]?.ctx?.onProgress?.('processing', null));
    expect(result.current.entries[0]).toMatchObject({ phase: 'processing', fraction: null });
  } finally {
    vi.useRealTimers();
  }
});

test('F8: pembaruan progres yang tertunda tak menimpa fase gagal', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    const { source, calls } = controlledSource();
    const { result } = setup(source);
    act(() => result.current.forOwner('a').add([queued('x')]));
    act(() => calls[0]?.ctx?.onProgress?.('uploading', 0));
    act(() => calls[0]?.ctx?.onProgress?.('uploading', 0.2));
    act(() => calls[0]?.ctx?.onProgress?.('uploading', 0.3));
    await act(async () => calls[0]?.reject(new Error('putus')));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.entries[0]).toMatchObject({ phase: 'failed', fraction: null });
  } finally {
    vi.useRealTimers();
  }
});
