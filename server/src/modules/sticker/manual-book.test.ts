import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { bytesToBase64 } from '@server/core/bytes';
import type { DbTx } from '@server/core/db';
import { runPendingJobs } from '@server/jobs/runner';
import { JOB_MAX_ATTEMPTS, runJobStep } from '@server/modules/jobs/consumer';
import { enqueueJob } from '@server/modules/jobs/service';
import { QR_STALE_MESSAGE } from '@server/modules/qrcode/service';
import { qrManualBookFields, qrPdfDocumentId, seedQrEnv } from '@server-test/qrcode-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';

// Stiker Manual Book berversi yang lahir dari ekspor konfigurasi QR (spek 4a): jenis sistem, stiker, versi, stiker
// lama deprecated/inactive, idempotensi, dan kegagalan sebelum komit.

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
const realError = console.error;

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG sah (hanya IHDR yang dibaca server; bawaan 4x3 piksel) dengan isi acak tambahan. */
function pngBytes(seed = 1, width = 4, height = 3): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + seed) % 256;
  bytes.set(PNG_HEAD, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // panjang IHDR
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function pdfBytes(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + seed) % 256;
  bytes.set(PDF_HEAD, 0);
  return bytes;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T03:00:00.000Z'));
  rest = restClient(env);
  await seedQrEnv(env);
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

type Design = { id: string; updatedAt: string; name: string };

async function makeDesign(extra: Record<string, unknown> = {}): Promise<Design> {
  const response = await rest.post('/qrcodes', {
    email: 'qredit@gmail.com',
    body: {
      ...(await qrManualBookFields(env, 'PBE M5-400')),
      title: 'PBE M5-400',
      linkSource: 'pdf',
      link: '',
      documentId: await qrPdfDocumentId(env),
      subtitle: '',
      footer: '',
      logoFileId: '',
      layout: DEFAULT_QR_LAYOUT,
      style: DEFAULT_QR_STYLE,
      ...extra,
    },
  });
  expect(response.status).toBe(201);
  return (await jsonOf(response)) as Design;
}

async function reload(id: string) {
  return (await jsonOf(await rest.get(`/qrcodes/${id}`, { email: 'qredit@gmail.com' }))) as Design &
    Record<string, unknown>;
}

/** Mengubah label (title) lewat simpan agar hash berbeda; mengembalikan konfigurasi terbaru. */
async function relabel(design: Design, title: string) {
  const current = await reload(design.id);
  env.clock.advance(1000);
  const response = await rest.put(`/qrcodes/${design.id}`, {
    email: 'qredit@gmail.com',
    headers: { 'if-match': `"${current.updatedAt}"` },
    body: {
      name: current.name,
      presetId: '',
      itemIds: (current.items as { id: string }[]).map((item) => item.id),
      title,
      linkSource: 'pdf',
      link: '',
      documentId: current.documentId,
      subtitle: '',
      footer: '',
      logoFileId: '',
      layout: current.layout,
      style: current.style,
    },
  });
  expect(response.status).toBe(200);
  return (await jsonOf(response)) as Design;
}

function form(parts: {
  pdf?: Uint8Array | null;
  png?: Uint8Array | null;
  preview?: Uint8Array | null;
}) {
  const data = new FormData();
  const { pdf = pdfBytes(), png = pngBytes(), preview = pngBytes(9) } = parts;
  if (pdf) data.append('pdf', new Blob([pdf], { type: 'application/pdf' }), 'label.pdf');
  if (png) data.append('png', new Blob([png], { type: 'image/png' }), 'label.png');
  if (preview) data.append('preview', new Blob([preview], { type: 'image/png' }), 'preview.png');
  return data;
}

const exportDesign = (
  design: { id: string; updatedAt: string },
  options: { reason?: string; parts?: Parameters<typeof form>[0]; email?: string } = {},
) =>
  rest.post(
    `/qrcodes/${design.id}/exports${options.reason === undefined ? '' : `?reason=${encodeURIComponent(options.reason)}`}`,
    {
      email: options.email ?? 'qredit@gmail.com',
      raw: form(options.parts ?? {}),
      headers: { 'if-match': `"${design.updatedAt}"` },
    },
  );

async function exportOk(design: Design, reason?: string) {
  const current = await reload(design.id);
  const accepted = await exportDesign(current, { ...(reason === undefined ? {} : { reason }) });
  expect(accepted.status).toBe(202);
  await runPendingJobs(env);
  const { jobId } = (await jsonOf(accepted)) as { jobId: string };
  const job = (await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' }))) as {
    status: string;
  };
  expect(job.status).toBe('done');
  return jobId;
}

interface StickerRow {
  id: string;
  name: string;
  status: string;
  min_qty: number;
  file_id: string;
  type_id: string;
}
async function stickers(): Promise<StickerRow[]> {
  const rows = await env.DB.prepare(
    'SELECT id, name, status, min_qty, file_id, type_id FROM stickers ORDER BY name',
  ).all<StickerRow>();
  return rows.results.map((row) => ({ ...row, id: row.id.trim(), file_id: row.file_id.trim() }));
}
async function versions(designId: string) {
  const rows = await env.DB.prepare(
    'SELECT sticker_id, version, reason, content_hash FROM manual_book_versions WHERE design_id = ? ORDER BY version',
  )
    .bind(designId)
    .all<{ sticker_id: string; version: number; reason: string; content_hash: string }>();
  return rows.results;
}
/** Berkas ekspor (PDF/PNG label); PDF sumber QR dan gambar contoh bernama lain. */
const EXPORT_NAME = /^PBE-M5-400-\d+\.(pdf|png)$/;
const driveNames = () => [...env.BRIDGE.state.files.values()].map((file) => file.name);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DESIGN_LOCK = 'SELECT id FROM qr_designs WHERE id = ? FOR UPDATE';

/**
 * Menunggu sampai sedikitnya `count` transaksi terlihat menunggu kunci (`INNODB_TRX`, `LOCK WAIT`), maksimal 15
 * dtk. `false` bila tabelnya tidak dapat dibaca (hak akses): pemanggil jatuh ke jeda tetap.
 */
async function waitForLockWaiters(count: number): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT'",
      ).first<{ n: number | string }>();
      if (Number(row?.n) >= count) return true;
    } catch {
      return false;
    }
    await sleep(100);
  }
  throw new Error(`penantang kunci tidak pernah terlihat menunggu (diharapkan ${count})`);
}

