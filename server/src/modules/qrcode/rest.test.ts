import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { qrPdfDocumentId, seedQrEnv } from '@server-test/qrcode-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';

// Kabel REST untuk rute QR bukan-biner (list, get, save, delete, getDefaults, savePreset, deletePreset,
// saveLogoLibrary, cloneFromDrive). Biner (uploadPdf, export, file) dipindah di T21.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  rest = restClient(env);
  await seedQrEnv(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function design(extra: Record<string, unknown> = {}) {
  return {
    title: 'Panduan',
    linkSource: 'pdf',
    link: '',
    documentId: await qrPdfDocumentId(env),
    subtitle: 'Sub',
    footer: 'foot',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    ...extra,
  };
}

const presetBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Standar',
  title: 'PT Contoh',
  subtitle: '',
  footer: 'www.contoh.com',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu-a',
  namePlacement: 'title',
  ...extra,
});

describe('desain QR', () => {
  test('POST buat 201 + Location + ETag; GET daftar dan tunggal; edit menyimpan, view tidak, tanpa modul tidak', async () => {
    const created = await rest.post('/qrcodes', {
      email: 'qredit@gmail.com',
      body: await design(),
    });
    expect(created.status).toBe(201);
    const qr = await jsonOf(created);
    const id = qr.id as string;
    expect(created.headers.get('location')).toBe(`/api/v1/qrcodes/${id}`);
    expect(created.headers.get('etag')).toBe(`"${qr.updatedAt as string}"`);
    expect(
      (await rest.post('/qrcodes', { email: 'qrview@gmail.com', body: await design() })).status,
    ).toBe(403);
    expect(
      (await rest.post('/qrcodes', { email: 'noqr@gmail.com', body: await design() })).status,
    ).toBe(403);
    const list = await rest.get('/qrcodes', { email: 'qrview@gmail.com' });
    expect(((await list.json()) as unknown[]).length).toBe(1);
    const one = await rest.get(`/qrcodes/${id}`, { email: 'qrview@gmail.com' });
    expect(one.status).toBe(200);
    expect(one.headers.get('etag')).toBe(`"${qr.updatedAt as string}"`);
    expect(
      (
        await rest.get(`/qrcodes/${id}`, {
          email: 'qrview@gmail.com',
          headers: { 'if-none-match': one.headers.get('etag') as string },
        })
      ).status,
    ).toBe(304);
    expect((await rest.get('/qrcodes', { email: 'noqr@gmail.com' })).status).toBe(403);
  });

  test('PUT dengan If-Match = expectedUpdatedAt; basi -> 412; PUT tanpa If-Match pada desain lama ditolak validator (wajib)', async () => {
    const qr = await jsonOf(await rest.post('/qrcodes', { body: await design() }));
    const id = qr.id as string;
    env.clock.advance(2000);
    const ok = await rest.put(`/qrcodes/${id}`, {
      headers: { 'if-match': `"${qr.updatedAt as string}"` },
      body: await design({ title: 'Baru', documentId: qr.documentId }),
    });
    expect(ok.status).toBe(200);
    expect(await jsonOf(ok)).toMatchObject({ title: 'Baru' });
    env.clock.advance(2000);
    const stale = await rest.put(`/qrcodes/${id}`, {
      headers: { 'if-match': `"${qr.updatedAt as string}"` },
      body: await design({ title: 'Basi', documentId: qr.documentId }),
    });
    expect(stale.status).toBe(412);
    expect(await jsonOf(stale)).toMatchObject({ code: 'CONFLICT' });
    const missing = await rest.put(`/qrcodes/${id}`, {
      body: await design({ title: 'Tanpa pembanding', documentId: qr.documentId }),
    });
    expect(missing.status).toBe(422);
  });

  test('DELETE mengembalikan { id } (200); desain hilang; tanpa izin edit 403; tidak ada 404', async () => {
    const qr = await jsonOf(await rest.post('/qrcodes', { body: await design() }));
    const id = qr.id as string;
    expect((await rest.del(`/qrcodes/${id}`, { email: 'qrview@gmail.com' })).status).toBe(403);
    const removed = await rest.del(`/qrcodes/${id}`, { email: 'qrmanage@gmail.com' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id });
    expect((await rest.get(`/qrcodes/${id}`)).status).toBe(404);
    expect((await rest.del(`/qrcodes/${id}`)).status).toBe(404);
  });
});

