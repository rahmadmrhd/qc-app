import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { insertFileStmt } from '@server/modules/files/repo';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { MAX_IMAGE_BYTES } from '@shared/files';

// Lampiran Postel: unggah (`postelFiles.upload`), unduh (`postelFiles.get`) dan pemasangan lewat `postels.save`.

setDefaultTimeout(30_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const ADMIN = 'admin@gmail.com';
const EDITOR = 'stickeredit@gmail.com';
const EDITOR2 = 'stickeredit2@gmail.com';
const VIEWER = 'stickerview@gmail.com';
const NOSTICKER = 'nosticker@gmail.com';
const ITEMVIEW = 'itemview@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

function pad(bytes: number[], size: number): Uint8Array {
  const out = new Uint8Array(Math.max(size, bytes.length));
  for (let i = 0; i < out.length; i++) out[i] = (i * 31 + 7) % 256;
  out.set(bytes, 0);
  return out;
}

const be32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

/** PNG minimal dengan IHDR berdimensi `width` x `height`. */
function png(width = 640, height = 480, size = 64): Uint8Array {
  return pad(
    [
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
    ],
    size,
  );
}

/** JPEG minimal dengan segmen SOF0 berdimensi `width` x `height`. */
function jpeg(width = 320, height = 200): Uint8Array {
  return pad(
    [
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      3,
    ],
    64,
  );
}

/** WebP VP8X minimal dengan dimensi `width` x `height`. */
function webp(width = 100, height = 50): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return pad(
    [
      ...ascii('RIFF'),
      ...[0, 0, 0, 0],
      ...ascii('WEBP'),
      ...ascii('VP8X'),
      ...[10, 0, 0, 0],
      ...[0, 0, 0, 0],
      w & 255,
      (w >> 8) & 255,
      (w >> 16) & 255,
      h & 255,
      (h >> 8) & 255,
      (h >> 16) & 255,
    ],
    40,
  );
}

