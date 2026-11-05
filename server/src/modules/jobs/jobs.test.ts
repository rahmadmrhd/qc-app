import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DbStatement } from '@server/core/db';
import app from '@server/index';
import { cleanupQrDocuments } from '@server/modules/qrcode/service';
import { scheduled } from '@server/scheduled';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { CLEANUP_REVOKE_LIMIT } from './cleanup';
import { handleQueue, JOB_MAX_ATTEMPTS, processJobMessage } from './consumer';
import { findJob } from './repo';
import { enqueueJob } from './service';

const PDF = 'JVBERi0xLjQK';
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let env: TestEnv;
const realError = console.error;
let logged: string[];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
  logged = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
});
afterEach(() => {
  console.error = realError;
});

const call = (email: string, method: string, payload: unknown) =>
  qrRpc(env, email, method, payload);

async function makeDesign() {
  const out = await call('qredit@gmail.com', 'qrcodes.save', {
    title: 'Panduan',
    linkSource: 'pdf',
    link: '',
    documentId: await qrPdfDocumentId(env),
    subtitle: 'Sub',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
  });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out.data as { id: string; updatedAt: string };
}
const exportBody = (
  design: { id: string; updatedAt: string },
  extra: Record<string, unknown> = {},
) => ({
  id: design.id,
  expectedUpdatedAt: design.updatedAt,
  pdfBase64: PDF,
  pngBase64: PNG,
  ...extra,
});
const requestExport = (
  design: { id: string; updatedAt: string },
  extra: Record<string, unknown> = {},
  email = 'qredit@gmail.com',
) => call(email, 'qrcodes.export', exportBody(design, extra));

/** Memproses semua pesan antrean berurutan (tiap pesan = satu langkah). */
async function drain(attempts = 1, max = 100): Promise<number> {
  let processed = 0;
  while (env.queued.length > 0 && processed < max) {
    const message = env.queued.shift();
    if (!message) break;
    const outcome = await processJobMessage(env, message, attempts);
    processed += 1;
    if (outcome.kind === 'retry') env.queued.unshift(message);
  }
  return processed;
}
async function design(id: string) {
  return env.DB.prepare(
    'SELECT export_pdf_drive_id, export_png_drive_id, exported_hash, exported_at, exported_by FROM qr_designs WHERE id = ?',
  )
    .bind(id)
    .first<{
      export_pdf_drive_id: string;
      export_png_drive_id: string;
      exported_hash: string;
      exported_at: string;
      exported_by: string;
    }>();
}
async function audits() {
  const rows = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
    action: string;
  }>();
  return rows.results.map((r) => r.action);
}
async function blobCount(jobId?: string) {
  const row = await (jobId
    ? env.DB.prepare('SELECT COUNT(*) AS n FROM job_blobs WHERE job_id = ?').bind(jobId)
    : env.DB.prepare('SELECT COUNT(*) AS n FROM job_blobs')
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
/** Berkas hasil ekspor = berkas di folder QR (bukan PDF sumber di folder dokumen). */
async function exportFiles() {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'QR_FOLDER_ID'").first<{
    value: string;
  }>();
  return [...env.BRIDGE.state.files.entries()]
    .filter(([, file]) => file.folderId === row?.value)
    .map(([id, file]) => ({ id, ...file }));
}
const createCalls = () => env.BRIDGE.calls.filter((c) => c.action === 'createFile');

describe('qrcodes.export dan jobs.get', () => {
  test('RPC hanya mengantre: balas { jobId }, pesan hanya { jobId, kind, step }, muatan di job_blobs, belum ada berkas', async () => {
    const made = await makeDesign();
    const filesBefore = createCalls().length;
    const out = await requestExport(made);
    expect(out.ok).toBe(true);
    expect(Object.keys(out.data)).toEqual(['jobId']);
    expect(env.queued).toEqual([{ jobId: out.data.jobId, kind: 'qr_export', step: 0 }]);
    expect(JSON.stringify(env.queued)).not.toContain(PDF);
    expect(createCalls()).toHaveLength(filesBefore);
    expect(await blobCount(out.data.jobId)).toBe(2);
    expect((await design(made.id))?.exported_hash).toBe('');
    const job = await call('qredit@gmail.com', 'jobs.get', { id: out.data.jobId });
    expect(job.data).toEqual({
      id: out.data.jobId,
      kind: 'qr_export',
      status: 'queued',
      progress: 0,
    });
  });

  test('izin RPC: butuh edit; pemeriksaan awal: tak dikenal, versi basi, overflow, terlalu besar', async () => {
    const made = await makeDesign();
    expect((await requestExport(made, {}, 'qrview@gmail.com')).error.code).toBe('FORBIDDEN');
    expect((await requestExport({ id: 'x', updatedAt: made.updatedAt })).error.code).toBe(
      'NOT_FOUND',
    );
    expect(
      (await requestExport({ ...made, updatedAt: '2020-01-01T00:00:00.000Z' })).error.code,
    ).toBe('CONFLICT');
    const big = await requestExport(made, { pngBase64: `iVBORw0KGgo${'A'.repeat(1_100_000)}` });
    expect(big.error.code).toBe('VALIDATION');
    expect(env.queued).toHaveLength(0);
    await env.DB.prepare("UPDATE qr_designs SET overflow = '1' WHERE id = ?").bind(made.id).run();
    const over = await requestExport(made);
    expect(over.error.code).toBe('VALIDATION');
    expect(over.error.message).toContain('melebihi kanvas');
    expect(env.queued).toHaveLength(0);
  });

  test('klik ganda dengan versi yang sama memakai job yang masih berjalan (tanpa job/berkas ganda)', async () => {
    const made = await makeDesign();
    const a = await requestExport(made);
    const b = await requestExport(made);
    expect(b.data.jobId).toBe(a.data.jobId);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs').first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect(env.queued).toHaveLength(1);
  });

  test('jobs.get: pembuat dan pengguna qrcode boleh; orang lain tanpa qrcode NOT_FOUND; id tak dikenal NOT_FOUND', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    expect((await call('qredit@gmail.com', 'jobs.get', { id: jobId })).ok).toBe(true);
    expect((await call('qrview@gmail.com', 'jobs.get', { id: jobId })).ok).toBe(true);
    expect((await call('noqr@gmail.com', 'jobs.get', { id: jobId })).error.code).toBe('NOT_FOUND');
    expect((await call('qredit@gmail.com', 'jobs.get', { id: 'tidak-ada' })).error.code).toBe(
      'NOT_FOUND',
    );
    expect((await call('qredit@gmail.com', 'jobs.get', {})).error.code).toBe('VALIDATION');
  });
});