/**
 * Meniru penulis lain yang sedang memegang kunci baris (komit ekspor, penulis stok): transaksi terpisah mengunci
 * baris `lock`, `start` dijalankan (ia akan menunggu kunci), sesudah penantang TERLIHAT menunggu (poll
 * `INNODB_TRX`; bila tak terbaca, jeda tetap 1,5 dtk) `inside` dikerjakan di transaksi itu dan dikomit. Penantang
 * wajib belum selesai saat kunci dilepas (bila sudah, tes ini tidak membuktikan apa pun dan gagal). Hasil `start`
 * dikembalikan bersama banyaknya transaksi pemegang dijalankan (>1 = deadlock lalu diulang). `waiters` = banyaknya
 * penantang yang ditunggu.
 */
async function whileLocked<T>(
  lock: { sql: string; id: string },
  inside: (tx: DbTx) => Promise<void>,
  start: () => Promise<T>,
  waiters = 1,
): Promise<{ out: T; holderRuns: number }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let holderRuns = 0;
  const held = env.DB.transaction(async (tx) => {
    holderRuns++;
    await tx.prepare(lock.sql).bind(lock.id).first();
    locked();
    await gate;
    await inside(tx);
  });
  await ready;
  let settled = false;
  const pending = start();
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  if (await waitForLockWaiters(waiters)) await sleep(300);
  else await sleep(1500);
  if (settled) {
    release();
    await held;
    throw new Error('penantang selesai sebelum kunci dilepas: tes tidak menguji balapan');
  }
  release();
  await held;
  return { out: await pending, holderRuns };
}