function pdf(size = 128): Uint8Array {
  return pad(ascii('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'), size);
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-umum', code: 'UMUM' });
  await seedRole(env, { id: 'r-sv', name: 'Sticker view', permissions: { sticker: 'view' } });
  await seedRole(env, {
    id: 'r-se',
    name: 'Sticker edit',
    permissions: { sticker: 'edit', item: 'view' },
  });
  await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-sv', email: VIEWER, roleIds: ['r-sv'] });
  for (const [id, email] of [
    ['u-se', EDITOR],
    ['u-se2', EDITOR2],
  ] as const) {
    await seedUser(env, {
      id,
      email,
      assignments: [{ locationId: null, roleIds: ['r-se'] }],
      buAssignments: [{ buId: 'bu-umum', roleIds: ['r-se'] }],
    });
  }
  await seedUser(env, { id: 'u-ns', email: NOSTICKER });
  await seedUser(env, { id: 'u-iv', email: ITEMVIEW, roleIds: ['r-item'] });
  await seedBrand(env, 'PBE');
  for (const id of ['i1', 'i2', 'i3', 'i4']) {
    await seedItem(env, { id, brand: 'PBE', model: `M-${id}` });
  }
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

/** Unggah lewat kabel REST nyata; mengembalikan DTO lampiran. */
async function upload(bytes: Uint8Array, mime: string, email = EDITOR): Promise<Json> {
  const result = await call(email, 'postelFiles.upload', { mime, bytes });
  expect(result.ok).toBe(true);
  return result.data;
}

const uploadRaw = (bytes: Uint8Array, mime: string, email: string | null = EDITOR) =>
  rest.post('/postel-files', { email, raw: bytes, headers: { 'content-type': mime } });

function saveBody(attachmentIds: string[], extra: Record<string, unknown> = {}) {
  return {
    note: '',
    itemIds: ['i1'],
    numbers: [
      { number: `SN-${crypto.randomUUID().slice(0, 8)}`, expiresOn: '2027-03-01', link: '' },
    ],
    attachmentIds,
    ...extra,
  };
}

async function createPostel(
  attachmentIds: string[],
  extra: Record<string, unknown> = {},
  email = EDITOR,
) {
  const result = await call(email, 'postels.save', saveBody(attachmentIds, extra));
  expect(result.ok).toBe(true);
  env.clock.advance(1000);
  return result.data as Json;
}

describe('postelFiles.upload', () => {
  test('PNG: 201 + Location, dimensi tidak disimpan; berkas belum bertuan dan tidak dibagikan di Drive', async () => {
    const bytes = png(640, 480);
    const response = await uploadRaw(bytes, 'image/png');
    expect(response.status).toBe(201);
    const dto = await jsonOf(response);
    expect(dto).toMatchObject({ mime: 'image/png', size: bytes.length });
    expect(dto.filename).toBe(`lampiran-${(dto.id as string).slice(0, 8)}.png`);
    expect(response.headers.get('location')).toBe(`/api/v1/postel-files/${dto.id as string}`);
    const row = (await rows('SELECT * FROM files WHERE id = ?', dto.id))[0];
    expect(row).toMatchObject({
      owner_type: '',
      owner_id: '',
      created_by: EDITOR,
      status: 'active',
    });
    expect([Number(row.width), Number(row.height)]).toEqual([0, 0]);
    const stored = [...env.BRIDGE.state.files.values()][0];
    expect(stored?.mime).toBe('image/png');
    expect(stored?.shared).toBe(false);
  });

  test('PDF: ok, nama berakhiran .pdf, lebar dan tinggi 0', async () => {
    const dto = await upload(pdf(), 'application/pdf');
    expect(dto.mime).toBe('application/pdf');
    expect(dto.filename).toMatch(/^lampiran-[0-9a-f]{8}\.pdf$/);
    const row = (await rows('SELECT width, height FROM files WHERE id = ?', dto.id))[0];
    expect([Number(row.width), Number(row.height)]).toEqual([0, 0]);
    const stored = [...env.BRIDGE.state.files.values()][0];
    expect(stored?.mime).toBe('application/pdf');
    expect(stored?.shared).toBe(false);
  });

  test('WebP dan JPEG diterima (dimensi tidak disimpan)', async () => {
    const w = await upload(webp(100, 50), 'image/webp');
    const j = await upload(jpeg(320, 200), 'image/jpeg');
    expect(w.filename).toMatch(/\.webp$/);
    expect(j.filename).toMatch(/\.jpg$/);
    const dims = await rows('SELECT mime, width, height FROM files ORDER BY mime');
    expect(dims.map((r) => [r.mime, Number(r.width), Number(r.height)])).toEqual([
      ['image/jpeg', 0, 0],
      ['image/webp', 0, 0],
    ]);
  });

  test('isi tidak sesuai MIME ditolak (422) dan tidak menyentuh Drive', async () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ['PDF berisi PNG', png(), 'application/pdf'],
      [
        'PDF berisi HTML',
        new Uint8Array(ascii('<html><script>alert(1)</script></html>')),
        'application/pdf',
      ],
      ['PNG berisi PDF', pdf(), 'image/png'],
      ['GIF', new Uint8Array(ascii('GIF89a......')), 'image/gif'],
      ['kosong', new Uint8Array(), 'application/pdf'],
      [
        'PNG tanpa dimensi terbaca',
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
        'image/png',
      ],
    ];
    for (const [name, bytes, mime] of cases) {
      const response = await uploadRaw(bytes, mime);
      expect(response.status, name).toBe(422);
      expect((await jsonOf(response)).code, name).toBe('VALIDATION');
    }
    expect(env.BRIDGE.state.files.size).toBe(0);
    expect(await rows('SELECT id FROM files')).toHaveLength(0);
  });

  test('10 MB + 1 byte = 413 tanpa menyentuh Drive; persis 10 MB diterima', async () => {
    const response = await uploadRaw(pdf(MAX_IMAGE_BYTES + 1), 'application/pdf');
    expect(response.status).toBe(413);
    expect((await jsonOf(response)).code).toBe('VALIDATION');
    expect(env.BRIDGE.state.files.size).toBe(0);
    const ok = await uploadRaw(pdf(MAX_IMAGE_BYTES), 'application/pdf');
    expect(ok.status).toBe(201);
  });

  test('izin: stickerview 403, tanpa sticker 403, tanpa sesi 401', async () => {
    expect((await uploadRaw(pdf(), 'application/pdf', VIEWER)).status).toBe(403);
    expect((await uploadRaw(pdf(), 'application/pdf', NOSTICKER)).status).toBe(403);
    expect((await uploadRaw(pdf(), 'application/pdf', ITEMVIEW)).status).toBe(403);
    expect((await uploadRaw(pdf(), 'application/pdf', null)).status).toBe(401);
    expect(env.BRIDGE.state.files.size).toBe(0);
  });

  test('files.upload biasa tetap menolak PDF', async () => {
    const response = await rest.post('/files?width=10&height=10', {
      email: EDITOR,
      raw: pdf(),
      headers: { 'content-type': 'application/pdf' },
    });
    expect(response.status).toBe(422);
    expect(env.BRIDGE.state.files.size).toBe(0);
  });
});