describe('ekspor QR berjalan per langkah', () => {
  test('job selesai: progres bertahap, berkas di folder QR, desain tercatat, audit, muatan dibuang, file terbaca', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    const seen: number[] = [];
    while (env.queued.length > 0) {
      const message = env.queued.shift();
      if (!message) break;
      await processJobMessage(env, message, 1);
      seen.push((await findJob(env, jobId))?.progress ?? -1);
    }
    expect(seen).toEqual([30, 60, 90, 100]);
    const job = await call('qredit@gmail.com', 'jobs.get', { id: jobId });
    expect(job.data).toMatchObject({ status: 'done', progress: 100 });
    expect(JSON.parse(job.data.result)).toEqual({ designId: made.id });
    const row = await design(made.id);
    expect(row?.exported_hash).not.toBe('');
    expect(row?.exported_by).toBe('qredit@gmail.com');
    const pdf = env.BRIDGE.state.files.get(row?.export_pdf_drive_id ?? '');
    const png = env.BRIDGE.state.files.get(row?.export_png_drive_id ?? '');
    expect(pdf).toMatchObject({ mime: 'application/pdf', base64: PDF });
    expect(png).toMatchObject({ mime: 'image/png', base64: PNG });
    expect(pdf?.name).toMatch(/-20261016030000000\.pdf$|-\d+\.pdf$/);
    expect(await audits()).toEqual(['qrcode.create', 'qrcode.export']);
    expect(await blobCount()).toBe(0);
    const state = (await call('qrview@gmail.com', 'qrcodes.get', { id: made.id })).data;
    expect(state.exportStatus).toBe('current');
    const file = await call('qrview@gmail.com', 'qrcodes.file', { id: made.id, kind: 'pdf' });
    expect(file.data).toMatchObject({ mime: 'application/pdf', base64: PDF });
  });

  test('ekspor ulang membuang berkas lama (best effort) dan tidak menyisakan berkas ganda', async () => {
    const made = await makeDesign();
    await requestExport(made);
    await drain();
    const first = await design(made.id);
    env.clock.advance(60_000);
    // konfigurasi tidak berubah (updatedAt sama) -> ekspor lagi diperbolehkan
    await requestExport(made, { pdfBase64: 'JVBERi0xLjUK' });
    await drain();
    const second = await design(made.id);
    expect(second?.export_pdf_drive_id).not.toBe(first?.export_pdf_drive_id);
    expect(env.BRIDGE.state.files.get(first?.export_pdf_drive_id ?? '')?.trashed).toBe(true);
    expect(env.BRIDGE.state.files.get(first?.export_png_drive_id ?? '')?.trashed).toBe(true);
    expect(env.BRIDGE.state.files.get(second?.export_pdf_drive_id ?? '')).toMatchObject({
      trashed: false,
      base64: 'JVBERi0xLjUK',
    });
    expect(await audits()).toEqual(['qrcode.create', 'qrcode.export', 'qrcode.export']);
  });
});