describe('ekspor pertama', () => {
  test('membuat jenis Manual Book, satu stiker v1 aktif ber-min default jenis, baris versi, dan gambar contoh milik stiker', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const types = await env.DB.prepare(
      'SELECT id, name, rule, system_kind, default_min_qty FROM sticker_types',
    ).all<{ id: string; name: string; rule: string; system_kind: string }>();
    expect(types.results).toHaveLength(1);
    expect(types.results[0]).toMatchObject({
      name: 'Manual Book',
      rule: 'group',
      system_kind: 'manual_book',
    });
    const rows = await stickers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'PBE M5-400 v1', status: 'active', min_qty: 0 });
    const v = await versions(design.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ sticker_id: rows[0]?.id, version: 1, reason: '' });
    const file = await env.DB.prepare(
      'SELECT owner_type, owner_id, mime, width, height, status FROM files WHERE id = ?',
    )
      .bind(rows[0]?.file_id)
      .first<{
        owner_type: string;
        owner_id: string;
        mime: string;
        width: number;
        height: number;
      }>();
    expect(file).toMatchObject({
      owner_type: 'sticker',
      owner_id: rows[0]?.id,
      mime: 'image/png',
      width: 4,
      height: 3,
    });
    const dto = await reload(design.id);
    expect(dto).toMatchObject({ stickerVersion: 1, stickerStatus: 'active' });
  });

  test('min stiker v1 memakai default_min_qty jenis sistem bila sudah diatur', async () => {
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
      defaultMinQty: 25,
    });
    const design = await makeDesign();
    await exportOk(design);
    expect((await stickers())[0]).toMatchObject({ min_qty: 25, type_id: 't-mb' });
  });

  test('nama berkas Drive = <nama>-<stempel>.pdf/.png dari nama Manual Book', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const names = driveNames().filter((name) => name.endsWith('.pdf') || name.endsWith('.png'));
    expect(names.some((n) => /^PBE-M5-400-\d{14,17}\.pdf$/.test(n))).toBe(true);
    expect(names.some((n) => /^PBE-M5-400-\d{14,17}\.png$/.test(n))).toBe(true);
  });

  test('jenis bernama "Manual Book" tanpa stiker diubah menjadi jenis sistem; yang sudah berstiker menolak ekspor dengan pesan', async () => {
    await seedStickerType(env, { id: 't-lama', name: 'Manual Book', rule: 'bu' });
    const design = await makeDesign();
    await exportOk(design);
    const type = await env.DB.prepare('SELECT rule, system_kind FROM sticker_types WHERE id = ?')
      .bind('t-lama')
      .first<{ rule: string; system_kind: string }>();
    expect(type).toMatchObject({ rule: 'group', system_kind: 'manual_book' });
  });

  test('jenis "Manual Book" non-sistem yang sudah berstiker: job gagal dengan pesan, tanpa stiker/versi baru, berkas dibuang', async () => {
    await seedStickerType(env, { id: 't-lama', name: 'Manual Book', rule: 'bu' });
    await seedSticker(env, { id: 's-lama', typeId: 't-lama', name: 'Biasa' });
    const design = await makeDesign();
    const current = await reload(design.id);
    const accepted = await exportDesign(current);
    expect(accepted.status).toBe(202);
    const { jobId } = (await jsonOf(accepted)) as { jobId: string };
    await runPendingJobs(env);
    const job = (await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' }))) as {
      status: string;
      error: string;
    };
    expect(job.status).toBe('failed');
    expect(await versions(design.id)).toHaveLength(0);
    expect(await stickers()).toHaveLength(1);
    const live = [...env.BRIDGE.state.files.values()].filter(
      (file) => !file.trashed && EXPORT_NAME.test(file.name),
    );
    expect(live).toEqual([]);
  });
});

