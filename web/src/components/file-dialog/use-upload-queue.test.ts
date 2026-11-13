import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import type { FileLibrarySource, LibraryItem } from './types';
import { useUploadQueue } from './use-upload-queue';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const png = (name: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

function itemOf(name: string): LibraryItem {
  return {
    id: `id-${name}`,
    name,
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: 'a@x',
    createdAt: '2026-11-10T00:00:00.000Z',
    usageCount: 0,
    canRename: true,
    canRemove: true,
    thumbUrl: `/t/${name}`,
    previewUrl: `/p/${name}`,
  };
}

function fakeSource(upload?: FileLibrarySource['upload']): FileLibrarySource {
  return {
    key: 'fake',
    mimeTypes: ACCEPT,
    list: vi.fn(),
    upload: upload ?? vi.fn(async (_file: File, name: string) => itemOf(name)),
    rename: vi.fn(),
    remove: vi.fn(),
  };
}

function setup(source: FileLibrarySource) {
  return renderHook(() => useUploadQueue({ source, accept: ACCEPT, maxBytes: 1000, maxFiles: 20 }));
}

test('25 berkas sah: 20 masuk, 5 ditolak dengan alasan batas dan nama', () => {
  const { result } = setup(fakeSource());
  act(() => result.current.add(Array.from({ length: 25 }, (_, i) => png(`f${i}.png`))));
  expect(result.current.entries).toHaveLength(20);
  expect(result.current.rejected).toHaveLength(5);
  expect(result.current.rejected[0]).toEqual({
    name: 'f20.png',
    reason: 'Maksimal 20 berkas per unggahan',
  });
});

test('campuran sah dan tak sah: yang sah tetap masuk, yang tak sah ditolak per berkas', () => {
  const { result } = setup(fakeSource());
  act(() =>
    result.current.add([
      png('ok.png'),
      new File(['x'], 'foto.heic', { type: 'image/heic' }),
      new File(['x'], 'a.gif', { type: 'image/gif' }),
      png('besar.png', 1001),
      new File(['x'], 'dok.pdf', { type: 'application/pdf' }),
    ]),
  );
  expect(result.current.entries.map((entry) => entry.name)).toEqual(['ok']);
  expect(result.current.rejected.map((item) => item.name)).toEqual([
    'foto.heic',
    'a.gif',
    'besar.png',
    'dok.pdf',
  ]);
  expect(result.current.rejected.every((item) => item.reason !== '')).toBe(true);
  act(() => result.current.clearRejected());
  expect(result.current.rejected).toEqual([]);
});

test('nama awal tanpa ekstensi; rename dan remove', () => {
  const { result } = setup(fakeSource());
  act(() => result.current.add([png('kardus a.png'), png('b.png')]));
  expect(result.current.entries[0]?.name).toBe('kardus a');
  const [first, second] = result.current.entries;
  act(() => result.current.rename(first?.key ?? '', '  Kardus Besar '));
  expect(result.current.entries[0]?.name).toBe('Kardus Besar');
  act(() => result.current.rename(first?.key ?? '', '   '));
  expect(result.current.entries[0]?.name).toBe('Kardus Besar');
  act(() => result.current.remove(second?.key ?? ''));
  expect(result.current.entries).toHaveLength(1);
});

test('batas nama dari sumber dipakai pada nama awal', () => {
  const { result } = setup({ ...fakeSource(), nameMax: 5 });
  act(() => result.current.add([png('abcdefghij.png')]));
  expect(result.current.entries[0]?.name).toBe('abcde');
});

test('start mengunggah dengan nama entri, mengembalikan hasil sukses', async () => {
  const source = fakeSource();
  const { result } = setup(source);
  act(() => result.current.add([png('a.png'), png('b.png')]));
  let items: LibraryItem[] = [];
  await act(async () => {
    items = await result.current.start();
  });
  expect(items.map((item) => item.name)).toEqual(['a', 'b']);
  expect(source.upload).toHaveBeenCalledTimes(2);
  expect(result.current.entries.every((entry) => entry.status === 'done')).toBe(true);
});

test('konkurensi maksimum 3 secara bawaan', async () => {
  let running = 0;
  let peak = 0;
  const pending: Array<() => void> = [];
  const source = fakeSource(
    (_file, name) =>
      new Promise<LibraryItem>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        pending.push(() => {
          running -= 1;
          resolve(itemOf(name));
        });
      }),
  );
  const { result } = setup(source);
  act(() => result.current.add(Array.from({ length: 7 }, (_, i) => png(`f${i}.png`))));
  let done: Promise<LibraryItem[]> = Promise.resolve([]);
  await act(async () => {
    done = result.current.start();
    await Promise.resolve();
  });
  expect(running).toBe(3);
  for (let guard = 0; guard < 20 && pending.length > 0; guard += 1) {
    await act(async () => {
      pending.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  let items: LibraryItem[] = [];
  await act(async () => {
    items = await done;
  });
  expect(items).toHaveLength(7);
  expect(peak).toBe(3);
});

test('satu gagal tidak menghentikan yang lain; retry hanya mengunggah yang gagal', async () => {
  let failB = true;
  const upload = vi.fn(async (_file: File, name: string) => {
    if (name === 'b' && failB) throw new Error('Jaringan putus');
    return itemOf(name);
  });
  const { result } = setup(fakeSource(upload));
  act(() => result.current.add([png('a.png'), png('b.png'), png('c.png')]));
  let items: LibraryItem[] = [];
  await act(async () => {
    items = await result.current.start();
  });
  expect(items.map((item) => item.name)).toEqual(['a', 'c']);
  const failed = result.current.entries.find((entry) => entry.status === 'failed');
  expect(failed?.name).toBe('b');
  expect(failed?.error).toBe('Jaringan putus');
  expect(upload).toHaveBeenCalledTimes(3);

  failB = false;
  act(() => result.current.retry(failed?.key ?? ''));
  expect(result.current.entries.find((entry) => entry.key === failed?.key)?.status).toBe('waiting');
  await act(async () => {
    items = await result.current.start();
  });
  expect(upload).toHaveBeenCalledTimes(4);
  expect(items.map((item) => item.name)).toEqual(['a', 'b', 'c']);
});

test('start tanpa retry juga mencoba ulang entri gagal, tanpa mengunggah ulang yang sukses', async () => {
  let failB = true;
  const upload = vi.fn(async (_file: File, name: string) => {
    if (name === 'b' && failB) throw new Error('x');
    return itemOf(name);
  });
  const { result } = setup(fakeSource(upload));
  act(() => result.current.add([png('a.png'), png('b.png')]));
  await act(async () => {
    await result.current.start();
  });
  failB = false;
  await act(async () => {
    await result.current.start();
  });
  expect(upload.mock.calls.map((call) => call[1])).toEqual(['a', 'b', 'b']);
});

test('start dua kali serentak = satu rangkaian upload per berkas', async () => {
  const source = fakeSource();
  const { result } = setup(source);
  act(() => result.current.add([png('a.png'), png('b.png')]));
  let first: LibraryItem[] = [];
  let second: LibraryItem[] = [];
  await act(async () => {
    const one = result.current.start();
    const two = result.current.start();
    [first, second] = await Promise.all([one, two]);
  });
  expect(source.upload).toHaveBeenCalledTimes(2);
  expect(first).toEqual(second);
});

test('setelah sukses, start lagi tidak memanggil upload', async () => {
  const source = fakeSource();
  const { result } = setup(source);
  act(() => result.current.add([png('a.png')]));
  await act(async () => {
    await result.current.start();
  });
  let again: LibraryItem[] = [];
  await act(async () => {
    again = await result.current.start();
  });
  expect(source.upload).toHaveBeenCalledTimes(1);
  expect(again).toHaveLength(1);
});

test('galat non-ApiError memakai pesannya; addRejected menambah penolakan; snapshot memberi keadaan terkini', async () => {
  const upload = vi.fn(async (): Promise<LibraryItem> => {
    throw new Error('Format gambar harus JPEG, PNG, atau WebP');
  });
  const { result } = setup(fakeSource(upload));
  act(() => result.current.add([png('a.png')]));
  await act(async () => {
    await result.current.start();
  });
  expect(result.current.entries[0]?.error).toBe('Format gambar harus JPEG, PNG, atau WebP');
  expect(result.current.snapshot()[0]?.status).toBe('failed');
  act(() => result.current.addRejected([{ name: 'z.gif', reason: 'GIF tidak didukung' }]));
  expect(result.current.rejected).toEqual([{ name: 'z.gif', reason: 'GIF tidak didukung' }]);
});

test('I2: seluruh antrean unggah (termasuk celah antar berkas) menandai registri sibuk sampai selesai', async () => {
  resetBusyForTests();
  const releases: Array<() => void> = [];
  const source = fakeSource(
    (_file, name) =>
      new Promise((resolve) => {
        releases.push(() => resolve(itemOf(name)));
      }),
  );
  const hook = setup(source);
  act(() => hook.result.current.add([png('a.png'), png('b.png')]));
  let done: Promise<unknown> = Promise.resolve();
  act(() => {
    done = hook.result.current.start();
  });
  expect(isBusy()).toBe(true);
  await act(async () => {
    for (const release of releases.splice(0)) release();
    await done;
  });
  expect(isBusy()).toBe(false);
});