describe('Review Focus 2: kegagalan di tengah dan pesan ganda', () => {
  test('galat jembatan sementara di langkah PNG: dicoba ulang; PDF tidak dibuat dua kali', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    const baseline = createCalls().length;
    // langkah 0 (PDF) sukses
    await processJobMessage(env, env.queued.shift()!, 1);
    env.BRIDGE.failNext('createFile', new Error('jaringan putus'));
    const failing = await processJobMessage(env, env.queued.shift()!, 1);
    expect(failing.kind).toBe('retry');
    expect((await findJob(env, jobId))?.status).toBe('running');
    expect((await findJob(env, jobId))?.leaseUntil).toBe(0);
    // pesan dikirim ulang oleh Queues: langkah PNG diulang, PDF dilewati
    await processJobMessage(env, { jobId, kind: 'qr_export', step: 1 }, 2);
    await drain(1);
    expect((await findJob(env, jobId))?.status).toBe('done');
    expect(createCalls().length - baseline).toBe(3); // pdf (1x) + png (percobaan gagal + berhasil)
    const pdfCreates = createCalls()
      .slice(baseline)
      .filter((c) => String(c.args[1]).endsWith('.pdf'));
    expect(pdfCreates).toHaveLength(1);
  });

  test('gagal permanen setelah percobaan habis: status failed + pesan, berkas baru dibuang, berkas lama utuh, muatan dibuang', async () => {
    const made = await makeDesign();
    await requestExport(made);
    await drain();
    const before = await design(made.id);
    const second = (await requestExport(made, { pdfBase64: 'JVBERi0xLjUK' })).data.jobId;
    await processJobMessage(env, env.queued.shift()!, 1); // PDF baru dibuat
    const created = [...env.BRIDGE.state.files.keys()].filter(
      (id) =>
        ![before?.export_pdf_drive_id, before?.export_png_drive_id].includes(id) &&
        env.BRIDGE.state.files.get(id)?.base64 === 'JVBERi0xLjUK',
    );
    expect(created).toHaveLength(1);
    env.BRIDGE.createFile = async () => {
      throw new Error('jembatan mati');
    };
    const outcome = await processJobMessage(env, env.queued.shift()!, JOB_MAX_ATTEMPTS);
    expect(outcome.kind).toBe('ack');
    const job = await call('qredit@gmail.com', 'jobs.get', { id: second });
    expect(job.data.status).toBe('failed');
    expect(job.data.error).toBeTruthy();
    expect(JSON.stringify(job.data)).not.toContain('jembatan mati');
    expect(env.BRIDGE.state.files.get(created[0] ?? '')?.trashed).toBe(true);
    expect(await design(made.id)).toEqual(before);
    expect(env.BRIDGE.state.files.get(before?.export_pdf_drive_id ?? '')?.trashed).toBe(false);
    expect(await blobCount(second)).toBe(0);
  });

  test('ulang via qrcodes.export setelah gagal aman: job baru selesai tanpa menggandakan berkas hasil', async () => {
    const made = await makeDesign();
    const failed = (await requestExport(made)).data.jobId;
    env.BRIDGE.failNext('createFile', new Error('x'));
    await processJobMessage(env, env.queued.shift()!, JOB_MAX_ATTEMPTS);
    expect((await findJob(env, failed))?.status).toBe('failed');
    const retry = await requestExport(made);
    expect(retry.data.jobId).not.toBe(failed);
    await drain();
    expect((await findJob(env, retry.data.jobId))?.status).toBe('done');
    const live = (await exportFiles()).filter((f) => !f.trashed);
    expect(live.map((f) => f.name.slice(-4)).sort()).toEqual(['.pdf', '.png']);
  });

  test('versi konfigurasi berubah sebelum pencatatan: CONFLICT, job gagal, berkas baru dibuang, desain tidak ter-ekspor', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    await processJobMessage(env, env.queued.shift()!, 1);
    await processJobMessage(env, env.queued.shift()!, 1);
    env.clock.advance(1000);
    await env.DB.prepare(
      "UPDATE qr_designs SET updated_at = '2026-10-16T03:10:00.000Z' WHERE id = ?",
    )
      .bind(made.id)
      .run();
    await processJobMessage(env, env.queued.shift()!, 1);
    const job = await findJob(env, jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('diubah orang lain');
    expect((await design(made.id))?.exported_hash).toBe('');
    const exports = await exportFiles();
    expect(exports).toHaveLength(2);
    expect(exports.every((f) => f.trashed)).toBe(true);
    expect(await audits()).toEqual(['qrcode.create']);
  });

  test('pesan terkirim ganda/serentak (at-least-once): langkah berjalan sekali, hasil tidak digandakan', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    const message = env.queued[0]!;
    const baseline = createCalls().length;
    const [a, b, c] = await Promise.all([
      processJobMessage(env, message, 1),
      processJobMessage(env, message, 1),
      processJobMessage(env, message, 1),
    ]);
    expect([a, b, c].every((o) => o.kind === 'ack')).toBe(true);
    expect(createCalls().length - baseline).toBe(1);
    // pesan lanjutan ganda juga aman; seluruh job tetap selesai tepat sekali
    env.queued.push({ ...message });
    env.queued.push({ ...message });
    await drain();
    expect((await findJob(env, jobId))?.status).toBe('done');
    expect(createCalls().length - baseline).toBe(2);
    expect((await audits()).filter((x) => x === 'qrcode.export')).toHaveLength(1);
    // pesan setelah job selesai tidak berbuat apa pun
    expect((await processJobMessage(env, message, 1)).kind).toBe('ack');
    expect(createCalls().length - baseline).toBe(2);
  });

  test('pesan lanjutan gagal terkirim: langkah tersimpan, pesan asli dikirim ulang dan melanjutkan tanpa menggandakan', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    const first = env.queued.shift()!;
    const realSend = env.JOBS.send.bind(env.JOBS);
    env.JOBS.send = async () => {
      throw new Error('antrean down');
    };
    const outcome = await processJobMessage(env, first, 1);
    expect(outcome.kind).toBe('retry');
    expect((await findJob(env, jobId))?.step).toBe(1);
    env.JOBS.send = realSend;
    await processJobMessage(env, first, 2); // redelivery: melanjutkan ke langkah 1
    await drain();
    expect((await findJob(env, jobId))?.status).toBe('done');
    expect((await exportFiles()).filter((f) => f.name.endsWith('.pdf'))).toHaveLength(1);
  });

  test('pengolah yang mati meninggalkan lease: setelah lease habis, pengolah lain mengambil alih', async () => {
    const made = await makeDesign();
    const { jobId } = (await requestExport(made)).data;
    await env.DB.prepare("UPDATE jobs SET status = 'running', lease_until = ? WHERE id = ?")
      .bind(env.clock.now() + 60_000, jobId)
      .run();
    expect((await processJobMessage(env, env.queued[0]!, 1)).kind).toBe('ack');
    expect((await findJob(env, jobId))?.step).toBe(0);
    env.clock.advance(61_000);
    await processJobMessage(env, env.queued[0]!, 1);
    expect((await findJob(env, jobId))?.step).toBe(1);
  });

  test('enqueue gagal kirim: job ditandai gagal dan UNAVAILABLE dilempar (tidak menggantung queued)', async () => {
    env.JOBS.send = async () => {
      throw new Error('antrean down');
    };
    await expect(enqueueJob(env, 'cleanup_qr', {}, 'system')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    const row = await env.DB.prepare('SELECT status FROM jobs').first<{ status: string }>();
    expect(row?.status).toBe('failed');
  });
});