describe('ekspor ulang', () => {
  test('label berubah, stok lama 0: stiker lama inactive, baru v2 mewarisi min v1 (yang diubah menjadi 200), alasan tercatat', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const [v1] = await stickers();
    await env.DB.prepare('UPDATE stickers SET min_qty = 200 WHERE id = ?').bind(v1?.id).run();
    await relabel(design, 'PBE M5-400 Baru');
    await exportOk(design, 'Logo diganti');
    const rows = await stickers();
    expect(rows).toHaveLength(2);
    const old = rows.find((row) => row.name === 'PBE M5-400 v1');
    const fresh = rows.find((row) => row.name === 'PBE M5-400 v2');
    expect(old?.status).toBe('inactive');
    expect(fresh).toMatchObject({ status: 'active', min_qty: 200 });
    const v = await versions(design.id);
    expect(v.map((row) => [row.version, row.reason])).toEqual([
      [1, ''],
      [2, 'Logo diganti'],
    ]);
  });

  test('label berubah, stok lama > 0: stiker lama deprecated', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const [v1] = await stickers();
    await env.DB.prepare(
      'INSERT INTO locations (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('loc1', 'L1', 'Gudang', 'active', 't', 't', 's')
      .run();
    await env.DB.prepare(
      'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, 5, ?)',
    )
      .bind(v1?.id, 'loc1', 't')
      .run();
    await relabel(design, 'Judul Lain');
    await exportOk(design, 'Perubahan isi');
    const rows = await stickers();
    expect(rows.find((row) => row.name === 'PBE M5-400 v1')?.status).toBe('deprecated');
    expect(rows.find((row) => row.name === 'PBE M5-400 v2')?.status).toBe('active');
  });

  test('ekspor ulang tanpa perubahan label: tidak ada stiker atau versi baru, berkas Drive tetap diganti', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const before = driveNames().length;
    env.clock.advance(5000);
    await exportOk(design);
    expect(await stickers()).toHaveLength(1);
    expect(await versions(design.id)).toHaveLength(1);
    const live = [...env.BRIDGE.state.files.values()].filter(
      (file) => !file.trashed && EXPORT_NAME.test(file.name),
    );
    expect(live).toHaveLength(2);
    expect(driveNames().length).toBeGreaterThan(before);
  });

  test('dua job ekspor serentak yang melahirkan versi sama: satu menang, yang kalah gagal stale (bukan konflik nama)', async () => {
    const design = await makeDesign();
    await exportOk(design);
    await relabel(design, 'Label Baru');
    const current = await reload(design.id);
    const payload = { designId: design.id, expectedUpdatedAt: current.updatedAt };
    const blobs = (reason: string) => ({
      pdf: bytesToBase64(pdfBytes()),
      png: bytesToBase64(pngBytes()),
      preview: bytesToBase64(pngBytes(9)),
      reason,
    });
    // Dua job langsung diantrekan (melewati penyatuan `findActiveJob` di rute) agar komitnya benar-benar berebut.
    const a = await enqueueJob(env, 'qr_export', payload, 'qredit@gmail.com', {
      blobs: blobs('A'),
    });
    const b = await enqueueJob(env, 'qr_export', payload, 'qredit@gmail.com', {
      blobs: blobs('B'),
    });
    for (const jobId of [a, b])
      for (let step = 0; step < 3; step++) await runJobStep(env, jobId, 1);
    // Kunci baris konfigurasi ditahan agar kedua komit sudah menyusun pernyataannya (sama-sama melihat v1)
    // sebelum berebut; dilepas sesudah jeda.
    const { out } = await whileLocked(
      { sql: DESIGN_LOCK, id: design.id },
      async () => undefined,
      () => Promise.all([runJobStep(env, a, 1), runJobStep(env, b, 1)]),
      2,
    );
    expect(out.map((result) => result.kind).sort()).toEqual(['advanced', 'failed']);
    const failedId = out[0]?.kind === 'failed' ? a : b;
    const failed = (await jsonOf(
      await rest.get(`/jobs/${failedId}`, { email: 'qredit@gmail.com' }),
    )) as { status: string; error: string };
    expect(failed).toMatchObject({ status: 'failed', error: QR_STALE_MESSAGE });
    await runPendingJobs(env);
    const v = await versions(design.id);
    expect(v.map((row) => row.version)).toEqual([1, 2]);
    expect((await stickers()).filter((row) => row.status === 'active')).toHaveLength(1);
  });

  test('mengulang langkah komit setelah sukses (job diulang) tidak menggandakan stiker', async () => {
    const design = await makeDesign();
    const jobId = await exportOk(design);
    await env.DB.prepare(
      "UPDATE jobs SET status = 'queued', step = 3, lease_until = 0 WHERE id = ?",
    )
      .bind(jobId)
      .run();
    await runPendingJobs(env);
    expect(await stickers()).toHaveLength(1);
    expect(await versions(design.id)).toHaveLength(1);
  });
});

