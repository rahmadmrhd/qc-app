import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DbStatement } from '@server/core/db';
import { putSetting } from '@server/core/settings';
import { JOB_MAX_ATTEMPTS } from '@server/modules/jobs/consumer';
import { findJob } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { qrCall, seedQrEnv } from '@server-test/qrcode-env';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  purgeExpiredRateLimits,
  runPendingJobs,
  scheduleCleanupJob,
  startJobRunner,
  startScheduler,
} from './runner';

let env: TestEnv;
const realError = console.error;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedQrEnv(env);
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedBrands(n: number) {
  const statements: DbStatement[] = [];
  for (let i = 0; i < n; i++) {
    statements.push(
      env.DB.prepare('INSERT INTO brands (id, name, `key`) VALUES (?, ?, ?)').bind(
        `b${String(i).padStart(5, '0')}`,
        `Merk ${i}`,
        `merk ${i}`,
      ),
    );
  }
  await env.DB.batch(statements);
}

async function countJobs(kind: string, statuses = ['queued', 'running']) {
  const marks = statuses.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE kind = ? AND status IN (${marks})`,
  )
    .bind(kind, ...statuses)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await sleep(15);
  }
  throw new Error('waitFor: batas waktu habis');
}

describe('enqueueJob dan runPendingJobs', () => {
  test('enqueueJob menyisipkan baris queued (tanpa Queue) dan mengembalikan id', async () => {
    const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
    expect(typeof id).toBe('string');
    const job = await findJob(env, id);
    expect(job).toMatchObject({
      kind: 'cleanup_qr',
      status: 'queued',
      createdBy: JOB_SYSTEM_ACTOR,
      step: 0,
      leaseUntil: 0,
    });
  });

  test('menyelesaikan job cleanup_qr dan mengembalikan jumlah job yang dijalankan', async () => {
    const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
    expect(await runPendingJobs(env)).toBe(1);
    const job = await findJob(env, id);
    expect(job?.status).toBe('done');
    expect(JSON.parse(job?.result ?? '')).toEqual({ revoked: 0, purged: 0, orphans: 0 });
    expect(await runPendingJobs(env)).toBe(0);
  });

  test('menyelesaikan job sheets_export lewat jembatan palsu', async () => {
    await seedBrands(30);
    const id = await enqueueJob(env, 'sheets_export', { tables: ['brands'] }, 'qredit@gmail.com');
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, id))?.status).toBe('done');
    expect(env.BRIDGE.state.exports.map((c) => `${c.sheet}:${c.mode}:${c.rows.length}`)).toEqual([
      'export_brands:replace:30',
    ]);
  });

  test('muatan besar ikut di job_blobs; pembersihan berikutnya membuangnya setelah job selesai', async () => {
    const countBlobs = async (jobId: string) =>
      Number(
        (
          await env.DB.prepare('SELECT COUNT(*) AS n FROM job_blobs WHERE job_id = ?')
            .bind(jobId)
            .first<{ n: number }>()
        )?.n,
      );
    const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR, {
      blobs: { pdf: 'JVBERi0xLjQK' },
    });
    expect(await countBlobs(id)).toBe(1);
    await runPendingJobs(env);
    expect((await findJob(env, id))?.status).toBe('done');
    expect(await countBlobs(id)).toBe(1); // job yang sedang berjalan belum selesai saat pembersihan
    await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
    await runPendingJobs(env);
    expect(await countBlobs(id)).toBe(0);
  });

  test('tiga runPendingJobs paralel tidak menjalankan job yang sama dua kali', async () => {
    await seedBrands(5);
    const id = await enqueueJob(env, 'sheets_export', { tables: ['brands'] }, 'qredit@gmail.com');
    const [a, b, c] = await Promise.all([
      runPendingJobs(env),
      runPendingJobs(env),
      runPendingJobs(env),
    ]);
    expect(a + b + c).toBe(1);
    expect((await findJob(env, id))?.status).toBe('done');
    // satu langkah ekspor = satu potongan `replace`; pemrosesan ganda akan menggandakannya
    expect(env.BRIDGE.state.exports).toHaveLength(1);
  });

  test('banyak job berurutan menurut waktu dibuat; yang selesai tidak diulang', async () => {
    await seedBrands(3);
    const first = await enqueueJob(env, 'sheets_export', { tables: ['brands'] }, 'a@x.com');
    env.clock.advance(1000);
    const second = await enqueueJob(env, 'sheets_export', { tables: ['users'] }, 'a@x.com');
    expect(await runPendingJobs(env)).toBe(2);
    expect((await findJob(env, first))?.status).toBe('done');
    expect((await findJob(env, second))?.status).toBe('done');
    expect(env.BRIDGE.state.exports.map((c) => c.sheet)).toEqual(['export_brands', 'export_users']);
  });

  test('job running yang lease-nya habis (proses mati) diambil alih; yang lease-nya aktif dilewati', async () => {
    const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
    await env.DB.prepare("UPDATE jobs SET status = 'running', lease_until = ? WHERE id = ?")
      .bind(env.clock.now() + 60_000, id)
      .run();
    expect(await runPendingJobs(env)).toBe(0);
    expect((await findJob(env, id))?.status).toBe('running');
    env.clock.advance(61_000);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, id))?.status).toBe('done');
  });
});

describe('job gagal', () => {
  test('galat sementara: ditunda lalu dicoba ulang; setelah percobaan habis dicatat failed dengan pesan', async () => {
    await seedBrands(3);
    const id = await enqueueJob(env, 'sheets_export', { tables: ['brands'] }, 'qredit@gmail.com');
    env.BRIDGE.sheetsExport = async () => {
      throw new Error('gangguan');
    };
    // percobaan 1: gagal sementara -> belum failed, ditunda (lease di masa depan)
    expect(await runPendingJobs(env)).toBe(1);
    const afterFirst = await findJob(env, id);
    expect(afterFirst?.status).toBe('running');
    expect(afterFirst?.leaseUntil).toBeGreaterThan(env.clock.now());
    // belum jatuh tempo: tidak dijalankan lagi
    expect(await runPendingJobs(env)).toBe(0);
    for (let attempt = 2; attempt <= JOB_MAX_ATTEMPTS; attempt++) {
      env.clock.advance(5 * 60_000);
      expect(await runPendingJobs(env)).toBe(1);
    }
    const failed = await findJob(env, id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).not.toBe('');
    // dilihat lewat `jobs.get` oleh pembuatnya
    const dto = await qrCall(env, 'qredit@gmail.com', 'jobs.get', { id });
    expect(dto.data).toMatchObject({ id, status: 'failed' });
    expect(dto.data.error).toBe(failed?.error);
  });

  test('job yang gagal dapat diulang manual: permintaan baru membuat job baru yang selesai', async () => {
    await seedBrands(3);
    const first = await enqueueJob(env, 'sheets_export', { tables: ['brands'] }, 'admin@gmail.com');
    await env.DB.prepare("UPDATE jobs SET status = 'failed', error = 'Gagal tes' WHERE id = ?")
      .bind(first)
      .run();
    const retry = await qrCall(env, 'admin@gmail.com', 'exports.sheets', { tables: ['brands'] });
    expect(retry.ok).toBe(true);
    expect(retry.data.jobId).not.toBe(first);
    expect(await runPendingJobs(env)).toBe(1);
    expect((await findJob(env, retry.data.jobId))?.status).toBe('done');
    expect((await findJob(env, first))?.status).toBe('failed');
  });
});

describe('startJobRunner', () => {
  test('memproses job yang masuk secara berkala dan berhenti setelah fungsi penghenti dipanggil', async () => {
    const stop = startJobRunner(env, { intervalMs: 10 });
    try {
      const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
      await waitFor(async () => (await findJob(env, id))?.status === 'done');
    } finally {
      await stop();
    }
    // fungsi penghenti sudah menunggu putaran yang sedang berjalan selesai
    const later = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
    await sleep(100);
    expect((await findJob(env, later))?.status).toBe('queued');
  });

  test('galat di satu putaran dicatat dan tidak menghentikan runner', async () => {
    const logged: string[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args.join(' '));
    };
    const realPrepare = env.DB.prepare.bind(env.DB);
    let broken = true;
    // salinan DB (bukan mengubah objek bersama antar-tes) yang gagal membaca daftar job selama `broken`
    const flaky = {
      ...env.DB,
      prepare: (sql: string) => {
        if (broken && sql.includes('FROM jobs WHERE status IN')) throw new Error('db putus');
        return realPrepare(sql);
      },
    };
    const stop = startJobRunner({ ...env, DB: flaky }, { intervalMs: 10 });
    try {
      await waitFor(async () => logged.some((line) => line.includes('db putus')));
      broken = false;
      const id = await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
      await waitFor(async () => (await findJob(env, id))?.status === 'done');
    } finally {
      await stop();
    }
  });
});

describe('penjadwal', () => {
  test('scheduleCleanupJob tidak menumpuk cleanup_qr selama masih ada yang aktif', async () => {
    const first = await scheduleCleanupJob(env);
    const second = await scheduleCleanupJob(env);
    expect(typeof first).toBe('string');
    expect(second).toBeNull();
    expect(await countJobs('cleanup_qr')).toBe(1);
    await runPendingJobs(env);
    expect(typeof (await scheduleCleanupJob(env))).toBe('string'); // setelah selesai boleh yang baru
  });

  test('startScheduler berdetak berkala tetapi hanya menyisipkan satu cleanup_qr aktif', async () => {
    const stop = startScheduler(env, { intervalMs: 10 });
    try {
      await waitFor(async () => (await countJobs('cleanup_qr')) === 1);
      await sleep(100); // banyak detak berlalu
      expect(await countJobs('cleanup_qr')).toBe(1);
    } finally {
      await stop();
    }
  });
});

describe('penjadwal: cadangan harian (T30)', () => {
  test('tanpa BACKUP_ENABLED penjadwal tidak pernah menyisipkan job db_backup', async () => {
    const stop = startScheduler(env, { intervalMs: 10 });
    try {
      await waitFor(async () => (await countJobs('cleanup_qr')) === 1);
      await sleep(60);
      expect(await countJobs('db_backup')).toBe(0);
    } finally {
      await stop();
    }
  });

  test('dengan BACKUP_ENABLED dan lewat 02:00 WIB: satu job db_backup, tidak menumpuk', async () => {
    const stop = startScheduler({ ...env, BACKUP_ENABLED: true }, { intervalMs: 10 });
    try {
      await waitFor(async () => (await countJobs('db_backup')) === 1);
      await sleep(60);
      expect(await countJobs('db_backup')).toBe(1);
    } finally {
      await stop();
    }
  });
});

describe('penjadwal: ringkasan stok stiker menipis (4a)', () => {
  test('detak penjadwal memanggil ringkasan harian: satu surel ke penerima Konfigurasi Stiker, tidak berulang pada hari yang sama', async () => {
    const sent: string[] = [];
    await putSetting(
      env,
      'STICKER_ALERT',
      JSON.stringify({
        enabled: true,
        recipients: ['a@contoh.com'],
        digestHour: 8,
        updatedAt: 't',
      }),
    );
    await seedStickerType(env, { id: 't1', name: 'QC' });
    await seedSticker(env, { id: 's1', typeId: 't1', name: 'Stiker A', minQty: 10 });
    env.clock.set(Date.parse('2026-11-10T02:00:00.000Z')); // 09:00 WIB
    const stop = startScheduler(
      {
        ...env,
        MAILER: {
          async send(message) {
            sent.push(message.subject);
          },
        },
      },
      { intervalMs: 10 },
    );
    try {
      await waitFor(async () => sent.length === 1);
      await sleep(80);
      expect(sent).toEqual(['Stok stiker menipis (1)']);
    } finally {
      await stop();
    }
  });
});

describe('pembersihan rate_limits (I4)', () => {
  const MINUTE = 60_000;
  const seedLimit = (key: string, count: number, windowStart: number) =>
    env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, ?, ?)')
      .bind(key, count, windowStart)
      .run();
  const limitKeys = async () =>
    (
      await env.DB.prepare('SELECT `key` FROM rate_limits ORDER BY `key`').all<{ key: string }>()
    ).results.map((row) => row.key);

  test('purgeExpiredRateLimits membuang baris yang jendelanya (terbesar: blokir 10 menit) sudah lewat saja', async () => {
    const now = env.clock.now();
    await seedLimit('sync:fails:basi', 3, now - 11 * MINUTE);
    await seedLimit('sync:blocked:basi', 1, now - 10 * MINUTE - 1);
    await seedLimit('sync:blocked:aktif', 1, now - 9 * MINUTE);
    await seedLimit('sync:fails:baru', 2, now - 1 * MINUTE);
    expect(await purgeExpiredRateLimits(env)).toBe(2);
    expect(await limitKeys()).toEqual(['sync:blocked:aktif', 'sync:fails:baru']);
  });

  test('purgeExpiredRateLimits: baris penghitung bernilai 0 (jalur sah) yang kedaluwarsa dibuang, yang aktif tidak', async () => {
    const now = env.clock.now();
    await seedLimit('sync:fails:nol-basi', 0, now - 11 * MINUTE);
    await seedLimit('sync:fails:nol-aktif', 0, now - 2 * MINUTE);
    await seedLimit('sync:fails:nol-batas', 0, now - 10 * MINUTE); // tepat di batas: belum kedaluwarsa
    expect(await purgeExpiredRateLimits(env)).toBe(1);
    expect(await limitKeys()).toEqual(['sync:fails:nol-aktif', 'sync:fails:nol-batas']);
  });

  test('detak penjadwal ikut membersihkan rate_limits kedaluwarsa', async () => {
    await seedLimit('sync:fails:basi', 3, env.clock.now() - 2 * 60 * MINUTE);
    const stop = startScheduler(env, { intervalMs: 10_000 });
    try {
      await waitFor(async () => (await limitKeys()).length === 0);
    } finally {
      await stop();
    }
  });
});
