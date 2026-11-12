import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { checkBackupAlerts } from '@server/modules/backup/alert';
import { scheduleBackupJob } from '@server/modules/backup/service';
import { runJobStep } from '@server/modules/jobs/consumer';
import { delayLease, findActiveJob, listRunnableJobIds } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { flushDueCheckSummaries } from '@server/modules/notification/flush';
import { purgeOldNotifications } from '@server/modules/notification/repo';
import { checkPostelExpiryDigest } from '@server/modules/postel/digest';
import { checkLowStockDigest } from '@server/modules/sticker/digest';

/** Selang polling runner (milidetik). */
export const JOB_RUNNER_INTERVAL_MS = 2_000;
/** Selang penjadwal pembersihan (satu jam). */
export const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
/** Detak putaran latar notifikasi (30 detik): melepas ringkasan centang yang jendelanya habis. */
export const NOTIFICATION_LOOP_INTERVAL_MS = 30_000;
/** Jumlah id job yang dibaca per pemindaian. */
const SCAN_LIMIT = 20;

/**
 * Percobaan langkah yang sedang berjalan per job (hanya di memori proses ini): dipakai untuk membatasi
 * pengulangan galat sementara. Hilang saat proses restart, yang paling buruk memberi job satu putaran percobaan baru.
 */
const attemptsByJob = new Map<string, number>();

/**
 * Menjalankan job `queued`/`running` yang siap (lease habis atau tidak ada) berurutan menurut waktu dibuat dan
 * mengembalikan jumlah job yang dikerjakan (minimal satu langkah) oleh panggilan ini. Satu job dikerjakan
 * langkah demi langkah sampai selesai, gagal, atau ditunda karena galat sementara. Pemanggil serentak aman:
 * langkah dikuasai atomik (`claimStep`: `UPDATE ... WHERE ... lease_until <= ?` dan memeriksa baris yang
 * berubah), jadi job yang sama tidak pernah dijalankan dua kali; job yang dipegang pemanggil lain dilewati.
 */
export async function runPendingJobs(env: Env): Promise<number> {
  const worked = new Set<string>();
  const skipped = new Set<string>();
  for (;;) {
    const ids = await listRunnableJobIds(env, nowOf(env), SCAN_LIMIT);
    const id = ids.find((candidate) => !skipped.has(candidate));
    if (id === undefined) return worked.size;
    const attempt = (attemptsByJob.get(id) ?? 0) + 1;
    const result = await runJobStep(env, id, attempt);
    if (result.kind === 'skipped') {
      skipped.add(id);
      continue;
    }
    worked.add(id);
    if (result.kind === 'retry') {
      attemptsByJob.set(id, attempt);
      await delayLease(env, id, nowOf(env) + result.delaySeconds * 1000);
    } else {
      attemptsByJob.delete(id);
    }
  }
}

/**
 * Putaran berulang: `step` dijalankan segera lalu tiap `intervalMs` SETELAH putaran sebelumnya selesai (satu
 * putaran pada satu waktu). Galat putaran dicatat dan tidak menghentikan putaran. Fungsi penghenti menunggu
 * putaran yang sedang berjalan selesai (aman menutup pool basis data sesudahnya).
 */
function startLoop(label: string, step: () => Promise<unknown>, intervalMs: number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const tick = () => {
    running = (async () => {
      try {
        await step();
      } catch (error) {
        console.error(`${label}: putaran gagal: ${String(error)}`);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    })();
  };
  timer = setTimeout(tick, 0);
  return async (): Promise<void> => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    await running;
  };
}

/**
 * Runner latar: memanggil `runPendingJobs` tiap `intervalMs` (bawaan 2 dtk); satu job pada satu waktu.
 * Mengembalikan fungsi penghenti (lihat `startLoop`).
 */
export function startJobRunner(
  env: Env,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  return startLoop(
    'runner job',
    () => runPendingJobs(env),
    options.intervalMs ?? JOB_RUNNER_INTERVAL_MS,
  );
}

/**
 * Menjadwalkan pembersihan: menyisipkan job `cleanup_qr` kecuali masih ada yang aktif (tidak menumpuk).
 * Mengembalikan id job baru, atau `null` bila tidak dibuat. Hanya menjadwalkan; pekerjaannya oleh runner.
 */
export async function scheduleCleanupJob(env: Env): Promise<string | null> {
  if (await findActiveJob(env, 'cleanup_qr')) return null;
  return enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
}

/** Jendela terbesar baris `rate_limits` (detik): 10 menit, sama dengan lama blokir pembatas percobaan salah. */
const RATE_LIMIT_MAX_WINDOW_SECONDS = 10 * 60;

/**
 * Membuang baris `rate_limits` yang jendelanya sudah lewat (`window_start` lebih lama dari jendela terbesar):
 * baris sah paling lama hidup selama jendela itu, sisanya sampah yang tak pernah dibaca lagi.
 * Mengembalikan jumlah baris terhapus.
 */
export async function purgeExpiredRateLimits(env: Env): Promise<number> {
  const cutoff = nowOf(env) - RATE_LIMIT_MAX_WINDOW_SECONDS * 1000;
  const result = await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes;
}

/**
 * Detak penjadwal: menjadwalkan pembersihan QR, membersihkan `rate_limits`, menjadwalkan cadangan harian
 * (02:00 WIB), dan memeriksa peringatan cadangan basi/kuota Drive (keduanya hanya bila cadangan diaktifkan). Semuanya dicoba walau salah satu
 * gagal (galat pertama dilempar setelah keduanya dicoba, agar tercatat oleh `startLoop`).
 */
async function schedulerTick(env: Env): Promise<void> {
  const failures: unknown[] = [];
  for (const step of [
    scheduleCleanupJob,
    purgeExpiredRateLimits,
    scheduleBackupJob,
    checkBackupAlerts,
    checkLowStockDigest,
    checkPostelExpiryDigest,
    purgeOldNotifications,
  ]) {
    try {
      await step(env);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/**
 * Penjadwal: `schedulerTick` sekali saat mulai lalu tiap jam (`intervalMs`). Kerangka yang sama dipakai
 * untuk pekerjaan berkala lain (mis. dump malam). Mengembalikan fungsi penghenti (lihat `startLoop`).
 */
export function startScheduler(
  env: Env,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  return startLoop(
    'penjadwal',
    () => schedulerTick(env),
    options.intervalMs ?? SCHEDULER_INTERVAL_MS,
  );
}

/**
 * Putaran latar notifikasi Serah Terima: melepas ringkasan centang yang jatuh tempo tiap `intervalMs` (bawaan 30
 * dtk). Terpisah dari antrean job (satu job pada satu waktu), sehingga job panjang seperti cadangan tidak menunda
 * pelepasan. Mengembalikan fungsi penghenti (lihat `startLoop`).
 */
export function startNotificationLoop(
  env: Env,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  return startLoop(
    'notifikasi',
    () => flushDueCheckSummaries(env),
    options.intervalMs ?? NOTIFICATION_LOOP_INTERVAL_MS,
  );
}