describe('kegagalan sebelum komit', () => {
  test('gagal membuat berkas gambar contoh: tanpa stiker, versi, atau berkas Drive yatim', async () => {
    const design = await makeDesign();
    const current = await reload(design.id);
    const accepted = await exportDesign(current);
    const { jobId } = (await jsonOf(accepted)) as { jobId: string };
    const originalCreate = env.BRIDGE.createFile.bind(env.BRIDGE);
    env.BRIDGE.createFile = async (folderId, name, mime, base64) => {
      if (name.endsWith('.png') && !name.startsWith('PBE')) throw new Error('preview gagal');
      return originalCreate(folderId, name, mime, base64);
    };
    await runJobStep(env, jobId, 1); // PDF
    await runJobStep(env, jobId, 1); // PNG
    await runJobStep(env, jobId, JOB_MAX_ATTEMPTS); // gambar contoh gagal terus: percobaan habis
    const job = (await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' }))) as {
      status: string;
    };
    expect(job.status).toBe('failed');
    expect(await stickers()).toHaveLength(0);
    expect(await versions(design.id)).toHaveLength(0);
    const live = [...env.BRIDGE.state.files.values()].filter(
      (file) => !file.trashed && EXPORT_NAME.test(file.name),
    );
    expect(live).toEqual([]);
    const row = await env.DB.prepare('SELECT export_pdf_drive_id FROM qr_designs WHERE id = ?')
      .bind(design.id)
      .first<{ export_pdf_drive_id: string }>();
    expect(row?.export_pdf_drive_id.trim()).toBe('');
  });
});

