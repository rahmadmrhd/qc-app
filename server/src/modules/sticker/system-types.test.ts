import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { listStickerTypes } from './service';
import { ensureSystemStickerTypes } from './system-types';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-25T00:00:00.000Z'));
});

const systemTypes = async () =>
  (await listStickerTypes(env)).filter((type) => type.systemKind !== '');

describe('ensureSystemStickerTypes', () => {
  test('membuat jenis Manual Book dan Postel walau belum ada konfigurasi atau catatan', async () => {
    expect(await systemTypes()).toEqual([]);
    await ensureSystemStickerTypes(env);
    const types = await systemTypes();
    expect(types.map((type) => type.systemKind).sort()).toEqual(['manual_book', 'postel']);
    for (const type of types) {
      expect(type).toMatchObject({ rule: 'group', status: 'active', stickerCount: 0 });
    }
    expect(types.map((type) => type.name).sort()).toEqual(['Manual Book', 'Postel']);
  });

  test('idempoten: dipanggil berulang atau serentak tetap satu jenis per macam', async () => {
    await Promise.all([ensureSystemStickerTypes(env), ensureSystemStickerTypes(env)]);
    await ensureSystemStickerTypes(env);
    expect(await systemTypes()).toHaveLength(2);
  });

  test('jenis biasa bernama sama yang belum berstiker diadopsi menjadi jenis sistem', async () => {
    await seedStickerType(env, { id: 't-mb', name: 'manual book', rule: 'none' });
    await ensureSystemStickerTypes(env);
    const adopted = (await systemTypes()).find((type) => type.systemKind === 'manual_book');
    expect(adopted?.id).toBe('t-mb');
  });

  test('adopsi jenis buatan pengguna dicatat di log (hanya nama baku jenis)', async () => {
    await seedStickerType(env, { id: 't-pt', name: 'postel', rule: 'none' });
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ensureSystemStickerTypes(env);
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((text) => text.includes('"Postel" diadopsi'))).toBe(true);
      expect(messages.some((text) => text.includes('Manual Book'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  test('jenis bernama sama yang sudah berstiker dicatat, tidak melempar, dan tak menghalangi jenis lain', async () => {
    await seedStickerType(env, { id: 't-mb', name: 'Manual Book', rule: 'none' });
    await seedSticker(env, { id: 's-mb', typeId: 't-mb', name: 'Lama' });
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await ensureSystemStickerTypes(env);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
    expect((await systemTypes()).map((type) => type.systemKind)).toEqual(['postel']);
  });
});
