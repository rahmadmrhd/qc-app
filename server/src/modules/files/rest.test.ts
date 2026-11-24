import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { MAX_IMAGE_BYTES } from '@shared/files';

// Kabel REST untuk berkas gambar: unggah badan mentah (Content-Type = mime), unduh mengalirkan byte.

setDefaultTimeout(30_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff];

/** Gambar PNG palsu (tanda tangan sah) berukuran persis `size` byte dengan isi yang dapat dibandingkan. */
function pngOf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 256;
  bytes.set(PNG_HEAD, 0);
  // Server membaca dimensi dari header (IHDR: lebar di byte 16, tinggi di byte 20), bukan dari klaim klien: samakan
  // dengan klaim bawaan `upload()` (10x20) agar isi filler tidak terbaca sebagai dimensi raksasa.
  if (size >= 24) bytes.set([0, 0, 0, 10, 0, 0, 0, 20], 16);
  return bytes;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-qv', name: 'QR lihat', permissions: { qrcode: 'view' } });
  await seedUser(env, { id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] });
  await seedUser(env, { id: 'u-q', email: 'qrlihat@gmail.com', roleIds: ['r-qv'] });
  await seedUser(env, { id: 'u-n', email: 'tanpa@gmail.com' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

/** Memasang berkas pada sebuah item (keadaan sesudah item disimpan): unggahan belum terpasang hanya terbaca pengunggahnya. */
async function attachToItem(fileId: string): Promise<void> {
  await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i-rest', brand: 'Sony', model: 'Rest' });
  await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'i-rest' WHERE id = ?")
    .bind(fileId)
    .run();
}

const upload = (
  bytes: Uint8Array,
  options: { mime?: string; email?: string | null; query?: string } = {},
) =>
  rest.post(`/files${options.query ?? '?width=10&height=20'}`, {
    email: options.email,
    raw: bytes,
    headers: { 'content-type': options.mime ?? 'image/png' },
  });

describe('POST /files (badan mentah)', () => {
  test('201 + Location + FileDto; byte tersimpan di Drive sebagai base64 (hanya di jembatan)', async () => {
    const bytes = pngOf(64);
    const response = await upload(bytes, { email: 'ubah@gmail.com' });
    expect(response.status).toBe(201);
    const dto = await jsonOf(response);
    expect(dto).toMatchObject({ mime: 'image/png', size: 64, width: 10, height: 20 });
    expect(response.headers.get('location')).toBe(`/api/v1/files/${dto.id as string}`);
    const stored = [...env.BRIDGE.state.files.values()][0];
    expect(stored?.base64).toBe(Buffer.from(bytes).toString('base64'));
  });

  test('izin tetap: view saja 403, tanpa modul 403, tanpa sesi 401', async () => {
    expect((await upload(pngOf(8), { email: 'lihat@gmail.com' })).status).toBe(403);
    expect((await upload(pngOf(8), { email: 'tanpa@gmail.com' })).status).toBe(403);
    expect((await upload(pngOf(8), { email: null })).status).toBe(401);
  });

  test('mime tidak diizinkan -> 422 (fields.mime); tanda tangan tidak cocok -> 422 (fields.bytes)', async () => {
    const gif = await upload(pngOf(8), { mime: 'image/gif' });
    expect(gif.status).toBe(422);
    expect(await jsonOf(gif)).toMatchObject({ fields: { mime: 'Hanya JPEG, PNG, atau WebP' } });
    const wrong = await upload(new Uint8Array([...JPEG_HEAD, 1, 2, 3]), { mime: 'image/png' });
    expect(wrong.status).toBe(422);
    expect(await jsonOf(wrong)).toMatchObject({
      fields: { bytes: 'Isi berkas tidak sesuai jenis gambar' },
    });
    const empty = await upload(new Uint8Array(), { mime: 'image/png' });
    expect(empty.status).toBe(422);
  });

  test('lebar/tinggi tidak sah -> 422 pada field yang tepat', async () => {
    const zero = await upload(pngOf(8), { query: '?width=0&height=5' });
    expect(zero.status).toBe(422);
    expect(await jsonOf(zero)).toMatchObject({ fields: { width: expect.any(String) } });
    const text = await upload(pngOf(8), { query: '?width=5&height=abc' });
    expect(text.status).toBe(422);
    expect(await jsonOf(text)).toMatchObject({ fields: { height: expect.any(String) } });
    expect((await upload(pngOf(8), { query: '' })).status).toBe(422);
  });

  test('persis batas 10 MB diterima dan unduhan memberi byte yang sama (round trip)', async () => {
    const bytes = pngOf(MAX_IMAGE_BYTES);
    const response = await upload(bytes, { email: 'ubah@gmail.com' });
    expect(response.status).toBe(201);
    const id = (await jsonOf(response)).id as string;
    await attachToItem(id);
    const download = await rest.get(`/files/${id}`, { email: 'lihat@gmail.com' });
    expect(download.status).toBe(200);
    const received = new Uint8Array(await download.arrayBuffer());
    expect(received.length).toBe(MAX_IMAGE_BYTES);
    expect(Buffer.compare(Buffer.from(received), Buffer.from(bytes))).toBe(0);
  });

  test('1 byte di atas batas -> 413 problem+json berpesan ramah, tidak menyentuh Drive', async () => {
    const response = await upload(pngOf(MAX_IMAGE_BYTES + 1), { email: 'ubah@gmail.com' });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await jsonOf(response)).toMatchObject({
      code: 'VALIDATION',
      status: 413,
      detail: 'Ukuran gambar maksimal 10 MB',
    });
    expect(env.BRIDGE.state.files.size).toBe(0);
  });

  test('badan sangat besar tanpa content-length: pembacaan dihentikan setelah melewati batas (tidak dibaca seluruhnya)', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let pulled = 0;
    const total = 80; // 20 MB bila dibaca semuanya (batas 10 MB = 40 potongan)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const response = await rest.send('POST', '/files?width=1&height=1', {
      email: 'ubah@gmail.com',
      raw: stream as unknown as Uint8Array,
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(MAX_IMAGE_BYTES / chunk.length + 4);
  });

  test('content-length yang sudah melewati batas ditolak tanpa membaca badan', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const response = await rest.send('POST', '/files?width=1&height=1', {
      email: 'ubah@gmail.com',
      raw: stream as unknown as Uint8Array,
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 100) },
    });
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1);
  });
});