describe('cleanup_qr dan cron', () => {
  async function orphanDocs(count: number) {
    for (let i = 0; i < count; i++) await qrPdfDocumentId(env);
    env.clock.advance(2 * 60 * 60 * 1000);
  }
  const sharedCount = () => [...env.BRIDGE.state.files.values()].filter((f) => f.shared).length;

  test('scheduled hanya menjadwalkan (satu pesan cleanup_qr), tidak menumpuk', async () => {
    const calls = env.BRIDGE.calls.length;
    await scheduled(
      {
        cron: '0 * * * *',
        scheduledTime: env.clock.now(),
        type: 'scheduled',
      } as unknown as ScheduledController,
      env,
    );
    await scheduled(
      {
        cron: '0 * * * *',
        scheduledTime: env.clock.now(),
        type: 'scheduled',
      } as unknown as ScheduledController,
      env,
    );
    expect(env.queued).toHaveLength(1);
    expect(env.queued[0]).toMatchObject({ kind: 'cleanup_qr', step: 0 });
    expect(env.BRIDGE.calls.length).toBe(calls);
  });

  test('mencabut berbagi PDF yatim dalam potongan <= N per pesan, berlanjut sampai habis', async () => {
    await orphanDocs(CLEANUP_REVOKE_LIMIT * 2 + 1);
    expect(sharedCount()).toBe(CLEANUP_REVOKE_LIMIT * 2 + 1);
    const { jobId } = await enqueueJob(env, 'cleanup_qr', {}, 'system');
    await processJobMessage(env, env.queued.shift()!, 1);
    expect(sharedCount()).toBe(CLEANUP_REVOKE_LIMIT + 1);
    expect(env.queued).toHaveLength(1);
    await drain();
    expect(sharedCount()).toBe(0);
    const job = await findJob(env, jobId);
    expect(job?.status).toBe('done');
    expect(JSON.parse(job?.result ?? '{}').revoked).toBe(CLEANUP_REVOKE_LIMIT * 2 + 1);
  });

  test('membuang muatan job selesai/gagal dan riwayat lama; berkas ekspor yatim dari job gagal dibuang', async () => {
    const made = await makeDesign();
    const failed = (await requestExport(made)).data.jobId;
    await processJobMessage(env, env.queued.shift()!, 1); // PDF dibuat
    const orphanId = (await exportFiles())[0]?.id ?? '';
    expect(orphanId).not.toBe('');
    const realTrash = env.BRIDGE.trashFile;
    env.BRIDGE.trashFile = async () => {
      throw new Error('Drive menolak');
    };
    env.BRIDGE.failNext('createFile', new Error('x'));
    await processJobMessage(env, env.queued.shift()!, JOB_MAX_ATTEMPTS);
    expect((await findJob(env, failed))?.status).toBe('failed');
    expect(env.BRIDGE.state.files.get(orphanId)?.trashed).toBe(false);
    env.BRIDGE.trashFile = realTrash;
    env.queued.length = 0;
    env.clock.advance(2 * 60 * 60 * 1000);
    await enqueueJob(env, 'cleanup_qr', {}, 'system');
    await drain();
    expect(env.BRIDGE.state.files.get(orphanId)?.trashed).toBe(true);
    // riwayat > 7 hari dihapus, kecuali yang masih punya yatim
    env.clock.advance(8 * 24 * 60 * 60 * 1000);
    await enqueueJob(env, 'cleanup_qr', {}, 'system');
    await drain();
    expect(await findJob(env, failed)).toBeNull();
    expect(await blobCount()).toBe(0);
  });

  test('cleanupQrDocuments tetap dapat dipanggil langsung (kompatibel dengan cron lama)', async () => {
    await orphanDocs(2);
    expect(await cleanupQrDocuments(env, 10)).toBe(2);
  });
});

