import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemStickerMarkDto, ItemStickerPhotoInput, SaveItemInput } from '@shared/contract';
import { replaceItemInstructionStmts } from '../sticker/instruction-repo';
import { assertInstructionRefs } from './service';

// Pemeriksaan rujukan instruksi stiker terhadap basis data (3b-2, Task 3): foto pustaka, stiker, jenis, dan label BU.

setDefaultTimeout(90_000);

let env: TestEnv;

const input = (
  photos: ItemStickerPhotoInput[],
  over: Partial<SaveItemInput> = {},
): SaveItemInput => ({
  brandId: 'brand-sony',
  businessUnitIds: ['bu-a'],
  model: 'Satu',
  isCountryLock: false,
  aliases: [],
  stickerPhotos: photos,
  accessories: [],
  attachments: [],
  detail: '',
  ...over,
});

const stickerMark = (stickerId: string): ItemStickerMarkDto => ({
  x: 10,
  y: 10,
  target: { kind: 'sticker', stickerId },
  note: '',
});
const typeMark = (typeId: string): ItemStickerMarkDto => ({
  x: 20,
  y: 20,
  target: { kind: 'type', typeId },
  note: '',
});
const photo = (
  marks: ItemStickerMarkDto[],
  over: Partial<ItemStickerPhotoInput> = {},
): ItemStickerPhotoInput => ({ guideId: 'g1', caption: '', buId: null, marks, ...over });

async function messageOf(candidate: SaveItemInput): Promise<string | undefined> {
  const error = await captureAppErrorAsync(() => assertInstructionRefs(env, candidate));
  expect(error.code).toBe('VALIDATION');
  return error.fields?.stickerPhotos;
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedGuideImage(env, { id: 'g1' });
  await seedGuideImage(env, { id: 'g2' });
  await seedStickerType(env, { id: 't1', name: 'Segel' });
  await seedStickerType(env, { id: 't-off', name: 'Lama', status: 'inactive' });
  await seedSticker(env, { id: 's1', typeId: 't1', buIds: ['bu-a'] });
  await seedSticker(env, { id: 's-off', typeId: 't1', status: 'inactive', buIds: ['bu-a'] });
});

describe('assertInstructionRefs', () => {
  test('rujukan sah (foto, stiker aktif, jenis aktif, label BU item) lolos; daftar kosong lolos', async () => {
    await assertInstructionRefs(env, input([]));
    await assertInstructionRefs(
      env,
      input([
        photo([stickerMark('s1'), typeMark('t1')], { buId: 'bu-a' }),
        photo([], { guideId: 'g2' }),
      ]),
    );
  });

  test('foto pustaka tidak ada atau berkas tidak aktif = VALIDATION menyebut nomor foto', async () => {
    expect(await messageOf(input([photo([]), photo([], { guideId: 'hilang' })]))).toBe(
      'Foto 2: gambar tidak ditemukan',
    );
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g1'").run();
    expect(await messageOf(input([photo([])]))).toBe('Foto 1: gambar tidak ditemukan');
  });

  test('stiker atau jenis tidak ada = VALIDATION menyebut foto dan penanda', async () => {
    expect(await messageOf(input([photo([stickerMark('s1'), stickerMark('hilang')])]))).toBe(
      'Foto 1, penanda 2: stiker tidak ditemukan',
    );
    expect(await messageOf(input([photo([typeMark('hilang')], { guideId: 'g1' })]))).toBe(
      'Foto 1, penanda 1: jenis tidak ditemukan',
    );
  });

  test('stiker/jenis nonaktif BARU ditolak', async () => {
    expect(await messageOf(input([photo([stickerMark('s-off')])]))).toBe(
      'Foto 1, penanda 1: stiker dinonaktifkan; pilih stiker yang aktif',
    );
    expect(await messageOf(input([photo([typeMark('t-off')])]))).toBe(
      'Foto 1, penanda 1: jenis dinonaktifkan; pilih jenis yang aktif',
    );
    // item baru (tanpa id) dan item dengan id tanpa penanda tersimpan sama-sama ditolak
    expect(await messageOf(input([photo([stickerMark('s-off')])], { id: 'item-1' }))).toBe(
      'Foto 1, penanda 1: stiker dinonaktifkan; pilih stiker yang aktif',
    );
  });

  test('stiker/jenis nonaktif yang SUDAH tersimpan di item itu lolos; di item lain tetap ditolak', async () => {
    await env.DB.batch(
      replaceItemInstructionStmts(env.DB, 'item-1', [
        photo([stickerMark('s-off'), typeMark('t-off')]),
      ]),
    );
    const same = input(
      [
        photo([typeMark('t-off'), stickerMark('s-off')], { guideId: 'g2' }),
        photo([stickerMark('s1')]),
      ],
      { id: 'item-1' },
    );
    await assertInstructionRefs(env, same);
    expect(await messageOf({ ...same, id: 'item-2' })).toBe(
      'Foto 1, penanda 1: jenis dinonaktifkan; pilih jenis yang aktif',
    );
  });

  test('label BU di luar BU item ditolak; null dan BU item lolos', async () => {
    expect(await messageOf(input([photo([], { buId: 'bu-b' })]))).toBe(
      'Foto 1: label BU harus salah satu BU item',
    );
    await assertInstructionRefs(
      env,
      input([photo([], { buId: 'bu-b' })], { businessUnitIds: ['bu-a', 'bu-b'] }),
    );
    await assertInstructionRefs(env, input([photo([], { buId: null })]));
  });
});
