import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { publishClBundle, validatePublishClBundle } from './bundle-service';
import { saveClFile } from './files-service';
import { saveClFirmware, validateSaveClFirmware } from './firmware-service';
import { sha256Hex } from './hash';
import {
  finishClUpload,
  putClUploadChunk,
  startClUpload,
  validateChunkClUpload,
  validateFinishClUpload,
  validateStartClUpload,
} from './upload-service';
import { validateSaveClFile } from './validate';

const TOKEN = 't'.repeat(40);
const BASE = 'https://qc.test/api/desktop/countrylock';
const ACTOR = { email: 'admin@gmail.com' };
const SCRIPT = ':put {ipTarget}\n/file print file=/temp/boot.cfg';
const BINARY = Uint8Array.from({ length: 10 }, (_, index) => index * 7 + 3);

let env: TestEnv;

const get = (path: string, headers: Record<string, string> = {}, e: object = env) =>
  Promise.resolve(app.request(`${BASE}${path}`, { headers }, e));
const auth = { authorization: `Bearer ${TOKEN}` };

function settingsJson(): string {
  const mode = (ip: string) => ({
    ip,
    ipServer: '10.0.0.1',
    connectVia: 'Target',
    interfaceBridge: 'bridge1',
  });
  const brand = (label: string) => ({
    label,
    username: 'admin',
    password: '',
    web: 'http://{ip}',
    modes: { single: mode('192.168.1.20'), multi: mode('') },
  });
  return JSON.stringify({
    schema: 1,
    router: { ip: '10.0.0.1', username: 'admin', password: 'x', interfaceBridge: 'bridge1' },
    network: { computerIp: '10.0.0.5', prefixLength: 24 },
    brands: { mikrotik: brand('Mikrotik'), ubiquiti: brand('Ubiquiti') },
  });
}

async function readBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** Bundel 1: settings.json, skrip teks, biner router (diunggah bertahap ke "Drive" palsu), satu firmware. */
async function publishBundle(): Promise<{ scriptSha: string; binarySha: string }> {
  await saveClFile(
    env,
    validateSaveClFile({ path: 'settings.json', role: 'settings', text: settingsJson() }),
    ACTOR,
  );
  await saveClFile(
    env,
    validateSaveClFile({ path: 'mikrotik/AC.rsc', role: 'script', text: SCRIPT }),
    ACTOR,
  );
  const binarySha = await sha256Hex(BINARY);
  const session = await startClUpload(
    env,
    validateStartClUpload({
      path: 'os/boot.cfg',
      role: 'router',
      size: BINARY.length,
      sha256: binarySha,
    }),
    ACTOR,
    { chunkBytes: 4 },
  );
  for (let index = 0; index * 4 < BINARY.length; index++) {
    await putClUploadChunk(
      env,
      validateChunkClUpload({
        id: session.uploadId,
        idx: String(index),
        bytes: BINARY.slice(index * 4, index * 4 + 4),
      }),
      ACTOR,
    );
  }
  await finishClUpload(env, validateFinishClUpload({ id: session.uploadId }), ACTOR);
  await saveClFirmware(
    env,
    validateSaveClFirmware({
      brand: 'mikrotik',
      code: 'AC',
      label: 'AC',
      scriptPath: 'mikrotik/AC.rsc',
      parallel: false,
      sort: 10,
    }),
    ACTOR,
  );
  await publishClBundle(env, validatePublishClBundle({ note: 'awal' }), ACTOR);
  return { scriptSha: await sha256Hex(SCRIPT), binarySha };
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-28T00:00:00.000Z'));
  env.DESKTOP_CATALOG_TOKEN = TOKEN;
});

