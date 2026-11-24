import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { loadUserContext } from '@server/modules/access/context';
import { planAttachFiles } from '@server/modules/files/service';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { StickerGuideDto, StickerGuidePageDto } from '@shared/contract';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { GUIDE_LIMITS } from '@shared/stickers';
import { uploadGuide } from './guide-service';
import { validateUploadGuide } from './guide-validate';

// Pustaka gambar stiker (3b-1): daftar, thumbnail, unggah, ganti nama, hapus, dan akses gambar penuh.

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const WEBP_THUMB = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x08, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
]);

interface SeedGuide {
  id: string;
  name?: string;
  email?: string;
  size?: number;
  createdAt?: string;
  thumb?: Uint8Array;
  thumbMime?: string;
  ownerType?: string;
}

/** Menyisipkan baris `files` (pemilik stickerguide) + baris pustaka langsung lewat SQL. */
async function seedGuide(guide: SeedGuide): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES (?, ?, 'image/png', ?, 800, 600, ?, ?, ?, ?, 'active')",
    ).bind(
      guide.id,
      `drive-${guide.id}`,
      guide.size ?? 1000,
      guide.ownerType ?? 'stickerguide',
      guide.id,
      guide.createdAt ?? '2026-11-10T00:00:00.000Z',
      guide.email ?? 'uploader@gmail.com',
    ),
    env.DB.prepare(
      'INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      guide.id,
      guide.name ?? guide.id,
      guide.thumbMime ?? 'image/webp',
      guide.thumb ?? WEBP_THUMB,
      guide.createdAt ?? '2026-11-10T00:00:00.000Z',
    ),
  ]);
}

async function list(query = '', email?: string | null): Promise<StickerGuidePageDto> {
  const response = await rest.get(`/sticker-guides${query}`, email === undefined ? {} : { email });
  expect(response.status).toBe(200);
  return (await response.json()) as StickerGuidePageDto;
}

const names = (page: StickerGuidePageDto) => page.items.map((item) => item.name);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-item-edit', name: 'Edit Item', permissions: { item: 'edit' } });
  await seedRole(env, {
    id: 'r-item-manage',
    name: 'Kelola Item',
    permissions: { item: 'manage' },
  });
  await seedRole(env, { id: 'r-stk-view', name: 'Lihat Stiker', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-stk-edit', name: 'Edit Stiker', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-iv', email: 'iv@gmail.com', roleIds: ['r-item-view'] });
  await seedUser(env, { id: 'u-ie', email: 'ie@gmail.com', roleIds: ['r-item-edit'] });
  await seedUser(env, { id: 'u-im', email: 'im@gmail.com', roleIds: ['r-item-manage'] });
  await seedUser(env, { id: 'u-sv', email: 'sv@gmail.com', roleIds: ['r-stk-view'] });
  await seedUser(env, { id: 'u-se', email: 'se@gmail.com', roleIds: ['r-stk-edit'] });
  await seedUser(env, { id: 'u-nol', email: 'nol@gmail.com' });
  await seedUser(env, {
    id: 'u-up',
    email: 'uploader@gmail.com',
    name: 'Budi Pengunggah',
    roleIds: ['r-item-edit'],
  });
});

