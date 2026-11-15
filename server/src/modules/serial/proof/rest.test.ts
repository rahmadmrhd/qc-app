import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { planAttachFiles, uploadFile } from '@server/modules/files/service';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { SERIAL_USERS, seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { SERIAL_PROOF_LIMITS } from '@shared/serials';
import { claimDraftStmts, findProof, insertDraftStmt, setProofState } from './repo';
import { newStagedName } from './store';

// Rute foto bukti QC: unggah, ambil, buang, dan coba lagi (`serialProofs.*`) di atas kabel REST nyata.

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const WRITER = SERIAL_USERS.writer; // serial: edit di BU A
const VIEWER = SERIAL_USERS.viewer; // serial: view di BU A
const SERVICE = SERIAL_USERS.service; // serialservice: view di BU A
const BOTH = SERIAL_USERS.both; // serial: edit di BU A dan B
const NOBU = SERIAL_USERS.nobu;
const MANAGER = 'manajer@gmail.com'; // serial: manage di BU A
const NOW = '2026-11-20T03:00:00.000Z';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const be32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

/** PNG minimal (tanda tangan + IHDR berdimensi `width` x `height`), diisi sampai `size` byte. */
function png(width = 640, height = 480, size = 64): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ];
  const out = new Uint8Array(Math.max(size, head.length));
  for (let i = 0; i < out.length; i++) out[i] = (i * 31 + 7) % 256;
  out.set(head, 0);
  return out;
}

beforeEach(async () => {
  env = await createTestEnv();
  rest = restClient(env);
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-manage', name: 'Serial manage', permissions: { serial: 'manage' } });
  await seedUser(env, {
    id: 'u-mgr',
    email: MANAGER,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-manage'] }],
  });
  await seedSerial(env, { id: 'sn-a', serial: 'AAA1', buId: 'bu-a' });
  await seedSerial(env, { id: 'sn-b', serial: 'BBB1', buId: 'bu-b', itemId: 'i-b' });
  console.error = () => undefined;
});

afterEach(() => {
  console.error = realError;
});

async function call(email: string, id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, email, id, input)) as CallOut;
}

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

async function upload(email = WRITER, bytes = png(), mime = 'image/png'): Promise<Json> {
  const result = await call(email, 'serialProofs.upload', {
    mime,
    bytes,
    width: 640,
    height: 480,
  });
  expect(result.ok).toBe(true);
  return result.data;
}

/** Foto langsung ke basis data dan disk dalam keadaan tertentu (tanpa lewat Simpan). */
async function seedProof(
  id: string,
  options: {
    owner?: string;
    state?: 'draft' | 'queued' | 'processing' | 'done' | 'failed';
    serialId?: string;
    withFile?: boolean;
    now?: string;
  } = {},
): Promise<{ id: string; stagedName: string }> {
  const owner = options.owner ?? WRITER;
  const stagedName = newStagedName();
  if (options.withFile !== false) await env.PROOF_STORE?.write(stagedName, png(320, 200, 100));
  await insertDraftStmt(env.DB, {
    id,
    createdBy: owner,
    now: options.now ?? NOW,
    mime: 'image/png',
    width: 320,
    height: 200,
    size: 100,
    stagedName,
  }).run();
  if (options.state && options.state !== 'draft') {
    await env.DB.batch(
      claimDraftStmts(env.DB, {
        ids: [id],
        email: owner,
        serialId: options.serialId ?? 'sn-a',
        eventId: `ev-${id}`,
        snapshotJson: '{}',
        now: NOW,
      }),
    );
    if (options.state !== 'queued') {
      await setProofState(env.DB, id, {
        state: options.state,
        now: NOW,
        ...(options.state === 'failed' ? { lastError: 'Berkas rusak' } : {}),
      }).run();
    }
  }
  return { id, stagedName };
}