describe('manifest publik', () => {
  test('belum ada bundel: 404 problem+json; ada bundel: manifest terbaru dengan ETag dan no-store', async () => {
    const empty = await get('/manifest', auth);
    expect(empty.status).toBe(404);
    expect(empty.headers.get('content-type')).toContain('application/problem+json');

    await publishBundle();
    const res = await get('/manifest', auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    const manifest = (await res.json()) as {
      number: number;
      computerHash: string;
      routerHash: string;
      files: { path: string; sha256: string; size: number }[];
      firmwares: { code: string }[];
    };
    expect(manifest.number).toBe(1);
    expect(manifest.computerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files.map((file) => file.path)).toEqual([
      'mikrotik/AC.rsc',
      'os/boot.cfg',
      'settings.json',
    ]);
    expect(manifest.firmwares.map((firmware) => firmware.code)).toEqual(['AC']);
    expect(res.headers.get('etag')).toBe(`"1-${manifest.computerHash.slice(0, 16)}"`);
  });

  test('If-None-Match yang sama = 304', async () => {
    await publishBundle();
    const first = await get('/manifest', auth);
    const etag = first.headers.get('etag') as string;
    const cached = await get('/manifest', { ...auth, 'if-none-match': etag });
    expect(cached.status).toBe(304);
    expect((await get('/manifest', { ...auth, 'if-none-match': '"lain"' })).status).toBe(200);
  });
});

describe('akses: token', () => {
  test('tanpa token terkonfigurasi atau token salah/hilang/berformat lain: 404 identik', async () => {
    await publishBundle();
    env.DESKTOP_CATALOG_TOKEN = undefined;
    expect((await get('/manifest', auth)).status).toBe(404);
    env.DESKTOP_CATALOG_TOKEN = TOKEN;
    const bodies = new Set<string>();
    for (const headers of [
      {} as Record<string, string>,
      { authorization: 'Bearer salah' },
      { authorization: `Basic ${TOKEN}` },
      { authorization: TOKEN },
      { authorization: `Bearer ${TOKEN}x` },
    ]) {
      for (const path of ['/manifest', `/files/${'a'.repeat(64)}`]) {
        const res = await get(path, headers);
        expect(res.status).toBe(404);
        const body = (await res.json()) as { requestId?: string; [k: string]: unknown };
        body.requestId = undefined;
        bodies.add(JSON.stringify(body));
      }
    }
    expect(bodies.size).toBe(1);
  });

  test('kegagalan berulang dari IP yang sama dibatasi (seperti katalog); permintaan sah tetap dilayani', async () => {
    await publishBundle();
    const withIp = { ...env, clientIp: '203.0.113.9' };
    for (let i = 0; i < 20; i++) expect((await get('/manifest', {}, withIp)).status).toBe(404);
    expect((await get('/manifest', {}, withIp)).status).toBe(429);
    expect((await get('/manifest', auth, withIp)).status).toBe(200);
    expect((await get('/manifest', {}, { ...env, clientIp: '203.0.113.10' })).status).toBe(404);
  });
});

describe('berkas menurut sha256', () => {
  test('berkas teks dan biner terunduh persis, dengan header cache immutable dan Accept-Ranges', async () => {
    const { scriptSha, binarySha } = await publishBundle();
    const text = await get(`/files/${scriptSha}`, auth);
    expect(text.status).toBe(200);
    expect(text.headers.get('content-type')).toBe('application/octet-stream');
    expect(text.headers.get('accept-ranges')).toBe('bytes');
    expect(text.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new TextDecoder().decode(await readBytes(text))).toBe(SCRIPT);

    const binary = await get(`/files/${binarySha}`, auth);
    expect(binary.status).toBe(200);
    expect(binary.headers.get('content-length')).toBe(String(BINARY.length));
    expect(await readBytes(binary)).toEqual(BINARY);
  });

  test('Range: 206 + Content-Range untuk teks dan biner; di luar ukuran atau tak sah = 416', async () => {
    const { scriptSha, binarySha } = await publishBundle();
    const textPart = await get(`/files/${scriptSha}`, { ...auth, range: 'bytes=0-1' });
    expect(textPart.status).toBe(206);
    expect(textPart.headers.get('content-range')).toBe(
      `bytes 0-1/${new TextEncoder().encode(SCRIPT).length}`,
    );
    expect(new TextDecoder().decode(await readBytes(textPart))).toBe(SCRIPT.slice(0, 2));

    const part = await get(`/files/${binarySha}`, { ...auth, range: 'bytes=0-1' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-1/${BINARY.length}`);
    expect(part.headers.get('content-length')).toBe('2');
    expect(await readBytes(part)).toEqual(BINARY.slice(0, 2));

    const tail = await get(`/files/${binarySha}`, { ...auth, range: 'bytes=8-' });
    expect(tail.status).toBe(206);
    expect(await readBytes(tail)).toEqual(BINARY.slice(8));
    const clamped = await get(`/files/${binarySha}`, { ...auth, range: 'bytes=8-999' });
    expect(clamped.headers.get('content-range')).toBe(`bytes 8-9/${BINARY.length}`);

    for (const range of [
      'bytes=999999-',
      'bytes=5-2',
      'bytes=-3',
      'bytes=0-1,4-5',
      'items=0-1',
      'bytes=a-b',
    ]) {
      const bad = await get(`/files/${binarySha}`, { ...auth, range });
      expect(bad.status, range).toBe(416);
      expect(bad.headers.get('content-range')).toBe(`bytes */${BINARY.length}`);
      expect(bad.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('sha256 tak dirujuk bundel, bukan 64 heksa, atau huruf besar: 404 yang sama', async () => {
    await publishBundle();
    const unknown = await get(`/files/${'a'.repeat(64)}`, auth);
    expect(unknown.status).toBe(404);
    const bodies = new Set<string>();
    for (const sha of ['a'.repeat(64), 'zz', 'A'.repeat(64), 'a'.repeat(63)]) {
      const res = await get(`/files/${sha}`, auth);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { requestId?: string; [k: string]: unknown };
      body.requestId = undefined;
      bodies.add(JSON.stringify(body));
    }
    expect(bodies.size).toBe(1);
  });

  test('berkas dari bundel lama tetap terunduh walau draf sudah berubah', async () => {
    const { scriptSha } = await publishBundle();
    await saveClFile(
      env,
      validateSaveClFile({
        path: 'mikrotik/AC.rsc',
        role: 'script',
        text: `${SCRIPT}\n:put baru`,
        baseSeq: 1,
      }),
      ACTOR,
    );
    await publishClBundle(env, validatePublishClBundle({ note: 'dua' }), ACTOR);
    const old = await get(`/files/${scriptSha}`, auth);
    expect(old.status).toBe(200);
    expect(new TextDecoder().decode(await readBytes(old))).toBe(SCRIPT);
  });
});