describe('GET /sticker-guides: izin', () => {
  test('401 tanpa sesi, 403 tanpa izin, 200 untuk item:view saja dan sticker:view saja', async () => {
    expect((await rest.get('/sticker-guides', { email: null })).status).toBe(401);
    const forbidden = await rest.get('/sticker-guides', { email: 'nol@gmail.com' });
    expect(forbidden.status).toBe(403);
    expect(await jsonOf(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    expect((await rest.get('/sticker-guides', { email: 'iv@gmail.com' })).status).toBe(200);
    expect((await rest.get('/sticker-guides', { email: 'sv@gmail.com' })).status).toBe(200);
    // sticker:edit tanpa item:view juga lolos lewat tingkat view (level lebih tinggi mencakup view).
    expect((await rest.get('/sticker-guides', { email: 'se@gmail.com' })).status).toBe(200);
  });
});

describe('GET /sticker-guides: paginasi kunci', () => {
  test('limit=2 atas 5 baris: tiga halaman berurutan tanpa duplikat, lalu nextCursor null', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: StickerGuidePageDto = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['Gambar 5', 'Gambar 4', 'Gambar 3', 'Gambar 2', 'Gambar 1']);
  });

  test('halaman pas penuh tidak memberi kursor palsu (5 baris, limit=5)', async () => {
    for (let i = 1; i <= 5; i++)
      await seedGuide({ id: `g${i}`, createdAt: `2026-11-10T00:00:0${i}.000Z` });
    const page = await list('?limit=5');
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  test('unggahan baru di antara halaman tidak menggandakan atau melewatkan (newest)', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const first = await list('?limit=2');
    expect(names(first)).toEqual(['Gambar 5', 'Gambar 4']);
    // Baris baru yang paling baru disisipkan setelah halaman pertama dimuat.
    await seedGuide({ id: 'g6', name: 'Gambar 6', createdAt: '2026-11-10T00:00:09.000Z' });
    const second = await list(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(names(second)).toEqual(['Gambar 3', 'Gambar 2']);
    const third = await list(`?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`);
    expect(names(third)).toEqual(['Gambar 1']);
    expect(third.nextCursor).toBeNull();
  });

  test('waktu sama dipecah id (tanpa lompatan): 4 baris waktu sama, limit=1', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      await seedGuide({ id, name: id, createdAt: '2026-11-10T00:00:00.000Z' });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page: StickerGuidePageDto = await list(
        `?limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['d', 'c', 'b', 'a']);
  });

  test('halaman kosong: items [] dan nextCursor null', async () => {
    expect(await list()).toEqual({ items: [], nextCursor: null });
  });

  test('limit di luar 1..pageMax = 422; bawaan pageDefault', async () => {
    expect((await rest.get('/sticker-guides?limit=0')).status).toBe(422);
    expect((await rest.get(`/sticker-guides?limit=${GUIDE_LIMITS.pageMax + 1}`)).status).toBe(422);
    expect((await rest.get('/sticker-guides?limit=1.5')).status).toBe(422);
    for (let i = 0; i < GUIDE_LIMITS.pageDefault + 2; i++) {
      await seedGuide({ id: `p${String(i).padStart(3, '0')}` });
    }
    const page = await list();
    expect(page.items).toHaveLength(GUIDE_LIMITS.pageDefault);
    expect(page.nextCursor).not.toBeNull();
  });

  test('kursor rusak, dari urutan lain, atau bertipe salah = diperlakukan sebagai tanpa kursor (halaman pertama)', async () => {
    for (let i = 1; i <= 3; i++) {
      await seedGuide({
        id: `g${i}`,
        name: `Gambar ${i}`,
        createdAt: `2026-11-10T00:00:0${i}.000Z`,
      });
    }
    const bad = await list(`?limit=2&cursor=${encodeURIComponent('###bukan-kursor')}`);
    expect(names(bad)).toEqual(['Gambar 3', 'Gambar 2']);
    const valid = await list('?limit=1&sort=nameAsc');
    // Kursor milik urutan nameAsc dipakai pada urutan newest: tidak sah.
    const mismatched = await list(
      `?limit=2&sort=newest&cursor=${encodeURIComponent(valid.nextCursor ?? '')}`,
    );
    expect(names(mismatched)).toEqual(['Gambar 3', 'Gambar 2']);
    for (const junk of ['', 'e30', 'W10', btoa('["x"]'), btoa('{"a":1}')]) {
      const page = await list(`?limit=2&cursor=${encodeURIComponent(junk)}`);
      expect(names(page)).toEqual(['Gambar 3', 'Gambar 2']);
    }
  });

  test('ganti nama saat menggulir (nameAsc) tidak merusak daftar atau menjatuhkan server', async () => {
    for (const name of ['a', 'b', 'c', 'd']) await seedGuide({ id: `g-${name}`, name });
    const first = await list('?sort=nameAsc&limit=2');
    expect(names(first)).toEqual(['a', 'b']);
    await env.DB.prepare("UPDATE sticker_guide_images SET name = 'zz' WHERE id = 'g-a'").run();
    const second = await list(
      `?sort=nameAsc&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(names(second)).toEqual(['c', 'd']);
  });
});

describe('GET /sticker-guides: urutan', () => {
  beforeEach(async () => {
    await seedGuide({ id: 'g1', name: 'Bravo', size: 300, createdAt: '2026-11-10T00:00:01.000Z' });
    await seedGuide({ id: 'g2', name: 'alfa', size: 100, createdAt: '2026-11-10T00:00:02.000Z' });
    await seedGuide({
      id: 'g3',
      name: 'Charlie',
      size: 200,
      createdAt: '2026-11-10T00:00:03.000Z',
    });
  });

  test.each([
    ['newest', ['Charlie', 'alfa', 'Bravo']],
    ['oldest', ['Bravo', 'alfa', 'Charlie']],
    ['nameAsc', ['alfa', 'Bravo', 'Charlie']],
    ['nameDesc', ['Charlie', 'Bravo', 'alfa']],
    ['sizeDesc', ['Bravo', 'Charlie', 'alfa']],
  ])('sort=%s', async (sort, expected) => {
    expect(names(await list(`?sort=${sort}`))).toEqual(expected);
    // Kursor halaman demi halaman menghasilkan urutan yang sama.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page: StickerGuidePageDto = await list(
        `?sort=${sort}&limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(expected);
  });

  test('sort tak dikenal = 422', async () => {
    expect((await rest.get('/sticker-guides?sort=acak')).status).toBe(422);
  });
});

describe('GET /sticker-guides: pencarian', () => {
  beforeEach(async () => {
    await seedGuide({ id: 'g1', name: 'Diskon 100% Hemat', createdAt: '2026-11-10T00:00:01.000Z' });
    await seedGuide({ id: 'g2', name: 'Diskon 100 Hemat', createdAt: '2026-11-10T00:00:02.000Z' });
    await seedGuide({ id: 'g3', name: 'a_b', createdAt: '2026-11-10T00:00:03.000Z' });
    await seedGuide({ id: 'g4', name: 'axb', createdAt: '2026-11-10T00:00:04.000Z' });
    await seedGuide({ id: 'g5', name: 'C:\\Foto\\Baru', createdAt: '2026-11-10T00:00:05.000Z' });
    await seedGuide({ id: 'g6', name: 'Kardus  Ganda 😀', createdAt: '2026-11-10T00:00:06.000Z' });
    await seedGuide({ id: 'g7', name: 'KARDUS besar', createdAt: '2026-11-10T00:00:07.000Z' });
  });

  const search = async (term: string) => names(await list(`?search=${encodeURIComponent(term)}`));

  test('% hanya cocok harfiah', async () => {
    expect(await search('100%')).toEqual(['Diskon 100% Hemat']);
    expect(await search('%')).toEqual(['Diskon 100% Hemat']);
  });

  test('_ hanya cocok harfiah (bukan satu karakter bebas)', async () => {
    expect(await search('a_b')).toEqual(['a_b']);
    expect(await search('_')).toEqual(['a_b']);
  });

  test('backslash hanya cocok harfiah', async () => {
    expect(await search('\\')).toEqual(['C:\\Foto\\Baru']);
    expect(await search('o\\b')).toEqual(['C:\\Foto\\Baru']);
  });

  test('tak peka huruf, spasi ganda, dan emoji', async () => {
    expect(await search('kardus')).toEqual(['KARDUS besar', 'Kardus  Ganda 😀']);
    expect(await search('Kardus  Ganda')).toEqual(['Kardus  Ganda 😀']);
    expect(await search('😀')).toEqual(['Kardus  Ganda 😀']);
  });

  test('pencarian kosong/spasi = tanpa filter; tanpa hasil = daftar kosong', async () => {
    expect((await list('?search=%20%20')).items).toHaveLength(7);
    expect(await list('?search=tidak-ada-yang-begini')).toEqual({ items: [], nextCursor: null });
  });

  test('pencarian lebih dari 120 karakter dipangkas (tidak galat)', async () => {
    const response = await rest.get(`/sticker-guides?search=${'x'.repeat(500)}`);
    expect(response.status).toBe(200);
  });
});

describe('GET /sticker-guides: filter mine dan unused', () => {
  test('mine = hanya unggahan pemanggil; unused = semua (belum ada penempatan di 3b-1)', async () => {
    await seedGuide({ id: 'g1', name: 'Milik Saya', email: 'iv@gmail.com' });
    await seedGuide({ id: 'g2', name: 'Orang Lain', email: 'uploader@gmail.com' });
    expect(names(await list('?mine=true', 'iv@gmail.com'))).toEqual(['Milik Saya']);
    expect(names(await list('?mine=false', 'iv@gmail.com')).sort()).toEqual([
      'Milik Saya',
      'Orang Lain',
    ]);
    expect(names(await list('?unused=true')).sort()).toEqual(['Milik Saya', 'Orang Lain']);
    expect(names(await list('?mine=true&unused=true', 'iv@gmail.com'))).toEqual(['Milik Saya']);
  });
});

describe('GET /sticker-guides: bentuk DTO', () => {
  test('tanpa email pengunggah; nama tampilan atau "Pengguna"; metadata dari files; hak per pemanggil', async () => {
    await seedGuide({ id: 'g1', name: 'Kardus', email: 'uploader@gmail.com', size: 4321 });
    await seedGuide({ id: 'g2', name: 'Tanpa Akun', email: 'hantu@gmail.com' });
    const viewer = await rest.get('/sticker-guides?sort=nameAsc', { email: 'iv@gmail.com' });
    const text = await viewer.text();
    expect(text).not.toContain('@gmail.com');
    const page = JSON.parse(text) as StickerGuidePageDto;
    expect(page.items[0]).toEqual({
      id: 'g1',
      name: 'Kardus',
      mime: 'image/png',
      size: 4321,
      width: 800,
      height: 600,
      uploadedBy: 'Budi Pengunggah',
      uploadedByMe: false,
      createdAt: '2026-11-10T00:00:00.000Z',
      usageCount: 0,
      canRename: false,
      canRemove: false,
    });
    expect(page.items[1]?.uploadedBy).toBe('Pengguna');

    const own = (await list('?sort=nameAsc', 'uploader@gmail.com')).items[0] as StickerGuideDto;
    expect(own).toMatchObject({ uploadedByMe: true, canRename: true, canRemove: true });
    const editor = (await list('?sort=nameAsc', 'ie@gmail.com')).items[0] as StickerGuideDto;
    expect(editor).toMatchObject({ uploadedByMe: false, canRename: false, canRemove: false });
    const manager = (await list('?sort=nameAsc', 'im@gmail.com')).items[0] as StickerGuideDto;
    expect(manager).toMatchObject({ canRename: true, canRemove: true });
    const stickerOnly = (await list('?sort=nameAsc', 'se@gmail.com')).items[0] as StickerGuideDto;
    expect(stickerOnly).toMatchObject({ canRename: false, canRemove: false });
  });

  test('uploader berizin sticker:edit tanpa item:edit tidak dapat mengganti nama/menghapus miliknya', async () => {
    await seedGuide({ id: 'g1', name: 'Milik se', email: 'se@gmail.com' });
    const item = (await list('', 'se@gmail.com')).items[0] as StickerGuideDto;
    expect(item).toMatchObject({ uploadedByMe: true, canRename: false, canRemove: false });
  });

  test('gambar bukan pemilik stickerguide atau berkas pending_delete tidak tampil', async () => {
    await seedGuide({ id: 'g1', name: 'Sah' });
    await seedGuide({ id: 'g2', name: 'Berkas Item', ownerType: 'item' });
    await seedGuide({ id: 'g3', name: 'Dihapus' });
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g3'").run();
    expect(names(await list())).toEqual(['Sah']);
  });
});

describe('GET /sticker-guides/{id}/thumbnail', () => {
  test('byte, Content-Type tetap, Cache-Control private + immutable, ETag id', async () => {
    await seedGuide({ id: 'g1' });
    const response = await rest.get('/sticker-guides/g1/thumbnail', { email: 'iv@gmail.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP_THUMB);
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: 'sv@gmail.com' })).status).toBe(
      200,
    );
  });

  test('thumbnail JPEG disajikan sebagai image/jpeg', async () => {
    await seedGuide({
      id: 'g1',
      thumb: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
      thumbMime: 'image/jpeg',
    });
    const response = await rest.get('/sticker-guides/g1/thumbnail');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  test('401 tanpa sesi, 403 tanpa izin', async () => {
    await seedGuide({ id: 'g1' });
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: null })).status).toBe(401);
    expect(
      (await rest.get('/sticker-guides/g1/thumbnail', { email: 'nol@gmail.com' })).status,
    ).toBe(403);
  });

  test('id berkas item, logo QR, stiker, yatim, pending_delete, atau tak ada = 404', async () => {
    await seedGuide({ id: 'g-item', ownerType: 'item' });
    await seedGuide({ id: 'g-logo', ownerType: 'qrlogo' });
    await seedGuide({ id: 'g-sticker', ownerType: 'sticker' });
    await seedGuide({ id: 'g-del' });
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g-del'").run();
    // Berkas biasa tanpa baris pustaka juga tak boleh terbaca lewat rute thumbnail.
    await env.DB.prepare(
      "INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES ('f-plain', 'd-plain', 'image/png', 1, 1, 1, 'item', 'i1', '', 'x', 'active')",
    ).run();
    for (const id of ['g-item', 'g-logo', 'g-sticker', 'g-del', 'f-plain', 'tidak-ada']) {
      const response = await rest.get(`/sticker-guides/${id}/thumbnail`);
      expect(response.status, id).toBe(404);
    }
  });

  test('If-None-Match yang cocok dijawab 304', async () => {
    await seedGuide({ id: 'g1' });
    const response = await rest.get('/sticker-guides/g1/thumbnail', {
      headers: { 'if-none-match': '"g1"' },
    });
    expect(response.status).toBe(304);
  });
});

describe('tidak dibatasi BU', () => {
  test('pemegang item:view tanpa BU mana pun tetap membaca daftar dan thumbnail', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AA' });
    await seedRole(env, { id: 'r-bu-view', name: 'Lihat BU', permissions: { item: 'view' } });
    await seedUser(env, {
      id: 'u-bu',
      email: 'bu@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-bu-view'] }],
    });
    await seedGuide({ id: 'g1', name: 'Terbuka' });
    expect(names(await list('', 'bu@gmail.com'))).toEqual(['Terbuka']);
    expect((await rest.get('/sticker-guides/g1/thumbnail', { email: 'bu@gmail.com' })).status).toBe(
      200,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Unggah (Task 3)
// ---------------------------------------------------------------------------------------------------------------

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function bytesOf(head: number[], size: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + seed) % 256;
  bytes.set(head, 0);
  // PNG: server membaca dimensi dari header IHDR (byte 16 dan 20), bukan klaim klien; samakan dengan klaim bawaan
  // (800x600) agar isi filler tidak terbaca sebagai dimensi raksasa.
  if (head[0] === 0x89 && size >= 24) bytes.set([0, 0, 3, 0x20, 0, 0, 2, 0x58], 16);
  return bytes;
}

/** WebP extended (VP8X) dengan dimensi di header, dipadatkan sampai `size` byte. */
function webpThumb(width: number, height: number, size = 64): Uint8Array {
  const u24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
  const head = [
    0x52,
    0x49,
    0x46,
    0x46,
    0x16,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u24(width - 1),
    ...u24(height - 1),
  ];
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head, 0);
  return bytes;
}

/** JPEG dengan segmen SOF0 berdimensi, dipadatkan sampai `size` byte. */
function jpegThumb(width: number, height: number, size = 64): Uint8Array {
  const head = [
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ];
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head, 0);
  return bytes;
}

interface UploadOptions {
  query?: Record<string, string>;
  image?: Uint8Array | null;
  thumbnail?: Uint8Array | null;
  email?: string | null;
}

function uploadRequest(options: UploadOptions = {}) {
  const query = new URLSearchParams({
    name: '  Foto   Kardus ',
    mime: 'image/png',
    thumbMime: 'image/webp',
    width: '800',
    height: '600',
    ...options.query,
  });
  const form = new FormData();
  const image = options.image === undefined ? bytesOf(PNG_HEAD, 2048) : options.image;
  const thumbnail = options.thumbnail === undefined ? webpThumb(320, 240, 512) : options.thumbnail;
  if (image) form.append('image', new Blob([image], { type: 'image/png' }), 'image');
  if (thumbnail) form.append('thumbnail', new Blob([thumbnail], { type: 'image/webp' }), 'thumb');
  return rest.post(`/sticker-guides?${query.toString()}`, {
    email: options.email === undefined ? 'ie@gmail.com' : options.email,
    raw: form,
  });
}

function uploadInput() {
  return {
    name: 'Foto Kardus',
    mime: 'image/png',
    thumbMime: 'image/webp',
    width: 800,
    height: 600,
    image: bytesOf(PNG_HEAD, 2048),
    thumbnail: webpThumb(320, 240, 512),
  };
}

async function counts() {
  const files = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM files WHERE owner_type = 'stickerguide'",
  ).first<{ n: number | string }>();
  const guides = await env.DB.prepare('SELECT COUNT(*) AS n FROM sticker_guide_images').first<{
    n: number | string;
  }>();
  return { files: Number(files?.n), guides: Number(guides?.n) };
}

const driveLive = () => [...env.BRIDGE.state.files.values()].filter((file) => !file.trashed);

describe('POST /sticker-guides', () => {
  test('201 + DTO; nama dirapikan; berkas milik stickerguide; Drive terisi; Location', async () => {
    const response = await uploadRequest();
    expect(response.status).toBe(201);
    const dto = (await response.json()) as StickerGuideDto;
    expect(dto).toMatchObject({
      name: 'Foto   Kardus',
      mime: 'image/png',
      size: 2048,
      width: 800,
      height: 600,
      usageCount: 0,
      uploadedByMe: true,
      canRename: true,
      canRemove: true,
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    expect(response.headers.get('location')).toBe(`/api/v1/sticker-guides/${dto.id}`);
    const file = await env.DB.prepare(
      'SELECT owner_type, owner_id, created_by, mime, size, status FROM files WHERE id = ?',
    )
      .bind(dto.id)
      .first<Record<string, unknown>>();
    expect(file).toMatchObject({
      owner_type: 'stickerguide',
      owner_id: dto.id,
      created_by: 'ie@gmail.com',
      mime: 'image/png',
      status: 'active',
    });
    expect(driveLive()).toHaveLength(1);
    // Thumbnail tersimpan dan terbaca kembali; daftar memuatnya.
    const thumb = await rest.get(`/sticker-guides/${dto.id}/thumbnail`);
    expect([...new Uint8Array(await thumb.arrayBuffer())]).toEqual([...webpThumb(320, 240, 512)]);
    expect(names(await list())).toEqual(['Foto   Kardus']);
  });

  test('item:edit saja boleh; sticker:edit saja, item:view, dan tanpa izin 403; tanpa sesi 401', async () => {
    expect((await uploadRequest({ email: 'ie@gmail.com' })).status).toBe(201);
    expect((await uploadRequest({ email: 'im@gmail.com' })).status).toBe(201);
    for (const email of ['se@gmail.com', 'iv@gmail.com', 'sv@gmail.com', 'nol@gmail.com']) {
      expect((await uploadRequest({ email })).status, email).toBe(403);
    }
    expect((await uploadRequest({ email: null })).status).toBe(401);
    expect(await counts()).toEqual({ files: 2, guides: 2 });
  });

  test('tidak memakai kuota "unggahan yatim" (lebih dari MAX_UNATTACHED_UPLOADS)', async () => {
    for (let i = 0; i < 3; i++) expect((await uploadRequest()).status).toBe(201);
    const orphan = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM files WHERE owner_type = '' AND created_by = 'ie@gmail.com'",
    ).first<{ n: number | string }>();
    expect(Number(orphan?.n)).toBe(0);
  });

  test.each([
    [
      'tanda tangan palsu (PNG berisi teks)',
      { image: new TextEncoder().encode('bukan gambar sama sekali') },
      'image',
    ],
    ['gambar kosong', { image: new Uint8Array(0) }, 'image'],
    ['gambar tak ada', { image: null }, 'image'],
    [
      'thumbnail > 40 KB',
      { thumbnail: webpThumb(320, 240, GUIDE_LIMITS.thumbMaxBytes + 1) },
      'thumbnail',
    ],
    ['thumbnail bertanda tangan GIF', { thumbnail: bytesOf(GIF_HEAD, 300) }, 'thumbnail'],
    ['thumbnail PNG (bukan webp/jpeg)', { thumbnail: bytesOf(PNG_HEAD, 300) }, 'thumbnail'],
    ['thumbnail tak ada', { thumbnail: null }, 'thumbnail'],
    ['thumbMime di luar daftar', { query: { thumbMime: 'image/png' } }, 'thumbMime'],
    ['nama kosong', { query: { name: '' } }, 'name'],
    ['nama spasi', { query: { name: '    ' } }, 'name'],
    ['nama terlalu panjang', { query: { name: 'x'.repeat(GUIDE_LIMITS.nameMax + 1) } }, 'name'],
    ['mime di luar daftar', { query: { mime: 'image/gif' } }, 'mime'],
    ['mime tidak cocok dengan isi', { query: { mime: 'image/jpeg' } }, 'image'],
    ['lebar 0', { query: { width: '0' } }, 'width'],
    ['tinggi di atas batas', { query: { height: '4001' } }, 'height'],
    ['lebar pecahan', { query: { width: '10.5' } }, 'width'],
  ] as [string, UploadOptions, string][])('VALIDATION: %s', async (_label, options, field) => {
    const response = await uploadRequest(options);
    expect(response.status).toBe(422);
    const body = await jsonOf(response);
    expect(body).toMatchObject({ code: 'VALIDATION' });
    expect(Object.keys((body.fields ?? {}) as object)).toContain(field);
    expect(await counts()).toEqual({ files: 0, guides: 0 });
    expect(env.BRIDGE.state.files.size).toBe(0);
  });

  test('nama persis nameMax karakter (emoji = 1) diterima; berlebih ditolak', async () => {
    const ok = await uploadRequest({ query: { name: '😀'.repeat(GUIDE_LIMITS.nameMax) } });
    expect(ok.status).toBe(201);
    const over = await uploadRequest({ query: { name: '😀'.repeat(GUIDE_LIMITS.nameMax + 1) } });
    expect(over.status).toBe(422);
  });

  test('gambar persis 10 MB diterima (JPEG, thumbnail JPEG)', async () => {
    const response = await uploadRequest({
      query: { mime: 'image/jpeg', thumbMime: 'image/jpeg' },
      image: bytesOf(JPEG_HEAD, MAX_IMAGE_BYTES),
      thumbnail: jpegThumb(320, 240, GUIDE_LIMITS.thumbMaxBytes),
    });
    expect(response.status).toBe(201);
  });

  test.each([
    ['WebP 800x600', { thumbnail: webpThumb(800, 600) }],
    ['JPEG 800x600', { thumbnail: jpegThumb(800, 600), query: { thumbMime: 'image/jpeg' } }],
    ['WebP 401x300 (sisi terpanjang di atas batas)', { thumbnail: webpThumb(401, 300) }],
    ['JPEG 300x401', { thumbnail: jpegThumb(300, 401), query: { thumbMime: 'image/jpeg' } }],
    ['WebP header terpotong (hanya tanda tangan)', { thumbnail: webpThumb(320, 240).slice(0, 14) }],
    [
      'WebP tanpa chunk dimensi',
      { thumbnail: bytesOf([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 64) },
    ],
    [
      'JPEG tanpa segmen SOF',
      { thumbnail: bytesOf([0xff, 0xd8, 0xff, 0xda], 64), query: { thumbMime: 'image/jpeg' } },
    ],
    [
      'JPEG header terpotong',
      { thumbnail: jpegThumb(320, 240).slice(0, 8), query: { thumbMime: 'image/jpeg' } },
    ],
  ] as [string, UploadOptions][])(
    'thumbnail dimensi/header: %s ditolak (VALIDATION)',
    async (_label, options) => {
      const response = await uploadRequest(options);
      expect(response.status).toBe(422);
      expect(Object.keys(((await jsonOf(response)).fields ?? {}) as object)).toContain('thumbnail');
      expect(await counts()).toEqual({ files: 0, guides: 0 });
      expect(env.BRIDGE.state.files.size).toBe(0);
    },
  );

  test.each([
    ['WebP 320x240', { thumbnail: webpThumb(320, 240) }],
    ['WebP persis 400x300', { thumbnail: webpThumb(400, 300) }],
    ['JPEG 320x240', { thumbnail: jpegThumb(320, 240), query: { thumbMime: 'image/jpeg' } }],
    ['JPEG persis 300x400', { thumbnail: jpegThumb(300, 400), query: { thumbMime: 'image/jpeg' } }],
  ] as [string, UploadOptions][])('thumbnail sah: %s diterima', async (_label, options) => {
    expect((await uploadRequest(options)).status).toBe(201);
  });

  test('kegagalan basis data setelah Drive: berkas Drive dibuang, tidak ada baris tersisa, INTERNAL', async () => {
    const realError = console.error;
    console.error = () => undefined;
    try {
      const failing = Object.create(env.DB, {
        batch: {
          value: async () => {
            throw new DbError('boom', { errno: 1, kind: 'other' });
          },
        },
      }) as TestEnv['DB'];
      const broken: TestEnv = { ...env, DB: failing };
      const actor = await loadUserContext(env, 'ie@gmail.com');
      if (!actor) throw new Error('aktor hilang');
      const error = await captureAppErrorAsync(() =>
        uploadGuide(broken, validateUploadGuide(uploadInput()), actor),
      );
      expect(error.code).toBe('INTERNAL');
      expect(env.BRIDGE.calls.map((call) => call.action)).toContain('trashFile');
      expect(driveLive()).toHaveLength(0);
      expect(await counts()).toEqual({ files: 0, guides: 0 });
    } finally {
      console.error = realError;
    }
  });

  describe('batas pustaka', () => {
    /** Mengisi pustaka sebanyak `count` baris (massal lewat SQL). */
    async function fill(count: number): Promise<void> {
      for (let from = 0; from < count; from += 500) {
        const size = Math.min(500, count - from);
        const ids = Array.from({ length: size }, (_, i) => `bulk-${from + i}`);
        await env.DB.prepare(
          `INSERT INTO files (id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status) VALUES ${ids
            .map(
              () =>
                "(?, ?, 'image/png', 1, 1, 1, 'stickerguide', ?, '2026-11-10T00:00:00.000Z', 'x@gmail.com', 'active')",
            )
            .join(',')}`,
        )
          .bind(...ids.flatMap((id) => [id, `d-${id}`, id]))
          .run();
        await env.DB.prepare(
          `INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES ${ids
            .map(() => "(?, ?, 'image/webp', X'00', '')")
            .join(',')}`,
        )
          .bind(...ids.flatMap((id) => [id, id]))
          .run();
      }
    }

    test('pustaka terisi libraryMax: CONFLICT berpesan jelas lewat pra-cek, Drive tak disentuh, tak ada baris baru', async () => {
      await fill(GUIDE_LIMITS.libraryMax);
      const response = await uploadRequest();
      expect(response.status).toBe(409);
      expect(await jsonOf(response)).toMatchObject({
        code: 'CONFLICT',
        detail: 'Pustaka gambar penuh (2.000 gambar)',
      });
      // Pra-cek murah: tak ada satu pun panggilan ke Drive (unggahan 10 MB tidak dikirim lalu dibuang).
      expect(env.BRIDGE.calls.map((call) => call.action)).not.toContain('createFile');
      expect(env.BRIDGE.calls.map((call) => call.action)).not.toContain('trashFile');
      expect(env.BRIDGE.state.files.size).toBe(0);
      expect(await counts()).toEqual({
        files: GUIDE_LIMITS.libraryMax,
        guides: GUIDE_LIMITS.libraryMax,
      });
    });

    test('balapan: pada libraryMax - 1, tiga unggahan serentak menghasilkan tepat 1 sukses dan 2 CONFLICT', async () => {
      await fill(GUIDE_LIMITS.libraryMax - 1);
      const responses = await Promise.all([uploadRequest(), uploadRequest(), uploadRequest()]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      expect(await counts()).toEqual({
        files: GUIDE_LIMITS.libraryMax,
        guides: GUIDE_LIMITS.libraryMax,
      });
      // Hanya hasil akhir yang deterministik yang ditegaskan: jumlah panggilan `createFile` bergantung waktu (pra-cek
      // sebuah unggahan yang terlambat dapat melihat penyisipan yang sudah commit lalu menolak tanpa menyentuh Drive).
      // Penegak batas tetap penjaga di dalam batch; berkas Drive yang kalah di batch dibuang.
      const actions = env.BRIDGE.calls.map((call) => call.action);
      const created = actions.filter((action) => action === 'createFile').length;
      const trashed = actions.filter((action) => action === 'trashFile').length;
      expect(created).toBeGreaterThanOrEqual(1);
      expect(created).toBeLessThanOrEqual(3);
      expect(created - trashed).toBe(1);
      expect(driveLive()).toHaveLength(1);
    });
  });
});

describe('gambar pustaka tidak dapat dipasang sebagai gambar lain', () => {
  test('planAttachFiles ke sticker, item, dan qrlogo melempar', async () => {
    const dto = (await (await uploadRequest()).json()) as StickerGuideDto;
    for (const ownerType of ['sticker', 'item', 'qrlogo'] as const) {
      const error = await captureAppErrorAsync(() =>
        planAttachFiles(env, [dto.id], ownerType, 'pemilik-1', undefined, 'ie@gmail.com'),
      );
      expect(['VALIDATION', 'CONFLICT']).toContain(error.code);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Ganti nama, hapus, dan baca gambar penuh (Task 4)
// ---------------------------------------------------------------------------------------------------------------

async function uploadAs(email: string, name = 'Kardus'): Promise<StickerGuideDto> {
  const response = await uploadRequest({ email, query: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as StickerGuideDto;
}

const audits = async (action: string) =>
  (
    await env.DB.prepare(
      'SELECT actor, target, `before`, `after` FROM audit_log WHERE action = ? ORDER BY id',
    )
      .bind(action)
      .all<{ actor: string; target: string; before: string; after: string }>()
  ).results;

const rename = (id: string, name: unknown, email = 'ie@gmail.com') =>
  rest.patch(`/sticker-guides/${id}`, { email, body: { name } });

const remove = (id: string, email = 'ie@gmail.com') => rest.del(`/sticker-guides/${id}`, { email });

describe('PATCH /sticker-guides/{id} (ganti nama)', () => {
  test('pengunggah (item:edit): 200, nama dirapikan, audit before/after, daftar ikut berubah', async () => {
    const guide = await uploadAs('ie@gmail.com', 'Lama');
    const response = await rename(guide.id, '  Nama   Baru ');
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toMatchObject({ id: guide.id, name: 'Nama   Baru' });
    const rows = await audits('stickerGuide.rename');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'ie@gmail.com', target: 'Nama   Baru' });
    expect(JSON.parse(rows[0]?.before ?? '')).toEqual({ id: guide.id, name: 'Lama' });
    expect(JSON.parse(rows[0]?.after ?? '')).toEqual({ id: guide.id, name: 'Nama   Baru' });
    expect(names(await list('?search=baru'))).toEqual(['Nama   Baru']);
    expect(names(await list('?search=lama'))).toEqual([]);
  });

  test('gambar orang lain: item:edit 403 (tak berubah), item:manage 200', async () => {
    const guide = await uploadAs('uploader@gmail.com', 'Milik Budi');
    const denied = await rename(guide.id, 'Dicuri', 'ie@gmail.com');
    expect(denied.status).toBe(403);
    expect(names(await list())).toEqual(['Milik Budi']);
    expect(await audits('stickerGuide.rename')).toHaveLength(0);
    const allowed = await rename(guide.id, 'Oleh Pengelola', 'im@gmail.com');
    expect(allowed.status).toBe(200);
    expect(names(await list())).toEqual(['Oleh Pengelola']);
    expect((await audits('stickerGuide.rename'))[0]?.actor).toBe('im@gmail.com');
  });

  test('izin rute: item:edit saja; sticker:edit, item:view, tanpa izin 403; tanpa sesi 401', async () => {
    const guide = await uploadAs('ie@gmail.com');
    for (const email of ['se@gmail.com', 'iv@gmail.com', 'sv@gmail.com', 'nol@gmail.com']) {
      expect((await rename(guide.id, 'X', email)).status, email).toBe(403);
    }
    expect(
      (await rest.patch(`/sticker-guides/${guide.id}`, { email: null, body: { name: 'X' } }))
        .status,
    ).toBe(401);
  });

  test.each([
    ['kosong', ''],
    ['spasi', '   '],
    ['terlalu panjang', 'x'.repeat(GUIDE_LIMITS.nameMax + 1)],
    ['bukan teks', 123],
    ['tak ada', undefined],
  ])('nama %s = 422 dan tak menulis audit', async (_label, name) => {
    const guide = await uploadAs('ie@gmail.com', 'Awal');
    const response = await rename(guide.id, name);
    expect(response.status).toBe(422);
    expect(await jsonOf(response)).toMatchObject({ code: 'VALIDATION' });
    expect(names(await list())).toEqual(['Awal']);
    expect(await audits('stickerGuide.rename')).toHaveLength(0);
  });

  test('id tak ada, berkas non-pustaka, atau pending_delete = 404', async () => {
    await seedGuide({ id: 'g-item', ownerType: 'item' });
    await seedGuide({ id: 'g-del' });
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = 'g-del'").run();
    for (const id of ['tidak-ada', 'g-item', 'g-del']) {
      expect((await rename(id, 'Baru', 'im@gmail.com')).status, id).toBe(404);
    }
  });

  test('nama sama = 200 tanpa audit baru', async () => {
    const guide = await uploadAs('ie@gmail.com', 'Sama');
    expect((await rename(guide.id, 'Sama')).status).toBe(200);
    expect(await audits('stickerGuide.rename')).toHaveLength(0);
  });

  test('terakhir-menang: dua penggantian berurutan, yang terakhir tersimpan (tanpa If-Match)', async () => {
    const guide = await uploadAs('ie@gmail.com', 'A');
    expect((await rename(guide.id, 'B')).status).toBe(200);
    expect((await rename(guide.id, 'C')).status).toBe(200);
    expect(names(await list())).toEqual(['C']);
  });
});

describe('DELETE /sticker-guides/{id} (hapus)', () => {
  test('pengunggah: 200 {id}; baris files dan pustaka hilang, Drive dibuang, audit tertulis, thumbnail 404', async () => {
    const guide = await uploadAs('ie@gmail.com', 'Hapus Aku');
    expect(driveLive()).toHaveLength(1);
    const response = await remove(guide.id);
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ id: guide.id });
    expect(await counts()).toEqual({ files: 0, guides: 0 });
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE id = ?')
      .bind(guide.id)
      .first<{ n: number | string }>();
    expect(Number(left?.n)).toBe(0);
    expect(driveLive()).toHaveLength(0);
    expect(env.BRIDGE.calls.map((call) => call.action)).toContain('trashFile');
    const rows = await audits('stickerGuide.remove');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'ie@gmail.com', target: 'Hapus Aku', after: 'null' });
    expect(JSON.parse(rows[0]?.before ?? '')).toMatchObject({ id: guide.id, name: 'Hapus Aku' });
    expect((await rest.get(`/sticker-guides/${guide.id}/thumbnail`)).status).toBe(404);
    expect((await rest.get(`/files/${guide.id}`)).status).toBe(404);
    expect(names(await list())).toEqual([]);
  });

  test('gambar orang lain: item:edit 403 (utuh), item:manage 200', async () => {
    const guide = await uploadAs('uploader@gmail.com', 'Milik Budi');
    expect((await remove(guide.id, 'ie@gmail.com')).status).toBe(403);
    expect(await counts()).toEqual({ files: 1, guides: 1 });
    expect(driveLive()).toHaveLength(1);
    expect(await audits('stickerGuide.remove')).toHaveLength(0);
    expect((await remove(guide.id, 'im@gmail.com')).status).toBe(200);
    expect(await counts()).toEqual({ files: 0, guides: 0 });
  });

  test('izin rute: sticker:edit, item:view, tanpa izin 403; tanpa sesi 401', async () => {
    const guide = await uploadAs('ie@gmail.com');
    for (const email of ['se@gmail.com', 'iv@gmail.com', 'sv@gmail.com', 'nol@gmail.com']) {
      expect((await remove(guide.id, email)).status, email).toBe(403);
    }
    expect((await rest.del(`/sticker-guides/${guide.id}`, { email: null })).status).toBe(401);
    expect(await counts()).toEqual({ files: 1, guides: 1 });
  });

  test('id tak ada, hapus kedua kali, atau berkas non-pustaka = 404 (berkas lain tak tersentuh)', async () => {
    await seedGuide({ id: 'g-item', ownerType: 'item' });
    const guide = await uploadAs('ie@gmail.com');
    expect((await remove('tidak-ada', 'im@gmail.com')).status).toBe(404);
    expect((await remove('g-item', 'im@gmail.com')).status).toBe(404);
    const itemFile = await env.DB.prepare("SELECT status FROM files WHERE id = 'g-item'").first<{
      status: string;
    }>();
    expect(itemFile?.status).toBe('active');
    expect((await remove(guide.id)).status).toBe(200);
    expect((await remove(guide.id)).status).toBe(404);
    expect(await audits('stickerGuide.remove')).toHaveLength(1);
  });

  test('Drive gagal dibuang: tetap 200, baris pustaka hilang, berkas pending_delete menunggu cron', async () => {
    const realError = console.error;
    console.error = () => undefined;
    try {
      const guide = await uploadAs('ie@gmail.com');
      env.BRIDGE.failNext('trashFile', new Error('Drive mati'));
      expect((await remove(guide.id)).status).toBe(200);
      const file = await env.DB.prepare('SELECT status FROM files WHERE id = ?')
        .bind(guide.id)
        .first<{ status: string }>();
      expect(file?.status).toBe('pending_delete');
      expect((await counts()).guides).toBe(0);
      expect(names(await list())).toEqual([]);
    } finally {
      console.error = realError;
    }
  });
});

describe('GET /files/{id} untuk gambar pustaka', () => {
  test('sticker:view saja 200 dan byte utuh; item:view saja 200; tanpa keduanya 403', async () => {
    const guide = await uploadAs('ie@gmail.com');
    for (const email of ['sv@gmail.com', 'iv@gmail.com', 'ie@gmail.com', 'im@gmail.com']) {
      const response = await rest.get(`/files/${guide.id}`, { email });
      expect(response.status, email).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
        ...bytesOf(PNG_HEAD, 2048),
      ]);
    }
    expect((await rest.get(`/files/${guide.id}`, { email: 'nol@gmail.com' })).status).toBe(403);
    expect((await rest.get(`/files/${guide.id}`, { email: null })).status).toBe(401);
  });

  test('pemegang qrcode:view saja lolos rute tetapi gambar pustaka = 404', async () => {
    await seedRole(env, { id: 'r-qr-view', name: 'Lihat QR', permissions: { qrcode: 'view' } });
    await seedUser(env, { id: 'u-qv', email: 'qv@gmail.com', roleIds: ['r-qr-view'] });
    const guide = await uploadAs('ie@gmail.com');
    expect((await rest.get(`/files/${guide.id}`, { email: 'qv@gmail.com' })).status).toBe(404);
  });

  test('tak dibatasi BU: pengguna item di BU lain dan pemegang sticker:view tanpa BU tetap 200', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AA' });
    await seedRole(env, { id: 'r-bu-view', name: 'Lihat BU', permissions: { item: 'view' } });
    await seedUser(env, {
      id: 'u-bu',
      email: 'bu@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-bu-view'] }],
    });
    const guide = await uploadAs('ie@gmail.com');
    expect((await rest.get(`/files/${guide.id}`, { email: 'bu@gmail.com' })).status).toBe(200);
    // `sv@gmail.com` hanya punya sticker:view dan tidak punya penugasan BU sama sekali.
    expect((await rest.get(`/files/${guide.id}`, { email: 'sv@gmail.com' })).status).toBe(200);
  });

  test('gambar yang dihapus (pending_delete) tak terbaca', async () => {
    const guide = await uploadAs('ie@gmail.com');
    await env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = ?")
      .bind(guide.id)
      .run();
    expect((await rest.get(`/files/${guide.id}`, { email: 'sv@gmail.com' })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Pemakaian nyata pustaka (3b-2, Task 6): usageCount, unused, hapus dijaga FK, urut usageDesc, usages
// ---------------------------------------------------------------------------------------------------------------

describe('pemakaian nyata pustaka (3b-2)', () => {
  const place = (itemId: string, guideId: string) =>
    env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, ?, '', '', 0)",
    )
      .bind(itemId, guideId)
      .run();

  const usages = async (guideId: string, email?: string) => {
    const response = await rest.get(`/sticker-guides/${guideId}/usages`, email ? { email } : {});
    expect(response.status).toBe(200);
    return (await response.json()) as Array<{ itemId: string; label: string; status: string }>;
  };

  const itemBody = (model: string, stickerPhotos: unknown[]) => ({
    brandId: brandIdOf('Sony'),
    businessUnitIds: ['bu-p'],
    model,
    isCountryLock: false,
    aliases: [],
    stickerPhotos,
    accessories: [],
    attachments: [],
    detail: '',
  });

  beforeEach(async () => {
    await seedBusinessUnit(env, { id: 'bu-p', code: 'P' });
    await seedBusinessUnit(env, { id: 'bu-q', code: 'Q' });
    await seedBrand(env, 'Sony');
    await seedUser(env, {
      id: 'u-bup',
      email: 'bup@gmail.com',
      buAssignments: [{ buId: 'bu-p', roleIds: ['r-item-view'] }],
    });
  });

  test('usageCount benar, unused menyembunyikan yang dipakai, item nonaktif tetap dihitung', async () => {
    await seedGuide({ id: 'g1', name: 'Dipakai' });
    await seedGuide({ id: 'g2', name: 'Bebas' });
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-p'] });
    await seedItem(env, {
      id: 'i2',
      brand: 'Sony',
      model: 'Dua',
      status: 'inactive',
      businessUnitIds: ['bu-q'],
    });
    await place('i1', 'g1');
    await place('i2', 'g1');
    const all = await list();
    expect(Object.fromEntries(all.items.map((item) => [item.name, item.usageCount]))).toEqual({
      Dipakai: 2,
      Bebas: 0,
    });
    expect(names(await list('?unused=true'))).toEqual(['Bebas']);
  });

  test('hapus gambar terpakai = CONFLICT "Gambar masih dipakai"; gambar dan penempatan tetap; item nonaktif menahan juga', async () => {
    const guide = await uploadAs('ie@gmail.com', 'Terpakai');
    await seedItem(env, {
      id: 'i1',
      brand: 'Sony',
      model: 'Nonaktif',
      status: 'inactive',
      businessUnitIds: ['bu-p'],
    });
    await place('i1', guide.id);
    const response = await remove(guide.id);
    expect(response.status).toBe(409);
    expect(await jsonOf(response)).toMatchObject({
      code: 'CONFLICT',
      detail: 'Gambar masih dipakai',
    });
    expect(await counts()).toEqual({ files: 1, guides: 1 });
    expect(driveLive()).toHaveLength(1);
    expect(await audits('stickerGuide.remove')).toHaveLength(0);
    const placements = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_sticker_photos').first<{
      n: number | string;
    }>();
    expect(Number(placements?.n)).toBe(1);
    // setelah penempatan dilepas, hapus berhasil
    await env.DB.prepare('DELETE FROM item_sticker_photos').run();
    expect((await remove(guide.id)).status).toBe(200);
  });

  test('FK RESTRICT menahan hapus walau pemeriksaan usageCount terlewati (galat 1451)', async () => {
    await seedGuide({ id: 'g1', name: 'Dikunci', email: 'ie@gmail.com' });
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-p'] });
    await place('i1', 'g1');
    const failure = await env.DB.prepare('DELETE FROM sticker_guide_images WHERE id = ?')
      .bind('g1')
      .run()
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(DbError);
    expect((failure as DbError).errno).toBe(1451);
  });

  test('balapan: hapus gambar bersamaan dengan items.save yang memakainya; tidak ada penempatan yatim atau 500', async () => {
    for (let round = 0; round < 4; round++) {
      const guide = await uploadAs('ie@gmail.com', `Balapan ${round}`);
      const created = await rest.post('/items', { body: itemBody(`Item ${round}`, []) });
      expect(created.status).toBe(201);
      const item = (await created.json()) as { id: string };
      const photos = [{ guideId: guide.id, caption: '', buId: null, marks: [] }];
      const [deleted, saved] = await Promise.all([
        remove(guide.id),
        rest.put(`/items/${item.id}`, { body: itemBody(`Item ${round}`, photos) }),
      ]);
      const pair = `${deleted.status}/${saved.status}`;
      // salah satu menang: (hapus 200, simpan 422) atau (hapus 409, simpan 200)
      expect(['200/422', '409/200']).toContain(pair);
      const guideRows = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sticker_guide_images WHERE id = ?',
      )
        .bind(guide.id)
        .first<{ n: number | string }>();
      const placementRows = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM item_sticker_photos WHERE guide_id = ?',
      )
        .bind(guide.id)
        .first<{ n: number | string }>();
      // konsisten: gambar ada <=> penempatan ada (tidak pernah penempatan tanpa gambar)
      expect(Number(guideRows?.n)).toBe(Number(placementRows?.n));
    }
  });

  test('urut usageDesc (paling sering dipakai; seri dipecah id) termasuk kursor halaman demi halaman', async () => {
    await seedGuide({ id: 'g1', name: 'Satu pakai' });
    await seedGuide({ id: 'g2', name: 'Dua pakai' });
    await seedGuide({ id: 'g3', name: 'Nol pakai' });
    await seedGuide({ id: 'g4', name: 'Satu pakai lain' });
    for (const [id, model] of [
      ['i1', 'A'],
      ['i2', 'B'],
      ['i3', 'C'],
    ] as const) {
      await seedItem(env, { id, brand: 'Sony', model, businessUnitIds: ['bu-p'] });
    }
    await place('i1', 'g2');
    await place('i2', 'g2');
    await place('i1', 'g1');
    await place('i3', 'g4');
    const expected = ['Dua pakai', 'Satu pakai lain', 'Satu pakai', 'Nol pakai'];
    expect(names(await list('?sort=usageDesc'))).toEqual(expected);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page: StickerGuidePageDto = await list(
        `?sort=usageDesc&limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...names(page));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(expected);
  });

  test('usages: hanya item BU terlihat (urut nama), item nonaktif berstatus, tanpa item di luar BU', async () => {
    await seedGuide({ id: 'g1' });
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Zeta', businessUnitIds: ['bu-p'] });
    await seedItem(env, {
      id: 'i2',
      brand: 'Sony',
      model: 'Alfa',
      status: 'inactive',
      businessUnitIds: ['bu-p'],
    });
    await seedItem(env, { id: 'i3', brand: 'Sony', model: 'Rahasia', businessUnitIds: ['bu-q'] });
    await seedItem(env, {
      id: 'i4',
      brand: 'Sony',
      model: 'Dua BU',
      businessUnitIds: ['bu-p', 'bu-q'],
    });
    for (const id of ['i1', 'i2', 'i3', 'i4']) await place(id, 'g1');
    const visible = await usages('g1', 'bup@gmail.com');
    expect(visible).toEqual([
      { itemId: 'i2', label: 'Sony Alfa', status: 'inactive' },
      { itemId: 'i4', label: 'Sony Dua BU', status: 'active' },
      { itemId: 'i1', label: 'Sony Zeta', status: 'active' },
    ]);
    expect(JSON.stringify(visible)).not.toContain('Rahasia');
    // admin melihat semua, termasuk item BU lain
    expect((await usages('g1')).map((u) => u.itemId).sort()).toEqual(['i1', 'i2', 'i3', 'i4']);
    // item terhapus tidak dihitung sebagai pemakai (soft delete §5 butir 16)
    await env.DB.prepare(
      "UPDATE items SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed', status = 'inactive' WHERE id = 'i3'",
    ).run();
    expect((await usages('g1')).map((u) => u.itemId).sort()).toEqual(['i1', 'i2', 'i4']);
  });

  test('usages: maksimal 20 item; id tak dikenal = daftar kosong; izin item:view (sticker:view saja dan tanpa izin 403)', async () => {
    await seedGuide({ id: 'g1' });
    for (let i = 0; i < 25; i++) {
      const id = `i${String(i).padStart(2, '0')}`;
      await seedItem(env, { id, brand: 'Sony', model: `M${id}`, businessUnitIds: ['bu-p'] });
      await place(id, 'g1');
    }
    expect(await usages('g1')).toHaveLength(20);
    expect(await usages('tidak-ada')).toEqual([]);
    expect((await rest.get('/sticker-guides/g1/usages', { email: 'iv@gmail.com' })).status).toBe(
      200,
    );
    for (const email of ['sv@gmail.com', 'nol@gmail.com']) {
      expect((await rest.get('/sticker-guides/g1/usages', { email })).status, email).toBe(403);
    }
    expect((await rest.get('/sticker-guides/g1/usages', { email: null })).status).toBe(401);
  });
});