describe('ekspor Spreadsheet (sheets_export)', () => {
  async function seedBrands(n: number) {
    const statements: DbStatement[] = [];
    for (let i = 0; i < n; i++) {
      statements.push(
        env.DB.prepare('INSERT INTO brands (id, name, key, sync_rev) VALUES (?, ?, ?, ?)').bind(
          `b${String(i).padStart(5, '0')}`,
          `Merk ${i}`,
          `merk ${i}`,
          i,
        ),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  }

  test('1.200 baris: potongan 500/500/200, replace lalu append, urutan terjaga, progres, selesai', async () => {
    await seedBrands(1200);
    const { jobId } = await enqueueJob(
      env,
      'sheets_export',
      { tables: ['brands'] },
      'qredit@gmail.com',
    );
    await drain();
    const job = await findJob(env, jobId);
    expect(job?.status).toBe('done');
    expect(env.BRIDGE.state.exports.map((c) => `${c.mode}:${c.rows.length}`)).toEqual([
      'replace:500',
      'append:500',
      'append:200',
    ]);
    expect(env.BRIDGE.state.exports.every((c) => c.sheet === 'export_brands')).toBe(true);
    const ids = env.BRIDGE.state.exports.flatMap((c) => c.rows.map((r) => r[0]));
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(1200);
  });

  test('semua tabel dalam beberapa langkah kecil; pesan ganda tidak menggandakan potongan', async () => {
    await seedBrands(30);
    const { jobId } = await enqueueJob(env, 'sheets_export', {}, 'qredit@gmail.com');
    const first = { ...env.queued[0]! };
    await Promise.all([processJobMessage(env, first, 1), processJobMessage(env, { ...first }, 1)]);
    const afterFirst = env.BRIDGE.state.exports.length;
    expect(afterFirst).toBeLessThanOrEqual(4);
    await drain();
    expect((await findJob(env, jobId))?.status).toBe('done');
    const sheets = new Set(env.BRIDGE.state.exports.map((c) => c.sheet));
    expect(sheets.size).toBe(15);
    expect(
      env.BRIDGE.state.exports.filter((c) => c.sheet === 'export_brands').map((c) => c.mode),
    ).toEqual(['replace']);
  });

  test('galat jembatan di tengah: dicoba ulang dari langkah yang sama; replace pertama tidak diulang tak perlu', async () => {
    await seedBrands(10);
    const { jobId } = await enqueueJob(
      env,
      'sheets_export',
      { tables: ['brands', 'users'] },
      'qredit@gmail.com',
    );
    env.BRIDGE.failNext('sheetsExport', new Error('gangguan'));
    const outcome = await processJobMessage(env, env.queued.shift()!, 1);
    expect(outcome.kind).toBe('retry');
    env.queued.push({ jobId, kind: 'sheets_export', step: 0 });
    await drain();
    expect((await findJob(env, jobId))?.status).toBe('done');
  });
});

describe('Worker default export dan consumer', () => {
  test('default export memiliki fetch, queue, scheduled', () => {
    expect(typeof app.fetch).toBe('function');
    expect(typeof app.queue).toBe('function');
    expect(typeof app.scheduled).toBe('function');
  });

  test('handleQueue: ack bila selesai, retry dengan jeda bila galat sementara', async () => {
    const made = await makeDesign();
    await requestExport(made);
    const acks: string[] = [];
    const retries: number[] = [];
    const message = (body: (typeof env.queued)[number]) => ({
      body,
      attempts: 1,
      ack: () => acks.push(body.jobId),
      retry: (options?: { delaySeconds?: number }) => retries.push(options?.delaySeconds ?? 0),
    });
    const batch = { messages: [message(env.queued.shift()!)] } as unknown as MessageBatch<
      (typeof env.queued)[number]
    >;
    await handleQueue(batch, env);
    expect(acks).toHaveLength(1);
    env.BRIDGE.failNext('createFile', new Error('x'));
    const next = env.queued.shift()!;
    await handleQueue({ messages: [message(next)] } as unknown as MessageBatch<typeof next>, env);
    expect(retries).toEqual([20]);
  });
});
