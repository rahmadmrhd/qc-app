import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { JOB_MAX_ATTEMPTS, runJobStep } from '@server/modules/jobs/consumer';
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

/** PNG sah 4x3 piksel (hanya IHDR yang dibaca server) dengan isi acak tambahan. */
function pngBytes(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + seed) % 256;
  bytes.set(PNG_HEAD, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // panjang IHDR
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 4); // lebar
  view.setUint32(20, 3); // tinggi
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

  test('dua ekspor ulang serentak dengan label berubah: tepat satu versi baru', async () => {
    const design = await makeDesign();
    await exportOk(design);
    await relabel(design, 'Label Baru');
    const current = await reload(design.id);
    const [a, b] = await Promise.all([
      exportDesign(current, { reason: 'A' }),
      exportDesign(current, { reason: 'B' }),
    ]);
    expect([a.status, b.status].every((status) => status === 202 || status === 412)).toBe(true);
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