describe('GET /files/{id} (unduhan mengalir)', () => {
  async function uploaded(bytes = pngOf(200)) {
    const response = await upload(bytes, { email: 'ubah@gmail.com' });
    const id = (await jsonOf(response)).id as string;
    await attachToItem(id);
    return { id, bytes };
  }

  test('Content-Type dari record, ETag = id, Cache-Control immutable, byte identik', async () => {
    const { id, bytes } = await uploaded();
    const response = await rest.get(`/files/${id}`, { email: 'lihat@gmail.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('etag')).toBe(`"${id}"`);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('cache-control')).toContain('private');
    // penjaga: penghapusan middleware header keamanan tak boleh lolos diam-diam
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes))).toBe(0);
  });

  test('If-None-Match cocok -> 304 tanpa badan; pemegang qrcode view hanya boleh logo', async () => {
    const { id } = await uploaded();
    const cached = await rest.get(`/files/${id}`, {
      email: 'lihat@gmail.com',
      headers: { 'if-none-match': `"${id}"` },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    // berkas item bukan logo: pengguna QR saja tidak boleh melihatnya (disamarkan 404)
    expect((await rest.get(`/files/${id}`, { email: 'qrlihat@gmail.com' })).status).toBe(404);
  });

  test('izin diperiksa SEBELUM cache berkas: cache hangat tidak membuka berkas bagi yang tak berhak', async () => {
    const { id } = await uploaded();
    expect((await rest.get(`/files/${id}`, { email: 'lihat@gmail.com' })).status).toBe(200);
    expect((await rest.get(`/files/${id}`, { email: 'tanpa@gmail.com' })).status).toBe(403);
    expect(
      (
        await rest.get(`/files/${id}`, {
          email: 'tanpa@gmail.com',
          headers: { 'if-none-match': `"${id}"` },
        })
      ).status,
    ).toBe(403);
    expect((await rest.get(`/files/${id}`, { email: null })).status).toBe(401);
  });

  test('id tak dikenal -> 404 problem+json', async () => {
    const response = await rest.get('/files/tidak-ada', { email: 'lihat@gmail.com' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});
