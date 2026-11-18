import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { checkBackupAlerts } from '@server/modules/backup/alert';
import { scheduleBackupJob } from '@server/modules/backup/service';
import { runJobStep } from '@server/modules/jobs/consumer';
import { delayLease, findActiveJob, listRunnableJobIds } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { flushDueCheckSummaries } from '@server/modules/notification/flush';
import { deliverPendingPushes } from '@server/modules/notification/push';
import { purgeOldNotifications } from '@server/modules/notification/repo';
import { pumpNotificationStreams } from '@server/modules/notification/stream-hub';
import { setNotificationWakeHandler } from '@server/modules/notification/wake';
import { checkPostelExpiryDigest } from '@server/modules/postel/digest';
import {
  sweepExpiredFailedProofs,
  sweepOrphanProofFiles,
  sweepProofDrafts,
} from '@server/modules/serial/proof/sweep';
import { checkLowStockDigest } from '@server/modules/sticker/digest';

/** Selang polling runner (milidetik). */
export const JOB_RUNNER_INTERVAL_MS = 2_000;
/** Selang penjadwal pembersihan (satu jam). */
export const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
/**
 * Detak putaran latar notifikasi (10 detik): melepas ringkasan centang yang jendelanya habis dan menjadi jaring
 * pengaman pengiriman push. Notifikasi baru dari penulisan tidak menunggu detak ini: jalur tulis membangunkan putaran
 * segera setelah commit (`wakeNotifications`).
 */
export const NOTIFICATION_LOOP_INTERVAL_MS = 10_000;
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

/**
 * Jendela terbesar baris `rate_limits` (detik): 1 jam, jendela pembatas unduhan installer desktop
 * (`APP_FILE_WINDOW_MS` di `modules/desktop/routes.ts`; jendela lain, mis. blokir percobaan salah, 10 menit, lebih pendek).
 * Pembersihan yang lebih awal mereset penghitung sebelum jendelanya habis dan melonggarkan batas.
 */
const RATE_LIMIT_MAX_WINDOW_SECONDS = 60 * 60;

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
    sweepProofDrafts,
    sweepExpiredFailedProofs,
    sweepOrphanProofFiles,
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
 * Putaran latar notifikasi Serah Terima: melepas ringkasan centang yang jatuh tempo lalu mengirim push untuk
 * notifikasi yang menunggu, tiap `intervalMs` (bawaan 10 dtk) DAN segera setelah penulisan notifikasi di-commit
 * (`wakeNotifications`, `notification/wake.ts`: sinyal dari jalur tulis `handover/service.ts`; satu putaran pada satu waktu,
 * sinyal berdekatan digabung, sinyal saat putaran berjalan = ulangi segera). Terpisah dari antrean job (satu job pada satu waktu), sehingga job panjang seperti cadangan tidak menunda
 * pelepasan. Mengembalikan fungsi penghenti (lihat `startLoop`).
 */
export function startNotificationLoop(
  env: Env,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  const intervalMs = options.intervalMs ?? NOTIFICATION_LOOP_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let wakeScheduled = false;
  let wokeWhileRunning = false;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, delayMs);
  };
  const tick = () => {
    wakeScheduled = false;
    running = (async () => {
      try {
        await notificationTick(env);
      } catch (error) {
        console.error(`notifikasi: putaran gagal: ${String(error)}`);
      }
      running = undefined;
      // Dibangunkan saat putaran berjalan: ulangi segera (notifikasi baru mungkin belum terbaca putaran ini).
      const again = wokeWhileRunning;
      wokeWhileRunning = false;
      schedule(again ? 0 : intervalMs);
    })();
  };
  // Satu putaran pada satu waktu (deliverPendingPushes tidak mengklaim baris, jadi tak boleh tumpang tindih):
  // bangun-bangun selama putaran berjalan hanya menandai "ulangi", dan yang berdekatan digabung satu.
  const wake = () => {
    if (stopped) return;
    if (running !== undefined) {
      wokeWhileRunning = true;
      return;
    }
    if (wakeScheduled) return;
    wakeScheduled = true;
    schedule(0);
  };
  const release = setNotificationWakeHandler(wake);
  schedule(0);
  return async (): Promise<void> => {
    stopped = true;
    release();
    clearTimeout(timer);
    await running;
  };
}

/**
 * Satu putaran notifikasi: pelepasan ringkasan centang DAN pengiriman push dijalankan keduanya; galat pada satu
 * langkah tidak membatalkan yang lain (pola `schedulerTick`), galat pertama dilempar setelah semuanya dicoba.
 */
export async function notificationTick(env: Env): Promise<void> {
  const failures: unknown[] = [];
  // Aliran SSE desktop paling akhir: ia membaca tabel `notifications` yang baru ditulis/dilepas dua langkah pertama.
  for (const step of [flushDueCheckSummaries, deliverPendingPushes, pumpNotificationStreams]) {
    try {
      await step(env);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