describe('serialProofs.upload', () => {
  test('sah: 201 + Location, baris draft, berkas sementara ada, dimensi dari header', async () => {
    const bytes = png(800, 600);
    const response = await rest.post('/serial-proofs?width=640&height=480', {
      email: WRITER,
      raw: bytes,
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(201);
    const dto = await jsonOf(response);
    expect(dto).toMatchObject({
      state: 'draft',
      mime: 'image/png',
      size: bytes.length,
      width: 800,
      height: 600,
      error: null,
    });
    expect(dto.filename).toBe(`bukti-${(dto.id as string).slice(0, 8)}.png`);
    expect(response.headers.get('location')).toBe(`/api/v1/serial-proofs/${dto.id as string}`);
    const row = await findProof(env.DB, dto.id as string);
    expect(row).toMatchObject({ state: 'draft', createdBy: WRITER, serialId: '', eventId: '' });
    expect(row?.stagedName).toMatch(/^[0-9a-f-]{36}$/);
    const staged = await env.PROOF_STORE?.read(row?.stagedName ?? '');
    expect(staged?.length).toBe(bytes.length);
    // Tidak ada berkas Drive dan tidak ada baris `files`: Drive baru dipakai job sesudah Simpan.
    expect(env.BRIDGE.state.files.size).toBe(0);
    expect((await rows('SELECT id FROM files WHERE owner_type = ?', 'serialproof')).length).toBe(0);
  });

  test('DTO tidak membocorkan nama berkas sementara atau snapshot', async () => {
    const dto = await upload();
    expect(Object.keys(dto).sort()).toEqual([
      'canManage',
      'error',
      'filename',
      'height',
      'id',
      'mime',
      'size',
      'state',
      'width',
    ]);
  });

  test('pembaca saja (serial: view) dan tanpa izin ditolak', async () => {
    for (const email of [VIEWER, SERVICE, NOBU]) {
      const result = await call(email, 'serialProofs.upload', {
        mime: 'image/png',
        bytes: png(),
        width: 640,
        height: 480,
      });
      expect([email, result.ok]).toEqual([email, false]);
      expect(result.error?.code).toBe('FORBIDDEN');
    }
  });

  test('tanda tangan palsu (bukan gambar sesuai MIME) = VALIDATION', async () => {
    const result = await call(WRITER, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: new TextEncoder().encode('%PDF-1.4 bukan gambar sama sekali, hanya teks biasa'),
      width: 640,
      height: 480,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect((await rows('SELECT id FROM serial_proof_photos')).length).toBe(0);
  });

  test('MIME bukan gambar (PDF) dan GIF ditolak', async () => {
    for (const mime of ['application/pdf', 'image/gif']) {
      const result = await call(WRITER, 'serialProofs.upload', {
        mime,
        bytes: png(),
        width: 640,
        height: 480,
      });
      expect([mime, result.ok]).toEqual([mime, false]);
    }
  });

  test('header gambar mengaku piksel di atas batas ditolak tanpa menyimpan apa pun', async () => {
    const huge = png(20000, 20000);
    const result = await call(WRITER, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: huge,
      width: 640,
      height: 480,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION');
    expect((await rows('SELECT id FROM serial_proof_photos')).length).toBe(0);
    expect(await env.PROOF_STORE?.totalBytes()).toBe(0);
  });

  test('badan lebih dari 10 MB ditolak 413', async () => {
    const response = await rest.post('/serial-proofs?width=640&height=480', {
      email: WRITER,
      raw: png(640, 480, MAX_IMAGE_BYTES + 1),
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(413);
  });

  test('kuota foto draft per pengguna: yang ke-151 ditolak, pengguna lain tidak terpengaruh', async () => {
    for (let i = 0; i < SERIAL_PROOF_LIMITS.draftPerUserMax; i++) {
      await seedProof(`p-${i}`, { withFile: false });
    }
    const result = await call(WRITER, 'serialProofs.upload', {
      mime: 'image/png',
      bytes: png(),
      width: 640,
      height: 480,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFLICT');
    expect(
      (await rows('SELECT id FROM serial_proof_photos WHERE created_by = ?', WRITER)).length,
    ).toBe(SERIAL_PROOF_LIMITS.draftPerUserMax);
    expect(
      (
        await call(BOTH, 'serialProofs.upload', {
          mime: 'image/png',
          bytes: png(),
          width: 640,
          height: 480,
        })
      ).ok,
    ).toBe(true);
  });

  test('foto yang sudah disimpan (bukan draft) tidak dihitung dalam kuota', async () => {
    for (let i = 0; i < SERIAL_PROOF_LIMITS.draftPerUserMax; i++) {
      await seedProof(`q-${i}`, { withFile: false, state: i === 0 ? 'queued' : 'draft' });
    }
    expect((await upload()).state).toBe('draft');
  });

  test('disk penuh: batas total berkas sementara menolak unggahan baru (503) tanpa menyisakan berkas', async () => {
    env.PROOF_STAGING_MAX_BYTES = 1000;
    await env.PROOF_STORE?.write(newStagedName(), new Uint8Array(900));
    const response = await rest.post('/serial-proofs?width=640&height=480', {
      email: WRITER,
      raw: png(640, 480, 200),
      headers: { 'content-type': 'image/png' },
    });
    expect(response.status).toBe(503);
    expect(await env.PROOF_STORE?.totalBytes()).toBe(900);
    expect((await rows('SELECT id FROM serial_proof_photos')).length).toBe(0);
  });
});

describe('serialProofs.get', () => {
  test('draft: pengunggah menerima byte asli, tanpa ETag dan dengan no-cache', async () => {
    const dto = await upload();
    const response = await rest.get(`/serial-proofs/${dto.id as string}`, { email: WRITER });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('content-disposition')).toContain(
      `bukti-${(dto.id as string).slice(0, 8)}.png`,
    );
    expect((await response.arrayBuffer()).byteLength).toBe(png().length);
  });

  test('draft milik orang lain = 404 (juga bagi pembaca dan pengguna dua BU)', async () => {
    const dto = await upload(WRITER);
    for (const email of [BOTH, VIEWER, SERVICE, MANAGER]) {
      const response = await rest.get(`/serial-proofs/${dto.id as string}`, { email });
      expect([email, response.status]).toEqual([email, 404]);
    }
  });

  test('id tak dikenal = 404; tanpa izin serial = 403', async () => {
    expect((await rest.get('/serial-proofs/tidak-ada', { email: WRITER })).status).toBe(404);
    const dto = await upload();
    expect((await rest.get(`/serial-proofs/${dto.id as string}`, { email: NOBU })).status).toBe(
      403,
    );
  });

  test('antre/proses/gagal: berkas sementara terbaca pembaca BU serial (serial maupun serialservice)', async () => {
    for (const state of ['queued', 'processing', 'failed'] as const) {
      await seedProof(`p-${state}`, { state });
      for (const email of [WRITER, VIEWER, SERVICE, BOTH]) {
        const response = await rest.get(`/serial-proofs/p-${state}`, { email });
        expect([state, email, response.status]).toEqual([state, email, 200]);
      }
    }
  });

  test('milik BU lain = 404 bagi yang tak punya BU itu, terbaca bagi yang punya', async () => {
    await seedProof('p-b', { state: 'queued', serialId: 'sn-b', owner: BOTH });
    for (const email of [WRITER, VIEWER, SERVICE, MANAGER]) {
      const response = await rest.get('/serial-proofs/p-b', { email });
      expect([email, response.status]).toEqual([email, 404]);
    }
    expect((await rest.get('/serial-proofs/p-b', { email: BOTH })).status).toBe(200);
  });

  test('berkas sementara hilang = 404 jelas', async () => {
    await seedProof('p-x', { state: 'queued', withFile: false });
    const result = await call(WRITER, 'serialProofs.get', { id: 'p-x' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  test('selesai: dilayani dari Drive lewat baris files serialproof; BU lain = 404', async () => {
    await seedProof('p-done', { state: 'done' });
    // Berkas Drive nyata (jembatan palsu) dijadikan milik serial sn-a dan dipautkan ke foto.
    const file = await uploadFile(
      env,
      { mime: 'image/webp', bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3]), width: 1, height: 1 },
      { email: WRITER } as never,
    );
    await env.DB.prepare(
      "UPDATE files SET owner_type = 'serialproof', owner_id = 'sn-a' WHERE id = ?",
    )
      .bind(file.id)
      .run();
    await env.DB.prepare(
      "UPDATE serial_proof_photos SET file_id = ?, mime = 'image/webp' WHERE id = ?",
    )
      .bind(file.id, 'p-done')
      .run();
    const response = await rest.get('/serial-proofs/p-done', { email: VIEWER });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([82, 73, 70, 70, 1, 2, 3]);
    // Serial di BU lain: pembaca BU A tidak membaca lewat files.get maupun serialProofs.get.
    await env.DB.prepare("UPDATE files SET owner_id = 'sn-b' WHERE id = ?").bind(file.id).run();
    expect((await rest.get('/serial-proofs/p-done', { email: VIEWER })).status).toBe(404);
    const viaFiles = await call(WRITER, 'files.get', { id: file.id });
    expect(viaFiles.ok).toBe(false);
    expect(viaFiles.error?.code).toBe('NOT_FOUND');
  });

  test('foto selesai tanpa baris files = 404', async () => {
    await seedProof('p-done2', { state: 'done' });
    expect((await rest.get('/serial-proofs/p-done2', { email: WRITER })).status).toBe(404);
  });
});

describe('serialProofs.remove', () => {
  test('draft milik sendiri: baris dan berkas sementara hilang', async () => {
    const dto = await upload();
    const row = await findProof(env.DB, dto.id as string);
    const result = await call(WRITER, 'serialProofs.remove', { id: dto.id });
    expect(result).toMatchObject({ ok: true, data: { id: dto.id } });
    expect(await findProof(env.DB, dto.id as string)).toBeNull();
    expect(await env.PROOF_STORE?.read(row?.stagedName ?? '')).toBeNull();
  });

  test('draft milik orang lain = NOT_FOUND dan tetap ada', async () => {
    const dto = await upload(WRITER);
    const result = await call(BOTH, 'serialProofs.remove', { id: dto.id });
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(await findProof(env.DB, dto.id as string)).not.toBeNull();
  });

  test('foto yang bukan draft/gagal ditolak (queued, processing, done)', async () => {
    for (const state of ['queued', 'processing', 'done'] as const) {
      await seedProof(`p-${state}`, { state });
      const result = await call(WRITER, 'serialProofs.remove', { id: `p-${state}` });
      expect([state, result.error?.code]).toEqual([state, 'CONFLICT']);
      expect(await findProof(env.DB, `p-${state}`)).not.toBeNull();
    }
  });

  test('gagal: pelaku boleh membuang dan tercatat di audit; berkas sementara ikut hilang', async () => {
    const { stagedName } = await seedProof('p-f', { state: 'failed' });
    const result = await call(WRITER, 'serialProofs.remove', { id: 'p-f' });
    expect(result.ok).toBe(true);
    expect(await findProof(env.DB, 'p-f')).toBeNull();
    expect(await env.PROOF_STORE?.read(stagedName)).toBeNull();
    const audit = await rows(
      "SELECT actor, action, target FROM audit_log WHERE action = 'serial.proof_remove'",
    );
    expect(audit).toEqual([
      { actor: WRITER, action: 'serial.proof_remove', target: 'serial:sn-a' },
    ]);
  });

  test('gagal: pencatat lain tanpa manage = NOT_FOUND; pemegang serial: manage boleh', async () => {
    await seedProof('p-f', { state: 'failed' });
    const other = await call(BOTH, 'serialProofs.remove', { id: 'p-f' });
    expect(other.error?.code).toBe('NOT_FOUND');
    expect(await findProof(env.DB, 'p-f')).not.toBeNull();
    expect((await call(MANAGER, 'serialProofs.remove', { id: 'p-f' })).ok).toBe(true);
  });

  test('gagal milik BU lain: manage di BU A tidak melihatnya', async () => {
    await seedProof('p-fb', { state: 'failed', serialId: 'sn-b', owner: BOTH });
    const result = await call(MANAGER, 'serialProofs.remove', { id: 'p-fb' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  test('pembaca saja tidak boleh membuang', async () => {
    const dto = await upload();
    expect((await call(VIEWER, 'serialProofs.remove', { id: dto.id })).error?.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('serialProofs.retry', () => {
  test('hanya foto gagal: draft, queued, processing, dan done ditolak', async () => {
    await seedProof('p-draft');
    for (const state of ['queued', 'processing', 'done'] as const)
      await seedProof(`p-${state}`, { state });
    for (const id of ['p-draft', 'p-queued', 'p-processing', 'p-done']) {
      const result = await call(WRITER, 'serialProofs.retry', { id });
      expect([id, result.error?.code]).toEqual([id, 'CONFLICT']);
    }
    expect(await rows("SELECT id FROM jobs WHERE kind = 'serial_proof'")).toEqual([]);
  });

  test('gagal dengan berkas sementara: kembali queued dan satu job serial_proof dipasang', async () => {
    await seedProof('p-f', { state: 'failed' });
    const result = await call(WRITER, 'serialProofs.retry', { id: 'p-f' });
    expect(result).toMatchObject({ ok: true, data: { id: 'p-f', state: 'queued', error: null } });
    const jobs = await rows("SELECT status, input FROM jobs WHERE kind = 'serial_proof'");
    expect(jobs).toEqual([{ status: 'queued', input: JSON.stringify({ photoId: 'p-f' }) }]);
    expect(await findProof(env.DB, 'p-f')).toMatchObject({ state: 'queued', lastError: '' });
  });

  test('gagal tanpa berkas sementara: ditolak dengan petunjuk membuang', async () => {
    await seedProof('p-f', { state: 'failed', withFile: false });
    const result = await call(WRITER, 'serialProofs.retry', { id: 'p-f' });
    expect(result.error?.code).toBe('CONFLICT');
    expect(result.error?.message).toContain('Buang');
    expect(await findProof(env.DB, 'p-f')).toMatchObject({ state: 'failed' });
  });

  test('pencatat lain tanpa manage dan BU lain = NOT_FOUND; manage boleh', async () => {
    await seedProof('p-f', { state: 'failed' });
    expect((await call(BOTH, 'serialProofs.retry', { id: 'p-f' })).error?.code).toBe('NOT_FOUND');
    await seedProof('p-fb', { state: 'failed', serialId: 'sn-b', owner: BOTH });
    expect((await call(MANAGER, 'serialProofs.retry', { id: 'p-fb' })).error?.code).toBe(
      'NOT_FOUND',
    );
    expect((await call(MANAGER, 'serialProofs.retry', { id: 'p-f' })).ok).toBe(true);
  });
});

describe('pemisahan dari pustaka gambar stiker dan jalur berkas lain', () => {
  test('stickerGuides.list tidak memuat foto bukti dan sticker_guide_images tidak bertambah', async () => {
    const before = await call('admin@gmail.com', 'stickerGuides.list', {});
    expect(before.ok).toBe(true);
    const ids = (before.data.items as { id: string }[]).map((item) => item.id);
    await seedProof('p-done', { state: 'done' });
    const file = await uploadFile(
      env,
      { mime: 'image/webp', bytes: new Uint8Array([82, 73, 70, 70]), width: 1, height: 1 },
      { email: WRITER } as never,
    );
    await env.DB.prepare(
      "UPDATE files SET owner_type = 'serialproof', owner_id = 'sn-a' WHERE id = ?",
    )
      .bind(file.id)
      .run();
    await upload();
    const after = await call('admin@gmail.com', 'stickerGuides.list', {});
    expect((after.data.items as { id: string }[]).map((item) => item.id)).toEqual(ids);
    expect((await rows('SELECT id FROM sticker_guide_images')).map((r) => r.id)).toEqual(['g1']);
  });

  test('planAttachFiles menolak berkas serialproof dari jalur item, QR, stiker, Postel, dan serial', async () => {
    const file = await uploadFile(env, { mime: 'image/png', bytes: png(), width: 1, height: 1 }, {
      email: WRITER,
    } as never);
    await env.DB.prepare(
      "UPDATE files SET owner_type = 'serialproof', owner_id = 'sn-a' WHERE id = ?",
    )
      .bind(file.id)
      .run();
    for (const [ownerType, ownerId] of [
      ['item', 'i-a1'],
      ['qrlogo', 'shared'],
      ['sticker', 's1'],
      ['stickerguide', 'g9'],
      ['postel', 'p1'],
      ['serial', 'sn-a'],
      ['serialproof', 'sn-a'],
    ] as const) {
      const error = await planAttachFiles(
        env,
        [file.id],
        ownerType,
        ownerId,
        undefined,
        WRITER,
      ).then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      );
      expect([ownerType, error?.code]).toEqual([ownerType, 'VALIDATION']);
      expect(error?.message).toBe('Ada berkas yang tidak dikenal');
    }
  });

  test('gambar pustaka stiker tidak dapat dipasang sebagai foto bukti (id pustaka bukan foto)', async () => {
    const result = await call(WRITER, 'serialProofs.get', { id: 'g1' });
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(await call(WRITER, 'serialProofs.remove', { id: 'g1' })).toMatchObject({
      ok: false,
    });
    expect((await call(WRITER, 'serialProofs.retry', { id: 'g1' })).ok).toBe(false);
  });
});
