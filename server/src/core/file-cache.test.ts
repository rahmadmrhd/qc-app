import { describe, expect, test } from 'bun:test';
import { createTestEnv } from '@server-test/test-env';
import {
  cachedFileContent,
  createMemoryFileCache,
  dropCachedFile,
  fileCacheKey,
} from './file-cache';

const key = (driveId: string, folderId = 'f1') => fileCacheKey(folderId, driveId);

describe('cache memori LRU berkas', () => {
  test('menyimpan dan membaca; folder yang berbeda = miss', async () => {
    const cache = createMemoryFileCache(1000);
    await cache.put(key('d1'), 'image/png', 'AAAA');
    expect(await cache.get(key('d1'))).toEqual({ mime: 'image/png', base64: 'AAAA' });
    expect(await cache.get(key('d1', 'folder-lain'))).toBeNull();
  });

  test('total dibatasi: entri terlama dibuang lebih dulu, yang baru dibaca bertahan', async () => {
    const cache = createMemoryFileCache(10);
    await cache.put(key('a'), 'm', '1234');
    await cache.put(key('b'), 'm', '1234');
    await cache.get(key('a')); // a menjadi yang terbaru dipakai
    await cache.put(key('c'), 'm', '1234'); // total 12 > 10: b (terlama) dibuang
    expect(await cache.get(key('b'))).toBeNull();
    expect(await cache.get(key('a'))).not.toBeNull();
    expect(await cache.get(key('c'))).not.toBeNull();
    expect(cache.size).toBeLessThanOrEqual(10);
  });

  test('isi lebih besar dari batas total tidak disimpan; menimpa id yang sama tidak menggandakan ukuran', async () => {
    const cache = createMemoryFileCache(10);
    await cache.put(key('besar'), 'm', 'x'.repeat(11));
    expect(await cache.get(key('besar'))).toBeNull();
    await cache.put(key('a'), 'm', '12345');
    await cache.put(key('a'), 'm', '123456');
    expect(cache.size).toBe(6);
  });

  test('drop membuang entri dan ukurannya', async () => {
    const cache = createMemoryFileCache(100);
    await cache.put(key('a'), 'm', '1234');
    await cache.drop?.('a');
    expect(await cache.get(key('a'))).toBeNull();
    expect(cache.size).toBe(0);
  });
});

describe('cachedFileContent / dropCachedFile', () => {
  test('miss memanggil load sekali lalu melayani dari cache; dropCachedFile memaksa muat ulang', async () => {
    const env = await createTestEnv({ FILE_CACHE: createMemoryFileCache(100) });
    let loads = 0;
    const load = async () => {
      loads++;
      return { mime: 'image/png', base64: 'AAAA' };
    };
    expect((await cachedFileContent(env, 'f1', 'd1', load))?.base64).toBe('AAAA');
    await cachedFileContent(env, 'f1', 'd1', load);
    expect(loads).toBe(1);
    await dropCachedFile(env, 'd1');
    await cachedFileContent(env, 'f1', 'd1', load);
    expect(loads).toBe(2);
  });

  test('galat cache tidak menggagalkan pembacaan', async () => {
    const broken = {
      get: async () => {
        throw new Error('rusak');
      },
      put: async () => {
        throw new Error('rusak');
      },
    };
    const env = await createTestEnv({ FILE_CACHE: broken });
    const out = await cachedFileContent(env, 'f1', 'd1', async () => ({ mime: 'm', base64: 'AB' }));
    expect(out?.base64).toBe('AB');
  });

  test('tanpa FILE_CACHE (null) tidak ada cache', async () => {
    const env = await createTestEnv({ FILE_CACHE: null });
    let loads = 0;
    const load = async () => {
      loads++;
      return { mime: 'm', base64: 'AB' };
    };
    await cachedFileContent(env, 'f1', 'd1', load);
    await cachedFileContent(env, 'f1', 'd1', load);
    expect(loads).toBe(2);
  });
});