describe('qrcodes.versions', () => {
  test('urut menurun, memuat alasan, status, dan total stok; butuh qrcode view', async () => {
    const design = await makeDesign();
    await exportOk(design);
    await relabel(design, 'Versi Dua');
    await exportOk(design, 'Alasan dua');
    const out = await rest.get(`/qrcodes/${design.id}/versions`, { email: 'qrview@gmail.com' });
    expect(out.status).toBe(200);
    const list = (await jsonOf(out)) as unknown as Array<{
      version: number;
      name: string;
      status: string;
      reason: string;
      total: number;
      fileId: string | null;
      stickerId: string;
    }>;
    expect(list.map((row) => row.version)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({
      name: 'PBE M5-400 v2',
      status: 'active',
      reason: 'Alasan dua',
      total: 0,
    });
    expect(list[1]).toMatchObject({ status: 'inactive', reason: '' });
    expect(list[0]?.fileId).toBeTruthy();
    expect(
      (await rest.get(`/qrcodes/${design.id}/versions`, { email: 'noqr@gmail.com' })).status,
    ).toBe(403);
    expect(
      (await rest.get('/qrcodes/tidak-ada/versions', { email: 'qrview@gmail.com' })).status,
    ).toBe(404);
  });
});

describe('konkurensi dengan komit ekspor', () => {
  /** Konfigurasi lama tanpa penempatan nama (kelonggaran: boleh tanpa nama/item selama belum berversi). */
  async function legacyDesign() {
    const design = await makeDesign();
    await env.DB.prepare("UPDATE qr_designs SET name_placement = '' WHERE id = ?")
      .bind(design.id)
      .run();
    return design;
  }
  const saveBody = (current: Record<string, unknown>, extra: Record<string, unknown>) => ({
    name: current.name,
    presetId: '',
    itemIds: (current.items as { id: string }[]).map((item) => item.id),
    title: 'Judul Baru',
    linkSource: 'pdf',
    link: '',
    documentId: current.documentId,
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: current.layout,
    style: current.style,
    ...extra,
  });
  const ownedItems = async (designId: string) =>
    Number(
      (
        await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE manual_book_design_id = ?')
          .bind(designId)
          .first<{ n: number | string }>()
      )?.n,
    );
  const seedMbSticker = async (name: string) => {
    await seedStickerType(env, {
      id: 't-mb',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    await seedSticker(env, { id: 's-x', typeId: 't-mb', name });
  };
  const insertVersion = (tx: DbTx, designId: string) =>
    tx
      .prepare(
        "INSERT INTO manual_book_versions (sticker_id, design_id, version, content_hash, content_snapshot, reason, created_at, created_by) VALUES ('s-x', ?, 1, 'h', '{}', '', 't', 'x')",
      )
      .bind(designId)
      .run();

  test('hapus vs komit ekspor serentak: hapus ditolak, konfigurasi dan item utuh, tanpa versi yatim', async () => {
    const design = await makeDesign();
    await seedMbSticker('PBE M5-400 v1');
    const itemsBefore = await ownedItems(design.id);
    expect(itemsBefore).toBeGreaterThan(0);
    // Komit ekspor menahan baris konfigurasi dan melahirkan versi (updated_at tidak naik) sesudah hapus lolos
    // pembacaan awalnya.
    const { out } = await whileLocked(
      { sql: DESIGN_LOCK, id: design.id },
      async (tx) => {
        await insertVersion(tx, design.id);
      },
      () => rest.del(`/qrcodes/${design.id}`, { email: 'qrmanage@gmail.com' }),
    );
    expect(out.status).toBe(409);
    expect((await rest.get(`/qrcodes/${design.id}`, { email: 'qredit@gmail.com' })).status).toBe(
      200,
    );
    expect(await ownedItems(design.id)).toBe(itemsBefore);
    expect(await versions(design.id)).toHaveLength(1);
  });

  test('simpan tanpa nama/item (kelonggaran) vs komit ekspor serentak: ditolak 412, nama tetap', async () => {
    const design = await legacyDesign();
    await seedMbSticker('PBE M5-400 v1');
    const current = await reload(design.id);
    const { out } = await whileLocked(
      { sql: DESIGN_LOCK, id: design.id },
      async (tx) => {
        await insertVersion(tx, design.id);
      },
      () =>
        rest.put(`/qrcodes/${design.id}`, {
          email: 'qredit@gmail.com',
          headers: { 'if-match': `"${current.updatedAt}"` },
          body: saveBody({ ...current, items: [] }, { name: '' }),
        }),
    );
    expect(out.status).toBe(412);
    const row = await env.DB.prepare('SELECT name, title FROM qr_designs WHERE id = ?')
      .bind(design.id)
      .first<{ name: string; title: string }>();
    expect(row?.name).toBe(current.name);
    expect(row?.title).not.toBe('Judul Baru');
    expect(await ownedItems(design.id)).toBeGreaterThan(0);
  });

  test('simpan vs komit ekspor serentak: hasil ekspor yang baru commit tidak tertimpa salinan basi', async () => {
    const design = await legacyDesign();
    const current = await reload(design.id);
    const { out } = await whileLocked(
      { sql: DESIGN_LOCK, id: design.id },
      async (tx) => {
        await tx
          .prepare(
            "UPDATE qr_designs SET exported_hash = 'H-baru', exported_at = 'T-baru', exported_by = 'x@y', export_pdf_drive_id = 'pdf-baru', export_png_drive_id = 'png-baru' WHERE id = ?",
          )
          .bind(design.id)
          .run();
      },
      () =>
        rest.put(`/qrcodes/${design.id}`, {
          email: 'qredit@gmail.com',
          headers: { 'if-match': `"${current.updatedAt}"` },
          body: saveBody(current, {}),
        }),
    );
    expect(out.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT title, exported_hash, exported_at, exported_by, export_pdf_drive_id, export_png_drive_id FROM qr_designs WHERE id = ?',
    )
      .bind(design.id)
      .first<Record<string, string>>();
    expect(row).toMatchObject({
      title: 'Judul Baru',
      exported_hash: 'H-baru',
      exported_at: 'T-baru',
      exported_by: 'x@y',
      export_pdf_drive_id: 'pdf-baru',
      export_png_drive_id: 'png-baru',
    });
  });

  test('komit ekspor mengunci baris stiker lama lebih dulu (urutan sama dengan penulis stok): tanpa deadlock', async () => {
    const design = await makeDesign();
    await exportOk(design);
    const [v1] = await stickers();
    await env.DB.prepare(
      'INSERT INTO locations (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('loc1', 'L1', 'Gudang', 'active', 't', 't', 's')
      .run();
    await env.DB.prepare(
      'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, 5, ?)',
    )
      .bind(v1?.id, 'loc1', 't')
      .run();
    await relabel(design, 'Label Baru');
    const current = await reload(design.id);
    const accepted = await exportDesign(current, { reason: 'Ganti' });
    expect(accepted.status).toBe(202);
    const { jobId } = (await jsonOf(accepted)) as { jobId: string };
    for (let step = 0; step < 3; step++) await runJobStep(env, jobId, 1);
    // Penulis stok: kunci baris stiker dulu, baru mengubah baris stok.
    const { out, holderRuns } = await whileLocked(
      { sql: 'SELECT id FROM stickers WHERE id = ? FOR UPDATE', id: v1?.id ?? '' },
      async (tx) => {
        await tx
          .prepare('UPDATE sticker_stock SET qty = 3 WHERE sticker_id = ?')
          .bind(v1?.id)
          .run();
      },
      () => runJobStep(env, jobId, 1),
    );
    expect(holderRuns).toBe(1);
    expect(out.kind).toBe('advanced');
    const rows = await stickers();
    expect(rows.find((row) => row.name === 'PBE M5-400 v1')?.status).toBe('deprecated');
    expect(rows.find((row) => row.name === 'PBE M5-400 v2')?.status).toBe('active');
  });
});

describe('job ekspor tanpa gambar contoh (melintasi deploy)', () => {
  test('tanpa blob preview dan tanpa versi: komit tanpa versi/stiker, berkas ekspor tetap sah, tanpa yatim', async () => {
    const design = await makeDesign();
    const current = await reload(design.id);
    const jobId = await enqueueJob(
      env,
      'qr_export',
      { designId: design.id, expectedUpdatedAt: current.updatedAt },
      'qredit@gmail.com',
      { blobs: { pdf: bytesToBase64(pdfBytes()), png: bytesToBase64(pngBytes()) } },
    );
    await runPendingJobs(env);
    const job = (await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' }))) as {
      status: string;
    };
    expect(job.status).toBe('done');
    expect(await stickers()).toHaveLength(0);
    expect(await versions(design.id)).toHaveLength(0);
    const row = await env.DB.prepare(
      'SELECT exported_hash, export_pdf_drive_id, export_png_drive_id FROM qr_designs WHERE id = ?',
    )
      .bind(design.id)
      .first<{ exported_hash: string; export_pdf_drive_id: string; export_png_drive_id: string }>();
    expect(row?.exported_hash).not.toBe('');
    const live = [...env.BRIDGE.state.files.values()].filter(
      (file) => !file.trashed && EXPORT_NAME.test(file.name),
    );
    expect(live).toHaveLength(2);
    expect(row?.export_pdf_drive_id.trim()).not.toBe('');
    expect(row?.export_png_drive_id.trim()).not.toBe('');
  });

  test('gambar contoh ber-IHDR raksasa pada job (melewati rute): job gagal, berkas dibuang, tanpa stiker', async () => {
    const design = await makeDesign();
    const current = await reload(design.id);
    const jobId = await enqueueJob(
      env,
      'qr_export',
      { designId: design.id, expectedUpdatedAt: current.updatedAt },
      'qredit@gmail.com',
      {
        blobs: {
          pdf: bytesToBase64(pdfBytes()),
          png: bytesToBase64(pngBytes()),
          preview: bytesToBase64(pngBytes(9, 30000, 30000)),
          reason: '',
        },
      },
    );
    await runPendingJobs(env);
    const job = (await jsonOf(await rest.get(`/jobs/${jobId}`, { email: 'qredit@gmail.com' }))) as {
      status: string;
    };
    expect(job.status).toBe('failed');
    expect(await stickers()).toHaveLength(0);
    expect(await versions(design.id)).toHaveLength(0);
    const live = [...env.BRIDGE.state.files.values()].filter((file) => !file.trashed);
    expect(live.some((file) => EXPORT_NAME.test(file.name))).toBe(false);
  });
});

describe('komit ekspor hanya menulis kolom hasil ekspor', () => {
  test('overflow yang dilaporkan peramban di antara muat dan komit tidak tertimpa', async () => {
    const design = await makeDesign();
    const current = await reload(design.id);
    const accepted = await exportDesign(current);
    expect(accepted.status).toBe(202);
    const { jobId } = (await jsonOf(accepted)) as { jobId: string };
    for (let step = 0; step < 3; step++) await runJobStep(env, jobId, 1);
    // Langkah komit sudah memuat konfigurasi (overflow kosong) lalu menunggu kunci; peramban melapor overflow
    // (UPDATE overflow saja, updated_at tidak naik) sebelum komit berjalan.
    const { out } = await whileLocked(
      { sql: DESIGN_LOCK, id: design.id },
      async (tx) => {
        await tx.prepare("UPDATE qr_designs SET overflow = '1' WHERE id = ?").bind(design.id).run();
      },
      () => runJobStep(env, jobId, 1),
    );
    expect(out.kind).toBe('advanced');
    const row = await env.DB.prepare('SELECT overflow, exported_hash FROM qr_designs WHERE id = ?')
      .bind(design.id)
      .first<{ overflow: string; exported_hash: string }>();
    expect(row?.overflow.trim()).toBe('1');
    expect(row?.exported_hash.trim()).not.toBe('');
  });
});