describe('postelFiles.get', () => {
  test('lampiran terpasang: byte sama, attachment + nama lampiran-....pdf, nosniff, bisa dibaca stickerview', async () => {
    const bytes = pdf(300);
    const file = await upload(bytes, 'application/pdf');
    await createPostel([file.id]);
    const response = await rest.get(`/postel-files/${file.id as string}`, { email: VIEWER });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(`lampiran-${(file.id as string).slice(0, 8)}.pdf`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes))).toBe(0);
    // pengguna tanpa sticker view tidak
    expect(
      (await rest.get(`/postel-files/${file.id as string}`, { email: NOSTICKER })).status,
    ).toBe(403);
    expect((await rest.get(`/postel-files/${file.id as string}`, { email: ITEMVIEW })).status).toBe(
      403,
    );
  });

  test('id tak dikenal 404; berkas milik item 404; berkas jenis lain lewat rute ini 404', async () => {
    expect((await rest.get('/postel-files/tidak-ada', { email: EDITOR })).status).toBe(404);
    const driveId = await env.BRIDGE.createFile('folder', 'x.png', 'image/png', 'AAAA');
    for (const [id, ownerType] of [
      ['f-item', 'item'],
      ['f-sticker', 'sticker'],
      ['f-logo', 'qrlogo'],
    ] as const) {
      await insertFileStmt(env.DB, {
        id,
        driveId,
        mime: 'image/png',
        size: 3,
        width: 1,
        height: 1,
        ownerType,
        ownerId: 'x',
        createdAt: '2026-11-11T00:00:00.000Z',
        createdBy: 'seed@gmail.com',
        status: 'active',
      }).run();
      const response = await rest.get(`/postel-files/${id}`, { email: EDITOR });
      expect(response.status, ownerType).toBe(404);
    }
  });

  test('unggahan tertunda: milik user lain 404 (walau isi sudah di cache), milik sendiri ok', async () => {
    const file = await upload(pdf(), 'application/pdf', EDITOR);
    const own = await rest.get(`/postel-files/${file.id as string}`, { email: EDITOR });
    expect(own.status).toBe(200);
    // isi kini ada di cache proses: pemeriksaan akses tetap mendahului cache
    expect((await rest.get(`/postel-files/${file.id as string}`, { email: EDITOR2 })).status).toBe(
      404,
    );
    expect((await rest.get(`/postel-files/${file.id as string}`, { email: ADMIN })).status).toBe(
      404,
    );
  });

  test('files.get lama tidak membuka lampiran Postel', async () => {
    const file = await upload(png(), 'image/png');
    await createPostel([file.id]);
    expect((await rest.get(`/files/${file.id as string}`, { email: ITEMVIEW })).status).toBe(404);
    expect((await rest.get(`/files/${file.id as string}`, { email: EDITOR })).status).toBe(404);
  });
});