describe('default QR (preset dan pustaka logo)', () => {
  test('GET /qrcode-defaults: view boleh, tanpa modul 403', async () => {
    const ok = await rest.get('/qrcode-defaults', { email: 'qrview@gmail.com' });
    expect(ok.status).toBe(200);
    expect(await jsonOf(ok)).toMatchObject({ presets: [], logoFileIds: [], logoUpdatedAt: '' });
    expect((await rest.get('/qrcode-defaults', { email: 'noqr@gmail.com' })).status).toBe(403);
  });

  test('preset: hanya manage; POST 201; nama kembar 422; PUT dengan If-Match; basi 412; DELETE { id }', async () => {
    expect(
      (await rest.post('/qrcode-presets', { email: 'qredit@gmail.com', body: presetBody() }))
        .status,
    ).toBe(403);
    const created = await rest.post('/qrcode-presets', {
      email: 'qrmanage@gmail.com',
      body: presetBody(),
    });
    expect(created.status).toBe(201);
    const preset = await jsonOf(created);
    const id = preset.id as string;
    expect(created.headers.get('location')).toBe(`/api/v1/qrcode-presets/${id}`);
    const duplicate = await rest.post('/qrcode-presets', {
      email: 'qrmanage@gmail.com',
      body: presetBody({ name: 'standar' }),
    });
    expect(duplicate.status).toBe(422);
    expect(await jsonOf(duplicate)).toMatchObject({ fields: { name: expect.any(String) } });
    env.clock.advance(2000);
    const ifMatch = { 'if-match': `"${preset.updatedAt as string}"` };
    const updated = await rest.put(`/qrcode-presets/${id}`, {
      email: 'qrmanage@gmail.com',
      headers: ifMatch,
      body: presetBody({ title: 'Diubah' }),
    });
    expect(updated.status).toBe(200);
    expect(updated.headers.get('etag')).toBe(`"${(await jsonOf(updated)).updatedAt as string}"`);
    env.clock.advance(2000);
    const stale = await rest.put(`/qrcode-presets/${id}`, {
      email: 'qrmanage@gmail.com',
      headers: ifMatch,
      body: presetBody({ title: 'Basi' }),
    });
    expect(stale.status).toBe(412);
    expect(await jsonOf(stale)).toMatchObject({ code: 'CONFLICT' });
    const removed = await rest.del(`/qrcode-presets/${id}`, { email: 'qrmanage@gmail.com' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id });
    expect((await rest.del(`/qrcode-presets/${id}`, { email: 'qredit@gmail.com' })).status).toBe(
      403,
    );
  });

  test('pustaka logo: PUT /qrcode-defaults/logos butuh manage; tanpa pustaka sebelumnya tidak perlu If-Match; ETag = logoUpdatedAt', async () => {
    const denied = await rest.put('/qrcode-defaults/logos', {
      email: 'qredit@gmail.com',
      body: { logoFileIds: [] },
    });
    expect(denied.status).toBe(403);
    const saved = await rest.put('/qrcode-defaults/logos', {
      email: 'qrmanage@gmail.com',
      body: { logoFileIds: [] },
    });
    expect(saved.status).toBe(200);
    const library = await jsonOf(saved);
    expect(saved.headers.get('etag')).toBe(`"${library.logoUpdatedAt as string}"`);
    env.clock.advance(2000);
    const stale = await rest.put('/qrcode-defaults/logos', {
      email: 'qrmanage@gmail.com',
      headers: { 'if-match': '"2020-01-01T00:00:00.000Z"' },
      body: { logoFileIds: [] },
    });
    expect(stale.status).toBe(412);
  });
});

test('POST /qrcode-documents/clone: bukan link/ID Drive ditolak 422; tanpa izin edit 403', async () => {
  const bad = await rest.post('/qrcode-documents/clone', {
    email: 'qredit@gmail.com',
    body: { source: 'bukan drive' },
  });
  expect(bad.status).toBe(422);
  const denied = await rest.post('/qrcode-documents/clone', {
    email: 'qrview@gmail.com',
    body: { source: 'x' },
  });
  expect(denied.status).toBe(403);
});