describe('postels.save: lampiran', () => {
  test('11 lampiran ditolak (VALIDATION pada attachmentIds)', async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `f${index}`);
    const result = await call(EDITOR, 'postels.save', saveBody(ids));
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.fields?.attachmentIds).toBeTruthy();
  });

  test('dua lampiran sah: pemilik postel, urutan terjaga, DTO memuat id/mime/size/filename', async () => {
    const a = await upload(pdf(200), 'application/pdf');
    const b = await upload(png(10, 10, 80), 'image/png');
    const postel = await createPostel([b.id, a.id]);
    expect((postel.attachments as Json[]).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(postel.attachments[0]).toEqual({
      id: b.id,
      mime: 'image/png',
      size: 80,
      filename: `lampiran-${(b.id as string).slice(0, 8)}.png`,
    });
    const files = await rows('SELECT id, owner_type, owner_id, status FROM files ORDER BY id');
    for (const file of files) {
      expect(file).toMatchObject({ owner_type: 'postel', owner_id: postel.id, status: 'active' });
    }
    const got = (await call(VIEWER, 'postels.get', { id: postel.id })).data as Json;
    expect(got.attachments.map((x: Json) => x.id)).toEqual([b.id, a.id]);
    const stored = (await rows('SELECT attachments FROM postels WHERE id = ?', postel.id))[0];
    expect(JSON.parse(stored.attachments)).toEqual([b.id, a.id]);
    const audit = await rows("SELECT `after` FROM audit_log WHERE action = 'postel.create'");
    expect(JSON.parse(audit[0].after).attachments).toBe(2);
  });

  test('mengubah urutan lampiran saja tersimpan (updatedAt naik) tanpa entri audit baru; perubahan lain tetap diaudit', async () => {
    const a = await upload(pdf(), 'application/pdf');
    const b = await upload(png(), 'image/png');
    const postel = await createPostel([a.id, b.id]);
    const stored = postel.numbers as Json[];
    const result = await call(EDITOR, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...saveBody([b.id, a.id], {
        numbers: [
          { id: stored[0].id, number: stored[0].number, expiresOn: stored[0].expiresOn, link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect((result.data.attachments as Json[]).map((x) => x.id)).toEqual([b.id, a.id]);
    expect((result.data.updatedAt as string) > (postel.updatedAt as string)).toBe(true);
    // before == after pada snapshot (urutan tak tercatat): tidak ada entri `postel.update`
    expect(await rows("SELECT id FROM audit_log WHERE action = 'postel.update'")).toHaveLength(0);
    // perubahan lain bersama urutan tetap diaudit
    const next = await call(EDITOR, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: result.data.updatedAt,
      ...saveBody([a.id, b.id], {
        note: 'catatan baru',
        numbers: [
          { id: stored[0].id, number: stored[0].number, expiresOn: stored[0].expiresOn, link: '' },
        ],
      }),
    });
    expect(next.ok).toBe(true);
    expect(await rows("SELECT id FROM audit_log WHERE action = 'postel.update'")).toHaveLength(1);
  });

  test('lampiran milik catatan lain, unggahan tertunda orang lain, berkas jenis lain, dan id tak dikenal: jawaban SAMA', async () => {
    const mine = await upload(pdf(), 'application/pdf');
    await createPostel([mine.id], { itemIds: ['i2'] });
    const theirs = await upload(pdf(), 'application/pdf', EDITOR2);
    const driveId = await env.BRIDGE.createFile('folder', 'x.png', 'image/png', 'AAAA');
    await insertFileStmt(env.DB, {
      id: 'f-item',
      driveId,
      mime: 'image/png',
      size: 3,
      width: 1,
      height: 1,
      ownerType: 'item',
      ownerId: 'i1',
      createdAt: '2026-11-11T00:00:00.000Z',
      createdBy: 'seed@gmail.com',
      status: 'active',
    }).run();
    const messages = new Set<string>();
    for (const id of [mine.id, theirs.id, 'f-item', 'tidak-ada']) {
      const result = await call(EDITOR, 'postels.save', saveBody([id]));
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('VALIDATION');
      messages.add(result.error?.fields?.attachmentIds);
    }
    expect(messages.size).toBe(1);
    // tak ada yang berubah
    expect(await rows("SELECT id FROM files WHERE owner_type = 'postel'")).toHaveLength(1);
    expect(
      await rows("SELECT id FROM files WHERE id = ? AND owner_type = ''", theirs.id),
    ).toHaveLength(1);
  });

  test('menyimpan ulang tanpa satu lampiran membuang berkas dari Drive dan menghapus barisnya', async () => {
    const a = await upload(pdf(), 'application/pdf');
    const b = await upload(png(), 'image/png');
    const drive = (id: string) =>
      (rows('SELECT drive_id FROM files WHERE id = ?', id) as Promise<Json[]>).then(
        (r) => r[0]?.drive_id,
      );
    const aDrive = (await drive(a.id)) as string;
    const postel = await createPostel([a.id, b.id]);
    const stored = postel.numbers as Json[];
    const result = await call(EDITOR, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...saveBody([b.id], {
        numbers: [
          { id: stored[0].id, number: stored[0].number, expiresOn: stored[0].expiresOn, link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect((result.data.attachments as Json[]).map((x) => x.id)).toEqual([b.id]);
    expect(await rows('SELECT id FROM files WHERE id = ?', a.id)).toHaveLength(0);
    expect(env.BRIDGE.state.files.get(aDrive)?.trashed).toBe(true);
    expect(
      await rows("SELECT id FROM files WHERE id = ? AND status = 'active'", b.id),
    ).toHaveLength(1);
    // lampiran yang dilepas tak terbaca lagi
    expect((await rest.get(`/postel-files/${a.id as string}`, { email: EDITOR })).status).toBe(404);
  });

  test('postels.remove (hapus lunak) tidak membuang lampiran: berkas tetap aktif dan Drive tak disentuh', async () => {
    const a = await upload(pdf(), 'application/pdf');
    const b = await upload(png(), 'image/png');
    const driveIds = (await rows('SELECT drive_id FROM files')).map((r) => r.drive_id as string);
    const postel = await createPostel([a.id, b.id]);
    expect((await call(EDITOR, 'postels.remove', { id: postel.id })).ok).toBe(true);
    expect(await rows("SELECT id FROM files WHERE status = 'active'")).toHaveLength(2);
    for (const driveId of driveIds)
      expect(env.BRIDGE.state.files.get(driveId)?.trashed).toBe(false);
    expect(await rows("SELECT id FROM postels WHERE deleted_at <> ''")).toHaveLength(1);
  });

  test('lampiran catatan terhapus: sticker edit tetap dapat mengunduh, sticker view saja NOT_FOUND (sebelum cache isi dibaca)', async () => {
    const file = await upload(pdf(), 'application/pdf');
    const postel = await createPostel([file.id]);
    const path = `/postel-files/${file.id as string}`;
    expect((await rest.get(path, { email: VIEWER })).status).toBe(200);
    expect((await call(EDITOR, 'postels.remove', { id: postel.id })).ok).toBe(true);
    expect((await rest.get(path, { email: VIEWER })).status).toBe(404);
    expect((await call(VIEWER, 'postelFiles.get', { id: file.id })).error?.code).toBe('NOT_FOUND');
    expect((await rest.get(path, { email: EDITOR })).status).toBe(200);
    // sesudah dipulihkan, pembaca biasa dapat mengunduh lagi
    expect((await call(EDITOR, 'postels.restore', { id: postel.id })).ok).toBe(true);
    expect((await rest.get(path, { email: VIEWER })).status).toBe(200);
  });

  test('simpan serentak dua catatan memasang unggahan yang sama: tepat satu berhasil, yang kalah tidak menyimpan apa pun', async () => {
    const file = await upload(pdf(), 'application/pdf');
    const results = await Promise.all([
      call(EDITOR, 'postels.save', saveBody([file.id], { itemIds: ['i3'] })),
      call(EDITOR, 'postels.save', saveBody([file.id], { itemIds: ['i4'] })),
    ]);
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.code).toBe('VALIDATION');
    expect(failed[0]?.error?.fields?.attachmentIds).toBeTruthy();
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    const owner = (await rows('SELECT owner_type, owner_id FROM files WHERE id = ?', file.id))[0];
    expect(owner).toMatchObject({ owner_type: 'postel', owner_id: ok[0]?.data?.id });
    expect(await rows("SELECT id FROM items WHERE postel_id <> ''")).toHaveLength(1);
  });

  test('seedPostel dengan lampiran lama: DTO memuat lampiran aktifnya saja', async () => {
    const a = await upload(pdf(), 'application/pdf');
    await env.DB.prepare("UPDATE files SET owner_type = 'postel', owner_id = 'p-seed' WHERE id = ?")
      .bind(a.id)
      .run();
    await seedPostel(env, {
      id: 'p-seed',
      itemIds: ['i1'],
      attachments: [a.id, 'hilang'],
      numbers: [{ number: 'SEED-1', expiresOn: '2027-01-01' }],
    });
    const got = (await call(VIEWER, 'postels.get', { id: 'p-seed' })).data as Json;
    expect(got.attachments.map((x: Json) => x.id)).toEqual([a.id]);
  });
});

describe('PDF Postel tidak dapat dipasang ke pemilik khusus gambar', () => {
  test('items.save, pustaka logo QR, dan stiker menolak PDF unggahan Postel (berkas tetap belum bertuan)', async () => {
    const file = await upload(pdf(), 'application/pdf', ADMIN);
    const item = await call(ADMIN, 'items.save', {
      brandId: brandIdOf('PBE'),
      model: 'Dengan PDF',
      isCountryLock: false,
      aliases: [],
      stickerPhotos: [],
      accessories: [],
      attachments: [file.id],
      detail: '',
      businessUnitIds: ['bu-umum'],
    });
    expect(item.ok).toBe(false);
    expect(item.error?.code).toBe('VALIDATION');
    expect(item.error?.message).toBe('Ada berkas yang tidak dikenal');
    const logo = await call(ADMIN, 'qrcodes.saveLogoLibrary', { logoFileIds: [file.id] });
    expect(logo.ok).toBe(false);
    expect(logo.error?.code).toBe('VALIDATION');
    expect(logo.error?.message).toBe('Ada berkas yang tidak dikenal');
    await seedStickerType(env, { id: 't-pdf', name: 'Jenis PDF', rule: 'none' });
    const sticker = await call(ADMIN, 'stickers.save', {
      typeId: 't-pdf',
      name: 'Stiker PDF',
      alias: '',
      fileId: file.id,
      minQty: 0,
      businessUnitIds: [],
    });
    expect(sticker.ok).toBe(false);
    expect(sticker.error?.code).toBe('VALIDATION');
    expect(sticker.error?.message).toBe('Gambar tidak dikenal; unggah ulang');
    const row = (await rows('SELECT owner_type, owner_id FROM files WHERE id = ?', file.id))[0];
    expect(row).toMatchObject({ owner_type: '', owner_id: '' });
  });

  test('PDF pending milik sendiri tidak terbaca lewat files.get (404), tetap terbaca lewat postelFiles.get', async () => {
    const file = await upload(pdf(), 'application/pdf', ADMIN);
    expect((await rest.get(`/files/${file.id as string}`, { email: ADMIN })).status).toBe(404);
    const ok = await rest.get(`/postel-files/${file.id as string}`, { email: ADMIN });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    // gambar pending milik sendiri tetap terbaca lewat files.get (perilaku lama)
    const image = await rest.post('/files?width=10&height=10', {
      email: ADMIN,
      raw: png(10, 10),
      headers: { 'content-type': 'image/png' },
    });
    const imageId = (await jsonOf(image)).id as string;
    expect((await rest.get(`/files/${imageId}`, { email: ADMIN })).status).toBe(200);
  });
});

describe('readFile: berkas non-gambar tidak menyentuh cache isi', () => {
  test('files.get atas PDF Postel (pending milik sendiri dan lampiran terpasang) 404 tanpa membaca cache', async () => {
    const reads: string[] = [];
    const inner = env.FILE_CACHE;
    if (!inner) throw new Error('FILE_CACHE tes wajib ada');
    env.FILE_CACHE = {
      get: async (key) => {
        reads.push(key);
        return inner.get(key);
      },
      put: (key, mime, base64) => inner.put(key, mime, base64),
      drop: async (driveId) => inner.drop?.(driveId),
    };
    const pending = await upload(pdf(), 'application/pdf', ADMIN);
    const attached = await upload(pdf(), 'application/pdf', ADMIN);
    await createPostel([attached.id], {}, ADMIN);
    for (const id of [pending.id, attached.id] as string[]) {
      expect((await rest.get(`/files/${id}`, { email: ADMIN })).status).toBe(404);
    }
    expect(reads).toEqual([]);
    // kontrol: rute lampiran memang membaca cache
    expect((await rest.get(`/postel-files/${pending.id as string}`, { email: ADMIN })).status).toBe(
      200,
    );
    expect(reads.length).toBe(1);
  });
});

describe('postelFiles.upload: dimensi dan batas unggahan tertunda', () => {
  test('dimensi gambar tidak dibatasi dan tidak disimpan: header besar atau menipu tetap diterima, lebar/tinggi 0', async () => {
    // Termasuk lebar 2^31 (melampaui INT bila disimpan) dan sisi > 10000 piksel: lampiran hanya diunduh.
    for (const bytes of [png(2 ** 31, 10), png(10, 10_001), png(30_000, 30_000)]) {
      const response = await uploadRaw(bytes, 'image/png');
      expect(response.status).toBe(201);
      const id = (await jsonOf(response)).id as string;
      const row = await env.DB.prepare('SELECT width, height FROM files WHERE id = ?')
        .bind(id)
        .first<{ width: number; height: number }>();
      expect(row).toEqual({ width: 0, height: 0 });
    }
  });

  test('batas unggahan belum dipakai: pesan menyebut lampiran Postel (bukan gambar item)', async () => {
    for (let index = 0; index < 50; index++) {
      await insertFileStmt(env.DB, {
        id: `pending-${index}`,
        driveId: 'd',
        mime: 'application/pdf',
        size: 1,
        width: 0,
        height: 0,
        ownerType: '',
        ownerId: '',
        createdAt: '2026-11-11T00:00:00.000Z',
        createdBy: EDITOR,
        status: 'active',
      }).run();
    }
    const result = await call(EDITOR, 'postelFiles.upload', {
      mime: 'application/pdf',
      bytes: pdf(),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFLICT');
    expect(result.error?.message).toContain('lampiran');
    expect(result.error?.message).not.toContain('gambar');
    expect(result.error?.message).not.toContain('item');
  });
});

describe('pembuangan lampiran yang dilepas', () => {
  test('berkas yang dilepas ter-trash di Drive walau banyak baris pending_delete lain yang lebih lama', async () => {
    for (let index = 0; index < 8; index++) {
      const driveId = await env.BRIDGE.createFile(
        'folder',
        `lama-${index}.pdf`,
        'application/pdf',
        'AAAA',
      );
      await insertFileStmt(env.DB, {
        id: `stale-${index}`,
        driveId,
        mime: 'application/pdf',
        size: 1,
        width: 0,
        height: 0,
        ownerType: 'postel',
        ownerId: 'hilang',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'seed@gmail.com',
        status: 'pending_delete',
      }).run();
    }
    const a = await upload(pdf(), 'application/pdf');
    const b = await upload(png(), 'image/png');
    const driveOf = async (id: string) =>
      (await rows('SELECT drive_id FROM files WHERE id = ?', id))[0].drive_id as string;
    const aDrive = await driveOf(a.id);
    const postel = await createPostel([a.id, b.id]);
    const stored = postel.numbers as Json[];
    const result = await call(EDITOR, 'postels.save', {
      id: postel.id,
      expectedUpdatedAt: postel.updatedAt,
      ...saveBody([b.id], {
        numbers: [
          { id: stored[0].id, number: stored[0].number, expiresOn: stored[0].expiresOn, link: '' },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(env.BRIDGE.state.files.get(aDrive)?.trashed).toBe(true);
    expect(await rows('SELECT id FROM files WHERE id = ?', a.id)).toHaveLength(0);
    // pembuangan terarah: baris lama milik pembersihan terjadwal tidak disentuh
    expect(await rows("SELECT id FROM files WHERE status = 'pending_delete'")).toHaveLength(8);
  });
});
